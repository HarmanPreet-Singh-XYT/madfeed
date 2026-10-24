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
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/client"

	"product/api/internal/ai"
	"product/api/internal/ai/langchain"
	"product/api/internal/aievent"
	"product/api/internal/api"
	"product/api/internal/apikey"
	"product/api/internal/audit"
	"product/api/internal/auth"
	"product/api/internal/billing"
	"product/api/internal/brief"
	"product/api/internal/config"
	"product/api/internal/digest"
	"product/api/internal/directory"
	"product/api/internal/email/resend"
	"product/api/internal/httpx"
	"product/api/internal/intake"
	"product/api/internal/integrations"
	"product/api/internal/jobs"
	"product/api/internal/media"
	"product/api/internal/oauth"
	"product/api/internal/ops"
	"product/api/internal/outreach"
	"product/api/internal/portability"
	"product/api/internal/publicsite"
	"product/api/internal/quality"
	"product/api/internal/ratelimit"
	"product/api/internal/release"
	"product/api/internal/research"
	"product/api/internal/retention"
	"product/api/internal/review"
	"product/api/internal/secretbox"
	"product/api/internal/storage"
	"product/api/internal/survey"
	"product/api/internal/transcribe"
	"product/api/internal/views"
	"product/api/internal/webhook"
	"product/api/internal/workflow"
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

