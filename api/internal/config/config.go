// Package config loads runtime settings from the environment and fails fast
// on anything missing or malformed. No secrets have defaults.
package config

import (
	"fmt"
	"os"
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
