// Command server runs the API or the background worker (APP_MODE=api|worker).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/ai/langchain"
	"product/api/internal/aievent"
	"product/api/internal/api"
	"product/api/internal/auth"
	"product/api/internal/config"
	"product/api/internal/httpx"
	"product/api/internal/intake"
	"product/api/internal/jobs"
	"product/api/internal/review"
	"product/api/internal/workspaces"
)

func main() {
	cfg, err := config.FromOS()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("mode", cfg.Mode, "env", cfg.Env, "version", cfg.Version)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, cfg, log); err != nil {
		log.Error("exited with error", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	if cfg.Mode == config.ModeWorker {
		return runWorker(ctx, cfg, log)
	}
	return runAPI(ctx, cfg, log)
}

func newPool(ctx context.Context, url string, pooler bool) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("database url: %w", err)
	}
	if pooler {
		// Transaction-mode poolers cannot keep prepared statements per connection.
		pc.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	}
	return pgxpool.NewWithConfig(ctx, pc)
}

func runAPI(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	srv := &api.Server{Version: cfg.Version, Checks: map[string]api.Check{}}

	if cfg.JWKSURL != "" {
		v, err := auth.NewVerifier(ctx, auth.Config{JWKSURL: cfg.JWKSURL, Issuer: cfg.JWTIssuer, Audience: cfg.JWTAudience})
		if err != nil {
			return fmt.Errorf("token verifier: %w", err)
		}
		srv.Auth = v
	} else {
		log.Warn("SUPABASE_JWKS_URL not set: every request except health will be rejected")
		srv.Auth = denyAll{}
	}

	if cfg.DatabaseURL != "" {
		pool, err := newPool(ctx, cfg.DatabaseURL, cfg.DatabasePooler)
		if err != nil {
			return err
		}
		defer pool.Close()
		srv.Pool = pool
		srv.Checks["database"] = func(ctx context.Context) error { return pool.Ping(ctx) }

		// Insert-only River client: the API enqueues, the worker process runs jobs.
		workers := river.NewWorkers()
		river.AddWorker(workers, &intake.ExtractWorker{Pool: pool})
		jc, err := jobs.NewClient(pool, workers, nil)
		if err != nil {
			return fmt.Errorf("job client: %w", err)
		}
		srv.Workspaces = &workspaces.Service{Pool: pool}
		srv.Intake = &intake.Service{Pool: pool, Jobs: jc, DailyBytes: cfg.DailyIngestMax}
		srv.Review = &review.Service{Pool: pool}
	} else {
		log.Warn("DATABASE_URL not set: only health endpoints will work")
	}

	routes, err := api.NewHandler(srv)
	if err != nil {
		return err
	}
	hs := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpx.Chain(routes, log, cfg.AllowedOrigins, cfg.RequestTimeout, cfg.MaxBodyBytes),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}
	errc := make(chan error, 1)
	go func() { errc <- hs.ListenAndServe() }()
	log.Info("listening", "addr", cfg.Addr)

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return hs.Shutdown(shutdown)
	}
}

func runWorker(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	url := cfg.DatabaseDirectURL
	if url == "" {
		url = cfg.DatabaseURL
	}
	if url == "" || cfg.AIConfigPath == "" {
		return errors.New("worker needs DATABASE_DIRECT_URL (or DATABASE_URL) and AI_CONFIG")
	}
	pool, err := newPool(ctx, url, false) // direct connection: River needs LISTEN/NOTIFY
	if err != nil {
		return err
	}
	defer pool.Close()

	aiCfg, err := langchain.LoadConfig(cfg.AIConfigPath)
	if err != nil {
		return err
	}
	router, warnings, err := langchain.NewRouter(ctx, aiCfg, os.Getenv, &aievent.Recorder{Pool: pool, Log: log})
	if err != nil {
		return err
	}
	for _, w := range warnings {
		log.Warn("ai config", "warning", w)
	}

	workers := river.NewWorkers()
	river.AddWorker(workers, &intake.ExtractWorker{Pool: pool, Completer: router})
	jc, err := jobs.NewClient(pool, workers, nil)
	if err != nil {
		return err
	}
	if err := jc.Start(ctx); err != nil {
		return fmt.Errorf("start worker: %w", err)
	}
	log.Info("worker started")
	<-ctx.Done()
	stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return jc.Stop(stopCtx)
}

// denyAll rejects every token. Used only when no key set is configured, so a
// misconfigured deployment fails closed instead of open.
type denyAll struct{}

func (denyAll) Verify(string) (auth.Identity, error) { return auth.Identity{}, auth.ErrUnauthorized }