func newAlerter(cfg config.Config, log *slog.Logger) *ops.Alerter {
	n := []ops.Notifier{ops.LogNotifier{Log: log}}
	if cfg.AlertWebhookURL != "" {
		n = append(n, ops.WebhookNotifier{URL: cfg.AlertWebhookURL})
	} else {
		log.Warn("ALERT_WEBHOOK_URL not set: alerts go to the log only")
	}
	return &ops.Alerter{Notifiers: n, Log: log}
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
		deps := map[string]ops.Check{}
		for name, c := range srv.Checks {
			deps[name] = ops.Check(c)
		}

		// Insert-only River client: the API enqueues, the worker process runs jobs.
		workers := river.NewWorkers()
		river.AddWorker(workers, &intake.ExtractWorker{Pool: pool})
		river.AddWorker(workers, &brief.Worker{Pool: pool})
		river.AddWorker(workers, &outreach.DraftWorker{Pool: pool})
		river.AddWorker(workers, &outreach.SendWorker{Pool: pool})
		river.AddWorker(workers, &survey.SendWorker{Pool: pool})
		river.AddWorker(workers, &survey.EvidenceWorker{Pool: pool})
		river.AddWorker(workers, &media.TranscribeWorker{})
		river.AddWorker(workers, &research.SuggestWorker{})
		alerts := newAlerter(cfg, log)
		go ops.WatchDependencies(ctx, deps, alerts, log, 30*time.Second)
		jc, err := jobs.NewClientWith(pool, workers, nil, jobs.AllQueues, jobs.Extras{Plugins: []rivertype.Plugin{&ops.StampJobs{}}})
		if err != nil {
			return fmt.Errorf("job client: %w", err)
		}
		srv.Workspaces = &workspaces.Service{Pool: pool}
		srv.Intake = &intake.Service{Pool: pool, Jobs: jc, DailyBytes: cfg.DailyIngestMax}
		srv.Review = &review.Service{Pool: pool}
		outSvc := &outreach.Service{Pool: pool, Jobs: jc, HashKey: []byte(cfg.UnsubscribeSecret)}
		srv.Outreach = outSvc
		srv.Limiter = &ratelimit.Limiter{Pool: pool, Secret: []byte(cfg.UnsubscribeSecret + "|ratelimit"), Log: log}
		srv.Limits = api.Limits{TrustedHops: cfg.TrustedProxyHops, PublicPerMinute: cfg.RatePublic, ReadPerMinute: cfg.RateRead, WritePerMinute: cfg.RateWrite, RegisterPerHour: cfg.RateRegister}
		if cfg.ResendWebhookSecret != "" {
			srv.Webhook = &webhook.Resend{Pool: pool, Suppress: outSvc, Secret: cfg.ResendWebhookSecret, Log: log}
		}
		srv.Workflow = &workflow.Service{Pool: pool, Outreach: outSvc}
		srv.Release = &release.Service{Pool: pool}
		srv.Research = &research.Service{Pool: pool, Jobs: jc}
		srv.Views = &views.Service{Pool: pool}
		srv.APIKeys = &apikey.Service{Pool: pool}
		integ, err := newIntegrations(cfg, pool, srv.Intake, srv.Workflow)
		if err != nil {
			return err
		}
		srv.Integrations = integ
		bill, err := newBilling(cfg, pool)
		if err != nil {
			return err
		}
		srv.Billing = bill
		if cfg.PublicAPIURL != "" { // remote assistants can only be pointed at an address we know
			srv.OAuth = &oauth.Service{
				Pool: pool, Keys: srv.APIKeys, Issuer: cfg.PublicAPIURL, Resource: cfg.PublicAPIURL + "/mcp", WebURL: cfg.PublicBaseURL,
				Allow: func(ctx context.Context, ws uuid.UUID) error { return bill.Check(ctx, ws, billing.FeatureAPIKeys) },
			}
		}
		srv.Digest = &digest.Service{Pool: pool, Unsub: digest.Unsubscriber{BaseURL: cfg.PublicBaseURL, Secret: []byte(cfg.UnsubscribeSecret)}}
		srv.EmailConfigured = cfg.ResendAPIKey != "" && cfg.EmailFromAddress != ""
		srv.Site = &publicsite.Service{Pool: pool, Intake: srv.Intake}
		if srv.Limiter != nil {
			lim := srv.Limiter
			srv.Site.Throttle = publicsite.Throttle(lim, 20, 20)
			srv.Site.VoteThrottle = publicsite.VoteThrottle(lim, 100)
		}
		srv.Surveys = &survey.Service{
			Pool: pool, Jobs: jc, Intake: srv.Intake, HashKey: []byte(cfg.UnsubscribeSecret),
			Links:      survey.Links{Secret: []byte(cfg.UnsubscribeSecret), BaseURL: cfg.PublicBaseURL},
			MaxInvites: cfg.SurveyMaxInvites, DailyPublic: cfg.SurveyDailyPublic,
		}
		if srv.Limiter != nil {
			lim := srv.Limiter
			srv.Surveys.Throttle = func(ctx context.Context, key, addr string) bool {
				if addr != "" && !lim.Allow(ctx, "survey-addr", key+"|"+addr, 60, 60).Allowed {
					return false
				}
				return lim.Allow(ctx, "survey", key, 600, 60).Allowed
			}
			perAddr := cfg.SurveyPublicPerAddress
			if perAddr <= 0 {
				perAddr = 10
			}
			srv.Surveys.NewResponseThrottle = func(ctx context.Context, key, addr string) bool {
				return addr == "" || lim.Allow(ctx, "survey-new", key+"|"+addr, perAddr, 86400).Allowed
			}
		}
		srv.QA = &research.QA{Pool: srv.Research}
		if cfg.MediaEnabled() {
			files, err := mediaStore(cfg)
			if err != nil {
				return err
			}
			srv.Media = &media.Service{Pool: pool, Jobs: jc, Store: files, HashKey: []byte(cfg.UnsubscribeSecret), MaxFile: cfg.MaxUploadBytes}
			if cfg.Env == "production" && cfg.S3.Bucket == "" {
				log.Warn("recordings are stored on local disk: fine for development, not for production (set the STORAGE_S3_* settings)")
			}
		} else {
			log.Warn("neither MEDIA_DIR nor STORAGE_S3_* set: recording uploads are switched off")
		}
		if cfg.AIConfigPath != "" { // questions are answered while the person waits, so the API needs the model router
			aiCfg, err := langchain.LoadConfig(cfg.AIConfigPath)
			if err != nil {
				return err
			}
			router, warnings, err := langchain.NewRouter(ctx, aiCfg, os.Getenv, &aievent.Recorder{Pool: pool, Log: log})
			if router != nil {
				router.WithBudget(&aievent.Budget{Pool: pool, DefaultUSD: cfg.AIDailyBudgetUSD, Log: log, PlanBudget: planBudget(cfg, pool)})
			}
			if err != nil {
				return err
			}
			for _, w := range warnings {
				log.Warn("ai config", "warning", w)
			}
			srv.QA.Completer = router
		} else {
			log.Warn("AI_CONFIG not set: questions are switched off")
		}
		srv.Unsub = outreach.Unsubscriber{BaseURL: cfg.PublicBaseURL, Secret: []byte(cfg.UnsubscribeSecret)}
		srv.Directory = &directory.Service{Pool: pool}
		srv.Brief = &brief.Service{Pool: pool, Jobs: jc}
		srv.Quality = &quality.Service{Pool: pool}
		srv.Portability = &portability.Service{Pool: pool}
		srv.Audit = &audit.Service{Pool: pool, QA: srv.QA, Brief: srv.Brief} // after the services it reads from
	} else {
		log.Warn("DATABASE_URL not set: only health endpoints will work")
	}

	if err := srv.Validate(); err != nil {
		return err
	}
	var metrics *ops.Metrics
	if cfg.MetricsToken != "" {
		metrics = ops.NewMetrics(srv.Pool, cfg.MetricsToken)
		srv.Metrics = metrics
	}
	routes, err := api.NewHandler(srv)
	if err != nil {
		return err
	}
	if metrics != nil {
		routes = metrics.Instrument(routes)
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
	if url == "" {
		return errors.New("worker needs DATABASE_DIRECT_URL (or DATABASE_URL)")
	}
	pool, err := newPool(ctx, url, false) // direct connection: River needs LISTEN/NOTIFY
	if err != nil {
		return err
	}
	defer pool.Close()

	workers := river.NewWorkers()

	// AI-backed jobs need a configured provider. Without one (local development)
	// the worker still drafts plain messages and sends approved mail.
	var completer *ai.Router
	if cfg.AIConfigPath != "" {
		aiCfg, err := langchain.LoadConfig(cfg.AIConfigPath)
		if err != nil {
			return err
		}
		router, warnings, err := langchain.NewRouter(ctx, aiCfg, os.Getenv, &aievent.Recorder{Pool: pool, Log: log})
		if router != nil {
			router.WithBudget(&aievent.Budget{Pool: pool, DefaultUSD: cfg.AIDailyBudgetUSD, Log: log, PlanBudget: planBudget(cfg, pool)})
		}
		if err != nil {
			return err
		}
		for _, w := range warnings {
			log.Warn("ai config", "warning", w)
		}
		completer = router
		river.AddWorker(workers, &intake.ExtractWorker{Pool: pool, Completer: router})
		river.AddWorker(workers, &brief.Worker{Pool: pool, Completer: router})
		river.AddWorker(workers, &outreach.DraftWorker{Pool: pool, Completer: router})
		river.AddWorker(workers, &research.SuggestWorker{Pool: pool, Completer: router})
	} else {
		log.Warn("AI_CONFIG not set: extraction and briefs wait until it is; message drafts use the plain template")
		river.AddWorker(workers, &intake.ExtractWorker{Pool: pool})
		river.AddWorker(workers, &brief.Worker{Pool: pool})
		river.AddWorker(workers, &outreach.DraftWorker{Pool: pool})
		river.AddWorker(workers, &research.SuggestWorker{Pool: pool})
	}
	_ = completer

	// Transcription needs a store to read from and a provider key; without either, uploads wait.
	var (
		mediaSvc *media.Service
		tw       *media.TranscribeWorker
	)
	if cfg.MediaEnabled() {
		disk, err := mediaStore(cfg)
		if err != nil {
			return err
		}
		tw = &media.TranscribeWorker{Pool: pool, Store: disk, PricePerMinuteUSD: cfg.TranscribePricePerMinuteUSD}
		if completer != nil {
			// The same allowance covers transcription: a workspace that has used it waits for the window to roll over.
			tw.Budget = &aievent.Budget{Pool: pool, DefaultUSD: cfg.AIDailyBudgetUSD, Log: log, PlanBudget: planBudget(cfg, pool)}
		}
		if key := os.Getenv("OPENAI_API_KEY"); key != "" {
			tw.Provider = &transcribe.OpenAI{BaseURL: cfg.TranscribeBaseURL, APIKey: key, Model: cfg.TranscribeModel, Max: cfg.TranscribeMaxSize}
		} else {
			log.Warn("OPENAI_API_KEY not set: uploaded recordings wait for a transcription provider")
		}
		mediaSvc = &media.Service{Pool: pool, Store: disk}
	} else {
		tw = &media.TranscribeWorker{Pool: pool}
	}
	river.AddWorker(workers, tw)

	send := &outreach.SendWorker{
		Pool: pool, FromAddress: cfg.EmailFromAddress, ReplyTo: cfg.EmailReplyTo,
		Unsub: outreach.Unsubscriber{BaseURL: cfg.PublicBaseURL, Secret: []byte(cfg.UnsubscribeSecret)},
	}
	if cfg.ResendAPIKey != "" && cfg.EmailFromAddress != "" {
		sender, err := resend.New(cfg.ResendAPIKey, cfg.ResendBaseURL)
		if err != nil {
			return err
		}
		send.Sender = sender
	} else {
		log.Warn("RESEND_API_KEY or EMAIL_FROM_ADDRESS not set: approved messages will wait until email is configured")
	}
	river.AddWorker(workers, send)
	surveySend := &survey.SendWorker{
		Pool: pool, Sender: send.Sender, FromAddress: cfg.EmailFromAddress, ReplyTo: cfg.EmailReplyTo, Unsub: send.Unsub,
		Links: survey.Links{Secret: []byte(cfg.UnsubscribeSecret), BaseURL: cfg.PublicBaseURL},
	}
	river.AddWorker(workers, surveySend)
	surveyEvidence := &survey.EvidenceWorker{Pool: pool}
	river.AddWorker(workers, surveyEvidence)
	digestSvc := &digest.Service{
		Pool: pool, Sender: send.Sender, From: cfg.EmailFromAddress, ReplyTo: cfg.EmailReplyTo, Log: log,
		Unsub: digest.Unsubscriber{BaseURL: cfg.PublicBaseURL, Secret: []byte(cfg.UnsubscribeSecret)},
	}

	alerts := newAlerter(cfg, log)
	jc, err := jobs.NewClientWith(pool, workers, nil, cfg.WorkerQueues, jobs.Extras{
		Plugins:      []rivertype.Plugin{&ops.StampJobs{}},
		ErrorHandler: &ops.ReportFailures{Alerts: alerts, Log: log},
	})
	if err != nil {
		return err
	}
	tw.Jobs = jc
	surveyEvidence.Intake = &intake.Service{Pool: pool, Jobs: jc, DailyBytes: cfg.DailyIngestMax}
	if err := jc.Start(ctx); err != nil {
		return fmt.Errorf("start worker: %w", err)
	}
	log.Info("worker started")
	go (&ops.Watchers{Pool: pool, Alerts: alerts, Log: log}).Loop(ctx, time.Minute)
	if integ, err := newIntegrations(cfg, pool, nil, nil); err == nil && integ.Available() {
		go integ.Loop(ctx, 15*time.Minute) // notice a revoked or expired connection without waiting for someone to look
	}
	if bill, err := newBilling(cfg, pool); err == nil && bill.Enabled() {
		go bill.Loop(ctx, 5*time.Minute, log) // catch a payment notification that never arrived
	}
	go digestSvc.Loop(ctx, cfg.DigestEvery)                // the weekly team digest, for workspaces that turned it on
	go (&audit.Service{Pool: pool}).Loop(ctx, log)         // a few answers and briefs a week for an admin to check
	go (&retention.Purger{Pool: pool, Log: log}).Loop(ctx) // working data past its retention period; see docs/gates/gate-5.md
	if mediaSvc != nil {
		go func() { // abandoned uploads and their partial files are removed regularly
			tick := time.NewTicker(15 * time.Minute)
			defer tick.Stop()
			for {
				if n, err := mediaSvc.CleanupExpired(ctx); err != nil {
					log.Error("upload cleanup", "error", err)
				} else if n > 0 {
					log.Info("removed abandoned uploads", "count", n)
				}
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
				}
			}
		}()
	}

	// A tiny health endpoint so the platform (and tests) can tell the worker is alive.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","mode":"worker"}`))
	})
	hs := &http.Server{Addr: cfg.Addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("worker health endpoint", "error", err)
		}
	}()

	<-ctx.Done()
	stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = hs.Shutdown(stopCtx)
	return jc.Stop(stopCtx)
}

