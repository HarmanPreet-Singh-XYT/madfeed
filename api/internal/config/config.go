// Package config loads runtime settings from the environment and fails fast
// on anything missing or malformed. No secrets have defaults.
package config

import (
	"fmt"
	"os"
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

	AIConfigPath   string // tier/route file; see config/ai.example.json
	DailyIngestMax int64  // bytes per workspace per 24h; 0 = built-in default

	// Email and public links. Every outgoing message carries a signed
	// unsubscribe link, so the secret and the public address are required in
	// production even before email is switched on.
	PublicBaseURL     string // where people open the web app, no trailing slash
	UnsubscribeSecret string
	ResendAPIKey      string
	ResendBaseURL     string // optional: point at a test server
	EmailFromAddress  string // a verified sending address
	EmailReplyTo      string // optional

	// Recordings. MediaDir switches uploads on and names the folder files are
	// kept in (development storage; a production bucket plugs in behind
	// internal/storage). Transcription uses the OpenAI audio protocol with
	// OPENAI_API_KEY; TranscribeBaseURL lets tests point at a local stand-in.
	MediaDir          string
	MaxUploadBytes    int64 // 0 = built-in default (1 GiB)
	TranscribeModel   string
	TranscribeBaseURL string
	TranscribeMaxSize int64 // the vendor's file size limit; 0 = built-in default

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
	c.MediaDir = getenv("MEDIA_DIR")
	c.TranscribeModel = or(getenv("TRANSCRIBE_MODEL"), "whisper-1")
	c.TranscribeBaseURL = or(getenv("TRANSCRIBE_BASE_URL"), "https://api.openai.com/v1")
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
		if len(c.UnsubscribeSecret) < 32 || !strings.HasPrefix(c.PublicBaseURL, "https://") {
			return c, fmt.Errorf("UNSUBSCRIBE_SECRET (32+ characters) and an https PUBLIC_BASE_URL are required in production")
		}
		if c.DatabaseURL == "" || c.JWKSURL == "" || c.JWTIssuer == "" {
			return c, fmt.Errorf("DATABASE_URL, SUPABASE_JWKS_URL and JWT_ISSUER are required in production")
		}
		if c.Mode == ModeWorker && c.AIConfigPath == "" {
			return c, fmt.Errorf("AI_CONFIG is required for the worker in production")
		}
	}
	for _, u := range []string{c.DatabaseURL, c.DatabaseDirectURL} {
		if strings.Contains(u, "service_role") {
			return c, fmt.Errorf("database URLs must use the restricted application role, never service_role")
		}
	}
	return c, nil
}

func or(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// FromOS is Load(os.Getenv).
func FromOS() (Config, error) { return Load(os.Getenv) }
