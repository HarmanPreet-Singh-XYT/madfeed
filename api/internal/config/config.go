// Package config loads runtime settings from the environment and fails fast
// on anything missing or malformed. No secrets have defaults.
package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"product/api/internal/ops"
	"strconv"
	"strings"
	"time"
)

type Mode string

const (
	ModeAPI    Mode = "api"
	ModeWorker Mode = "worker"
)

type Config struct {
	Mode           Mode
	Env            string // "development" | "staging" | "production"
	Addr           string
	AllowedOrigins []string // exact origins; never "*"
	RequestTimeout time.Duration
	MaxBodyBytes   int64
	Version        string

	// Database. DatabaseURL is the app role used by the API (may be a pooler);
	// DatabaseDirectURL is a direct/session connection for the worker (River
	// needs LISTEN/NOTIFY). Neither may be the service_role / superuser.
	DatabaseURL       string
	DatabaseDirectURL string
	DatabasePooler    bool // true when DatabaseURL is a transaction-mode pooler

	// Token verification (Supabase Auth).
	JWKSURL     string
	JWTIssuer   string
	JWTAudience string

	AIConfigPath string // tier/route file; see config/ai.example.json
	// AIDailyBudgetUSD caps AI spend per workspace over any 24 hours (0 switches the cap off).
	AIDailyBudgetUSD float64
	DailyIngestMax   int64 // bytes per workspace per 24h; 0 = built-in default

	// Email and public links. Every outgoing message carries a signed
	// unsubscribe link, so the secret and the public address are required in
	// production even before email is switched on.
	PublicBaseURL     string // where people open the web app, no trailing slash
	UnsubscribeSecret string
	ResendAPIKey      string
	ResendBaseURL     string // optional: point at a test server
	EmailFromAddress  string // a verified sending address
	EmailReplyTo      string // optional
	// ResendWebhookSecret verifies delivery reports (bounces, complaints) from the
	// email provider; required in production once email is switched on.
	ResendWebhookSecret string

	// Recordings. MediaDir switches uploads on and names the folder files are
	// kept in (development storage; a production bucket plugs in behind
	// internal/storage). Transcription uses the OpenAI audio protocol with
	// OPENAI_API_KEY; TranscribeBaseURL lets tests point at a local stand-in.
	// S3 holds recordings in an S3-compatible bucket (for example Supabase Storage) instead of local disk.
	S3                S3Config
	MediaDir          string
	MaxUploadBytes    int64 // 0 = built-in default (1 GiB)
	TranscribeModel   string
	TranscribeBaseURL string
	TranscribeMaxSize int64 // the vendor's file size limit; 0 = built-in default
	// TranscribePricePerMinuteUSD is the vendor's price per audio minute (from its price list); 0 = unknown.
	TranscribePricePerMinuteUSD float64

	// AlertWebhookURL receives alerts as a chat message (Slack-compatible); empty means alerts go to the log only.
	// MetricsToken is the bearer token a monitoring scraper sends to /metrics; empty switches the endpoint off.
	MetricsToken string
	// DigestEvery is how often the worker looks for weekly digests that are due (default 10 minutes).
	DigestEvery time.Duration
	// HubSpotEvery is how often the worker looks for HubSpot syncs that are due or asked for (default a minute).
	HubSpotEvery time.Duration
	// Payments: a Stripe secret key (test keys outside production), the signing secret of the notification endpoint,
	// and the file that lists the plans. Without a key billing is off and everything is included.
	StripeSecretKey, StripeWebhookSecret, StripeAPIBase, PlansConfig string
	// SecretsKey seals the credentials kept for other services (base64, 32 bytes). Without it nothing can be connected.
	SecretsKey string
	// WebhooksAllowPrivate lets outbound webhooks go to private networks and plain http. Development only.
	WebhooksAllowPrivate bool
	// PublicAPIURL is this server's public address (shown to admins as where an issue tracker should send notifications).
	PublicAPIURL string
	// The Slack app this server is registered as, and the address overrides used only to point at a stand-in in tests.
	SlackClientID, SlackClientSecret, SlackSigningSecret string
	SlackAPIBase, SlackAuthorizeURL, GitHubAPIBase       string
	LinearAPIBase, JiraAPIBase, HubSpotAPIBase           string
	ClickUpAPIBase, AsanaAPIBase, AzureAPIBase           string
	// IntegrationsEnabled is the comma-separated list of services switched on (default: slack,github).
	IntegrationsEnabled string
	// Requests per minute allowed from one caller; 0 keeps the built-in default (public 60, reads 1200, writes 120).
	RatePublic, RateRead, RateWrite, RateRegister               int
	SurveyMaxInvites, SurveyDailyPublic, SurveyPublicPerAddress int
	AlertWebhookURL                                             string

	// TrustedProxyHops is how many proxies of ours sit in front of the API (their X-Forwarded-For
	// entries are believed); 0 means none, and the header is ignored.
	TrustedProxyHops int

	// WorkerQueues are the queues this worker process serves (default: all).
	WorkerQueues []string
}