// denyAll rejects every token. Used only when no key set is configured, so a
// misconfigured deployment fails closed instead of open.
type denyAll struct{}

func (denyAll) Verify(string) (auth.Identity, error) { return auth.Identity{}, auth.ErrUnauthorized }

// mediaStore is where recordings live: a bucket when one is configured, otherwise a local folder.
func mediaStore(cfg config.Config) (storage.Store, error) {
	if cfg.S3.Bucket != "" {
		return storage.NewS3(storage.S3Config{Endpoint: cfg.S3.Endpoint, Region: cfg.S3.Region, Bucket: cfg.S3.Bucket, AccessKeyID: cfg.S3.AccessKeyID, SecretAccessKey: cfg.S3.SecretAccessKey})
	}
	return &storage.Local{Dir: cfg.MediaDir}, nil
}

// newIntegrations sets up connections to other services. Without SECRETS_KEY it still exists (so the screens
// can say so) but cannot store anything.
func newIntegrations(cfg config.Config, pool *pgxpool.Pool, in *intake.Service, wf *workflow.Service) (*integrations.Service, error) {
	svc := &integrations.Service{
		Pool: pool, Intake: in, Workflow: wf, WebURL: cfg.PublicBaseURL,
		Slack: integrations.SlackConfig{
			ClientID: cfg.SlackClientID, ClientSecret: cfg.SlackClientSecret, SigningSecret: cfg.SlackSigningSecret,
			APIBase: cfg.SlackAPIBase, AuthorizeURL: cfg.SlackAuthorizeURL, RedirectURI: strings.TrimRight(cfg.PublicBaseURL, "/") + "/integrations/slack/callback",
		},
		GitHub: integrations.GitHubConfig{APIBase: cfg.GitHubAPIBase, APIURL: cfg.PublicAPIURL},
	}
	if cfg.SecretsKey != "" {
		box, err := secretbox.New(cfg.SecretsKey)
		if err != nil {
			return nil, err
		}
		svc.Box = box
	}
	return svc, nil
}

