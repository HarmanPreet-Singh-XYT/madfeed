package config

import "testing"

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
		"SUPABASE_JWKS_URL": "https://x.example/jwks", "JWT_ISSUER": "https://x.example/auth/v1"}
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