// Load reads configuration from getenv (os.Getenv in production).
func Load(getenv func(string) string) (Config, error) {
	c := Config{
		Mode:           Mode(or(getenv("APP_MODE"), "api")),
		Env:            or(getenv("APP_ENV"), "development"),
		Addr:           or(getenv("ADDR"), ":8080"),
		RequestTimeout: 30 * time.Second,
		MaxBodyBytes:   1 << 20, // 1 MiB default; upload routes opt in to more
		Version:        or(getenv("APP_VERSION"), "dev"),
	}
	if c.Mode != ModeAPI && c.Mode != ModeWorker {
		return c, fmt.Errorf("APP_MODE must be %q or %q, got %q", ModeAPI, ModeWorker, c.Mode)
	}
	switch c.Env {
	case "development", "staging", "production":
	default:
		return c, fmt.Errorf("APP_ENV must be development, staging or production, got %q", c.Env)
	}
	for _, o := range strings.Split(getenv("ALLOWED_ORIGINS"), ",") {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		if o == "*" {
			return c, fmt.Errorf("ALLOWED_ORIGINS must list exact origins, not *")
		}
		c.AllowedOrigins = append(c.AllowedOrigins, o)
	}
	if c.Env == "production" && len(c.AllowedOrigins) == 0 {
		return c, fmt.Errorf("ALLOWED_ORIGINS is required in production")
	}

	c.DatabaseURL = getenv("DATABASE_URL")
	c.DatabaseDirectURL = getenv("DATABASE_DIRECT_URL")
	c.DatabasePooler = getenv("DATABASE_POOLER") == "true"
	c.JWKSURL = getenv("SUPABASE_JWKS_URL")
	c.JWTIssuer = getenv("JWT_ISSUER")
	c.JWTAudience = or(getenv("JWT_AUDIENCE"), "authenticated")
	c.AIConfigPath = getenv("AI_CONFIG")
	c.AIDailyBudgetUSD = 5
	if v := getenv("AI_DAILY_BUDGET_USD"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f < 0 || f > 100000 {
			return c, fmt.Errorf("AI_DAILY_BUDGET_USD must be a number from 0 up (0 turns the cap off)")
		}
		c.AIDailyBudgetUSD = f
	}
	if v := getenv("DAILY_INGEST_MAX_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return c, fmt.Errorf("DAILY_INGEST_MAX_BYTES must be a positive integer")
		}
		c.DailyIngestMax = n
	}
	c.PublicBaseURL = strings.TrimRight(getenv("PUBLIC_BASE_URL"), "/")
	c.UnsubscribeSecret = getenv("UNSUBSCRIBE_SECRET")
	c.ResendAPIKey = getenv("RESEND_API_KEY")
	c.ResendBaseURL = getenv("RESEND_BASE_URL")
	c.EmailFromAddress = getenv("EMAIL_FROM_ADDRESS")
	c.EmailReplyTo = getenv("EMAIL_REPLY_TO")
	c.ResendWebhookSecret = getenv("RESEND_WEBHOOK_SECRET")
	for _, q := range strings.Split(or(getenv("WORKER_QUEUES"), "default,research"), ",") {
		switch q = strings.TrimSpace(q); q {
		case "default", "research":
			c.WorkerQueues = append(c.WorkerQueues, q)
		case "":
		default:
			return c, fmt.Errorf("WORKER_QUEUES may list default and research, got %q", q)
		}
	}
	if len(c.WorkerQueues) == 0 {
		return c, fmt.Errorf("WORKER_QUEUES must name at least one queue")
	}
	c.AlertWebhookURL = getenv("ALERT_WEBHOOK_URL")
	c.DigestEvery = 10 * time.Minute
	if v := getenv("DIGEST_CHECK_SECONDS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 3600 {
			return c, fmt.Errorf("DIGEST_CHECK_SECONDS must be a number from 1 to 3600")
		}
		c.DigestEvery = time.Duration(n) * time.Second
	}
	c.HubSpotEvery = time.Minute
	if v := getenv("HUBSPOT_CHECK_SECONDS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 3600 {
			return c, fmt.Errorf("HUBSPOT_CHECK_SECONDS must be a number from 1 to 3600")
		}
		c.HubSpotEvery = time.Duration(n) * time.Second
	}
	for _, f := range []struct {
		name string
		dst  *int
	}{{"RATE_PUBLIC_PER_MINUTE", &c.RatePublic}, {"RATE_READ_PER_MINUTE", &c.RateRead}, {"RATE_WRITE_PER_MINUTE", &c.RateWrite}, {"RATE_REGISTER_PER_HOUR", &c.RateRegister}, {"SURVEY_MAX_INVITES", &c.SurveyMaxInvites}, {"SURVEY_DAILY_PUBLIC_RESPONSES", &c.SurveyDailyPublic}, {"SURVEY_PUBLIC_PER_ADDRESS_PER_DAY", &c.SurveyPublicPerAddress}} {
		if v := getenv(f.name); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 1_000_000 {
				return c, fmt.Errorf("%s must be a number from 1 to 1000000", f.name)
			}
			*f.dst = n
		}
	}
	c.SecretsKey = getenv("SECRETS_KEY")
	c.WebhooksAllowPrivate = getenv("WEBHOOKS_ALLOW_PRIVATE") == "true"
	if c.WebhooksAllowPrivate && c.Env == "production" {
		return c, fmt.Errorf("WEBHOOKS_ALLOW_PRIVATE is for local development and is refused when APP_ENV=production")
	}
	c.PublicAPIURL = strings.TrimRight(getenv("PUBLIC_API_URL"), "/")
	c.SlackClientID, c.SlackClientSecret, c.SlackSigningSecret = getenv("SLACK_CLIENT_ID"), getenv("SLACK_CLIENT_SECRET"), getenv("SLACK_SIGNING_SECRET")
	c.SlackAPIBase, c.SlackAuthorizeURL, c.GitHubAPIBase = getenv("SLACK_API_BASE"), getenv("SLACK_AUTHORIZE_URL"), getenv("GITHUB_API_BASE")
	c.LinearAPIBase, c.JiraAPIBase = getenv("LINEAR_API_BASE"), getenv("JIRA_API_BASE")
	c.HubSpotAPIBase = getenv("HUBSPOT_API_BASE")
	c.ClickUpAPIBase, c.AsanaAPIBase, c.AzureAPIBase = getenv("CLICKUP_API_BASE"), getenv("ASANA_API_BASE"), getenv("AZURE_DEVOPS_API_BASE")
	c.IntegrationsEnabled = or(getenv("INTEGRATIONS_ENABLED"), "slack,github")
	if c.SecretsKey != "" {
		if k, err := base64.StdEncoding.DecodeString(c.SecretsKey); err != nil || len(k) != 32 {
			if k2, err2 := base64.RawURLEncoding.DecodeString(c.SecretsKey); err2 != nil || len(k2) != 32 {
				return c, fmt.Errorf("SECRETS_KEY must be 32 random bytes, base64 encoded (for example: openssl rand -base64 32)")
			}
		}
	}
	if n := btoi(c.SlackClientID != "") + btoi(c.SlackClientSecret != "") + btoi(c.SlackSigningSecret != ""); n != 0 && n != 3 {
		return c, fmt.Errorf("SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET must all be set together")
	}
	if c.SlackClientID != "" && c.SecretsKey == "" {
		return c, fmt.Errorf("SECRETS_KEY is required to connect Slack: tokens are stored encrypted")
	}
	c.StripeSecretKey, c.StripeWebhookSecret, c.StripeAPIBase, c.PlansConfig = getenv("STRIPE_SECRET_KEY"), getenv("STRIPE_WEBHOOK_SECRET"), getenv("STRIPE_API_BASE"), getenv("PLANS_CONFIG")
	if c.StripeSecretKey != "" {
		if c.StripeWebhookSecret == "" {
			return c, fmt.Errorf("STRIPE_WEBHOOK_SECRET is required with STRIPE_SECRET_KEY: payment notifications must be verified")
		}
		if !strings.HasPrefix(c.StripeSecretKey, "sk_") && !strings.HasPrefix(c.StripeSecretKey, "rk_") {
			return c, fmt.Errorf("STRIPE_SECRET_KEY must be a Stripe secret or restricted key")
		}
		if c.Env != "production" && (strings.HasPrefix(c.StripeSecretKey, "sk_live_") || strings.HasPrefix(c.StripeSecretKey, "rk_live_")) {
			return c, fmt.Errorf("a live Stripe key is only accepted when APP_ENV=production: use a test key (sk_test_...) here so nothing real is ever charged")
		}
		if !strings.HasPrefix(c.StripeWebhookSecret, "whsec_") {
			return c, fmt.Errorf("STRIPE_WEBHOOK_SECRET must be the signing secret Stripe shows for the endpoint (whsec_...)")
		}
	}
	c.MetricsToken = getenv("METRICS_TOKEN")
	if c.MetricsToken != "" && len(c.MetricsToken) < 32 {
		return c, fmt.Errorf("METRICS_TOKEN must be at least 32 characters")
	}
	if c.AlertWebhookURL != "" {
		if err := ops.ValidWebhookURL(c.AlertWebhookURL); err != nil {
			return c, err
		}
	}
	if v := getenv("TRUSTED_PROXY_HOPS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > 5 {
			return c, fmt.Errorf("TRUSTED_PROXY_HOPS must be a number from 0 to 5")
		}
		c.TrustedProxyHops = n
	}
	c.MediaDir = getenv("MEDIA_DIR")
	c.S3 = S3Config{Endpoint: getenv("STORAGE_S3_ENDPOINT"), Region: getenv("STORAGE_S3_REGION"), Bucket: getenv("STORAGE_S3_BUCKET"),
		AccessKeyID: getenv("STORAGE_S3_ACCESS_KEY_ID"), SecretAccessKey: getenv("STORAGE_S3_SECRET_ACCESS_KEY")}
	if c.S3.Bucket != "" || c.S3.AccessKeyID != "" || c.S3.SecretAccessKey != "" {
		if c.S3.Bucket == "" || c.S3.Region == "" || c.S3.AccessKeyID == "" || c.S3.SecretAccessKey == "" {
			return c, fmt.Errorf("STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY must all be set together")
		}
		if c.S3.Endpoint != "" && !strings.HasPrefix(c.S3.Endpoint, "https://") && c.Env == "production" {
			return c, fmt.Errorf("STORAGE_S3_ENDPOINT must be https in production")
		}
		if c.MediaDir != "" {
			return c, fmt.Errorf("set either MEDIA_DIR (local disk) or the STORAGE_S3_* settings, not both")
		}
	}
	c.TranscribeModel = or(getenv("TRANSCRIBE_MODEL"), "whisper-1")
	c.TranscribeBaseURL = or(getenv("TRANSCRIBE_BASE_URL"), "https://api.openai.com/v1")
	if v := getenv("TRANSCRIBE_PRICE_PER_MINUTE_USD"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f < 0 || f > 10 {
			return c, fmt.Errorf("TRANSCRIBE_PRICE_PER_MINUTE_USD must be a number from 0 to 10")
		}
		c.TranscribePricePerMinuteUSD = f
	}
	for _, f := range []struct {
		name string
		dst  *int64
	}{{"MAX_UPLOAD_BYTES", &c.MaxUploadBytes}, {"TRANSCRIBE_MAX_BYTES", &c.TranscribeMaxSize}} {
		if v := getenv(f.name); v != "" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || n <= 0 {
				return c, fmt.Errorf("%s must be a positive integer", f.name)
			}
			*f.dst = n
		}
	}
	if c.UnsubscribeSecret != "" && len(c.UnsubscribeSecret) < 32 {
		return c, fmt.Errorf("UNSUBSCRIBE_SECRET must be at least 32 characters")
	}
	if c.Env == "production" {
		for name, v := range map[string]string{"STRIPE_API_BASE": c.StripeAPIBase, "SLACK_API_BASE": c.SlackAPIBase, "SLACK_AUTHORIZE_URL": c.SlackAuthorizeURL, "GITHUB_API_BASE": c.GitHubAPIBase, "LINEAR_API_BASE": c.LinearAPIBase, "JIRA_API_BASE": c.JiraAPIBase, "HUBSPOT_API_BASE": c.HubSpotAPIBase, "CLICKUP_API_BASE": c.ClickUpAPIBase, "ASANA_API_BASE": c.AsanaAPIBase, "AZURE_DEVOPS_API_BASE": c.AzureAPIBase, "PUBLIC_API_URL": c.PublicAPIURL} {
			if v != "" && !strings.HasPrefix(v, "https://") {
				return c, fmt.Errorf("%s must be https in production", name)
			}
		}
		if getenv("TRUSTED_PROXY_HOPS") == "" {
			return c, fmt.Errorf("TRUSTED_PROXY_HOPS must be set in production (0 if nothing sits in front of the API): without it every visitor behind a proxy shares one rate-limit bucket")
		}
		if !strings.HasPrefix(c.JWKSURL, "https://") || !strings.HasPrefix(c.JWTIssuer, "https://") {
			return c, fmt.Errorf("SUPABASE_JWKS_URL and JWT_ISSUER must be https in production")
		}
		if len(c.UnsubscribeSecret) < 32 || !strings.HasPrefix(c.PublicBaseURL, "https://") {
			return c, fmt.Errorf("UNSUBSCRIBE_SECRET (32+ characters) and an https PUBLIC_BASE_URL are required in production")
		}
		if c.ResendAPIKey != "" && c.ResendWebhookSecret == "" {
			return c, fmt.Errorf("RESEND_WEBHOOK_SECRET is required in production when email is switched on: bounces and complaints must stop further mail")
		}
		if c.DatabaseURL == "" || c.JWKSURL == "" || c.JWTIssuer == "" {
			return c, fmt.Errorf("DATABASE_URL, SUPABASE_JWKS_URL and JWT_ISSUER are required in production")
		}
		if c.Mode == ModeWorker && c.AIConfigPath == "" {
			return c, fmt.Errorf("AI_CONFIG is required for the worker in production")
		}
	}
	if c.ResendWebhookSecret != "" {
		k, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(c.ResendWebhookSecret, "whsec_"))
		if err != nil || len(k) < 16 {
			return c, fmt.Errorf("RESEND_WEBHOOK_SECRET must be the full secret from the provider (whsec_ followed by at least 16 bytes of base64)")
		}
	}
	for _, u := range []string{c.DatabaseURL, c.DatabaseDirectURL} {
		if strings.Contains(u, "service_role") {
			return c, fmt.Errorf("database URLs must use the restricted application role, never service_role")
		}
	}
	return c, nil
}

// MediaEnabled is true when recordings have somewhere to be stored.
func (c Config) MediaEnabled() bool { return c.MediaDir != "" || c.S3.Bucket != "" }

func or(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// FromOS is Load(os.Getenv).
func FromOS() (Config, error) { return Load(os.Getenv) }

// S3Config is the bucket recordings are stored in. All four of bucket, region and both keys are needed.
type S3Config struct {
	Endpoint        string // empty for AWS itself
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
}

func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}
