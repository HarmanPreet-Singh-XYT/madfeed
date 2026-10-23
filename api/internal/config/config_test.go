package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadDefaults(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Mode != ModeAPI || c.Env != "development" || c.Addr != ":8080" {
		t.Fatalf("unexpected defaults: %+v", c)
	}
}

func TestLoadRejects(t *testing.T) {
	cases := map[string]map[string]string{
		"bad mode":            {"APP_MODE": "both"},
		"bad env":             {"APP_ENV": "prod"},
		"wildcard origin":     {"ALLOWED_ORIGINS": "*"},
		"prod without origin": {"APP_ENV": "production"},
	}
	for name, m := range cases {
		if _, err := Load(env(m)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestLoadOrigins(t *testing.T) {
	c, err := Load(env(map[string]string{"ALLOWED_ORIGINS": "https://a.example, https://b.example"}))
	if err != nil || len(c.AllowedOrigins) != 2 {
		t.Fatalf("got %+v, %v", c.AllowedOrigins, err)
	}
}

func TestProductionRequiresDatabaseAndAuth(t *testing.T) {
	base := map[string]string{"APP_ENV": "production", "ALLOWED_ORIGINS": "https://a.example"}
	if _, err := Load(env(base)); err == nil {
		t.Error("production without database/auth accepted")
	}
	full := map[string]string{"APP_ENV": "production", "ALLOWED_ORIGINS": "https://a.example", "DATABASE_URL": "postgres://app_api@db/app",
		"SUPABASE_JWKS_URL": "https://x.example/jwks", "JWT_ISSUER": "https://x.example/auth/v1",
		"PUBLIC_BASE_URL": "https://app.example", "UNSUBSCRIBE_SECRET": "0123456789abcdef0123456789abcdef"}
	c, err := Load(env(full))
	if err != nil || c.JWTAudience != "authenticated" {
		t.Fatalf("%+v %v", c, err)
	}
	worker := map[string]string{"APP_MODE": "worker"}
	for k, v := range full {
		worker[k] = v
	}
	if _, err := Load(env(worker)); err == nil {
		t.Error("production worker without AI_CONFIG accepted")
	}
}

func TestRejectsServiceRoleDatabaseURLsAndBadQuota(t *testing.T) {
	if _, err := Load(env(map[string]string{"DATABASE_URL": "postgres://service_role:x@db/postgres"})); err == nil {
		t.Error("service_role URL accepted")
	}
	if _, err := Load(env(map[string]string{"DAILY_INGEST_MAX_BYTES": "-5"})); err == nil {
		t.Error("negative quota accepted")
	}
}

func TestEmailSettingsAreCheckedBeforeAnythingCanBeSent(t *testing.T) {
	prod := map[string]string{"APP_ENV": "production", "ALLOWED_ORIGINS": "https://a.example", "DATABASE_URL": "postgres://app_api@db/app",
		"SUPABASE_JWKS_URL": "https://x.example/jwks", "JWT_ISSUER": "https://x.example/auth/v1"}
	if _, err := Load(env(prod)); err == nil {
		t.Error("production without an unsubscribe secret and public address accepted")
	}
	prod["UNSUBSCRIBE_SECRET"], prod["PUBLIC_BASE_URL"] = "short", "https://app.example"
	if _, err := Load(env(prod)); err == nil {
		t.Error("a short secret accepted")
	}
	prod["UNSUBSCRIBE_SECRET"], prod["PUBLIC_BASE_URL"] = "0123456789abcdef0123456789abcdef", "http://app.example"
	if _, err := Load(env(prod)); err == nil {
		t.Error("an http public address accepted in production")
	}
	prod["PUBLIC_BASE_URL"] = "https://app.example/"
	c, err := Load(env(prod))
	if err != nil || c.PublicBaseURL != "https://app.example" {
		t.Fatalf("%+v %v", c, err)
	}
	if _, err := Load(env(map[string]string{"UNSUBSCRIBE_SECRET": "tooshort"})); err == nil {
		t.Error("a short secret accepted even in development")
	}
}

func TestWorkerQueues(t *testing.T) {
	c, err := Load(env(map[string]string{}))
	if err != nil || len(c.WorkerQueues) != 2 {
		t.Fatalf("default: %v %v", c.WorkerQueues, err)
	}
	c, err = Load(env(map[string]string{"WORKER_QUEUES": " research "}))
	if err != nil || len(c.WorkerQueues) != 1 || c.WorkerQueues[0] != "research" {
		t.Fatalf("%v %v", c.WorkerQueues, err)
	}
	for _, bad := range []string{"other", "default,,nope", ",", " "} {
		if _, err := Load(env(map[string]string{"WORKER_QUEUES": bad})); err == nil && strings.TrimSpace(bad) != "" {
			t.Errorf("%q accepted", bad)
		}
	}
}