// newBilling sets up payments. Without STRIPE_SECRET_KEY the service exists but is off, so every workspace may
// use everything.
func newBilling(cfg config.Config, pool *pgxpool.Pool) (*billing.Service, error) {
	plans, err := billing.LoadPlans(cfg.PlansConfig)
	if err != nil {
		return nil, err
	}
	svc := &billing.Service{Pool: pool, Plans: plans, WebURL: cfg.PublicBaseURL, WebhookSecret: cfg.StripeWebhookSecret}
	if cfg.StripeSecretKey != "" {
		bc := &stripe.BackendConfig{MaxNetworkRetries: stripe.Int64(2), HTTPClient: &http.Client{Timeout: 20 * time.Second}}
		if cfg.StripeAPIBase != "" {
			bc.URL = stripe.String(strings.TrimRight(cfg.StripeAPIBase, "/"))
		}
		sc := &client.API{}
		sc.Init(cfg.StripeSecretKey, &stripe.Backends{API: stripe.GetBackendWithConfig(stripe.APIBackend, bc)})
		svc.Stripe = sc
	}
	return svc, nil
}

// planBudget gives the model allowance a workspace's plan includes, when payments are on.
func planBudget(cfg config.Config, pool *pgxpool.Pool) func(ctx context.Context, ws uuid.UUID) (float64, bool) {
	if cfg.StripeSecretKey == "" {
		return nil
	}
	b, err := newBilling(cfg, pool)
	if err != nil {
		return nil
	}
	return func(ctx context.Context, ws uuid.UUID) (float64, bool) {
		pl, _, err := b.Plan(ctx, ws)
		if err != nil {
			return 0, false
		}
		return pl.Entitlements.AIBudgetUSD, true
	}
}
