// Command server runs the API or the background worker (APP_MODE=api|worker).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"product/api/internal/api"
	"product/api/internal/config"
	"product/api/internal/httpx"
)

func main() {
	cfg, err := config.FromOS()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("mode", cfg.Mode, "env", cfg.Env, "version", cfg.Version)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, cfg, log); err != nil {
		log.Error("exited with error", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	if cfg.Mode == config.ModeWorker {
		// Phase 0: River workers are wired here after the compatibility spike.
		log.Info("worker started (no jobs registered yet)")
		<-ctx.Done()
		return nil
	}

	routes, err := api.NewHandler(&api.Server{Version: cfg.Version, Checks: map[string]api.Check{}})
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpx.Chain(routes, log, cfg.AllowedOrigins, cfg.RequestTimeout, cfg.MaxBodyBytes),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
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
		return srv.Shutdown(shutdown)
	}
}
