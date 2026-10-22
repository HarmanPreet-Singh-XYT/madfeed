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
	if c.Env == "production" {
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
