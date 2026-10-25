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
		"SUPABASE_JWKS_URL": "https://x.example/jwks", "JWT_ISSUER": "https://x.example/auth/v1", "TRUSTED_PROXY_HOPS": "0",
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
		"SUPABASE_JWKS_URL": "https://x.example/jwks", "JWT_ISSUER": "https://x.example/auth/v1", "TRUSTED_PROXY_HOPS": "0"}
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

func TestProductionNeedsABounceHandlerBeforeEmailIsOn(t *testing.T) {
	base := map[string]string{"APP_ENV": "production", "ALLOWED_ORIGINS": "https://app.example.com", "UNSUBSCRIBE_SECRET": strings.Repeat("s", 32),
		"PUBLIC_BASE_URL": "https://app.example.com", "DATABASE_URL": "postgres://u@h/db", "SUPABASE_JWKS_URL": "https://h/jwks", "JWT_ISSUER": "https://h/auth", "TRUSTED_PROXY_HOPS": "0"}
	with := func(extra map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	if _, err := Load(env(with(nil))); err != nil {
		t.Fatalf("no email: %v", err)
	}
	if _, err := Load(env(with(map[string]string{"RESEND_API_KEY": "re_x"}))); err == nil {
		t.Error("email on without a webhook secret was accepted")
	}
	if _, err := Load(env(with(map[string]string{"RESEND_API_KEY": "re_x", "RESEND_WEBHOOK_SECRET": "whsec_MfKQ9r8GZmUPuz3C0pVxQ2R2Xk1uJ6yH"}))); err != nil {
		t.Errorf("email on with a webhook secret: %v", err)
	}
}

func TestProductionRefusesGuessableOrInsecureSecurityBasics(t *testing.T) {
	base := func() map[string]string {
		return map[string]string{"APP_ENV": "production", "ALLOWED_ORIGINS": "https://a.example", "UNSUBSCRIBE_SECRET": "0123456789abcdef0123456789abcdef",
			"PUBLIC_BASE_URL": "https://app.example", "DATABASE_URL": "postgres://app_api@db/app",
			"SUPABASE_JWKS_URL": "https://x.example/jwks", "JWT_ISSUER": "https://x.example/auth/v1", "TRUSTED_PROXY_HOPS": "0"}
	}
	load := func(m map[string]string) error { _, err := Load(func(k string) string { return m[k] }); return err }
	if err := load(base()); err != nil {
		t.Fatalf("the good configuration is refused: %v", err)
	}
	for name, mutate := range map[string]func(map[string]string){
		"no proxy count":     func(m map[string]string) { delete(m, "TRUSTED_PROXY_HOPS") },
		"plain http jwks":    func(m map[string]string) { m["SUPABASE_JWKS_URL"] = "http://x.example/jwks" },
		"plain http issuer":  func(m map[string]string) { m["JWT_ISSUER"] = "http://x.example/auth/v1" },
		"empty webhook key":  func(m map[string]string) { m["RESEND_API_KEY"] = "k"; m["RESEND_WEBHOOK_SECRET"] = "whsec_" },
		"short webhook key":  func(m map[string]string) { m["RESEND_API_KEY"] = "k"; m["RESEND_WEBHOOK_SECRET"] = "whsec_YWJj" },
		"non-base64 webhook": func(m map[string]string) { m["RESEND_API_KEY"] = "k"; m["RESEND_WEBHOOK_SECRET"] = "whsec_!!!" },
	} {
		m := base()
		mutate(m)
		if load(m) == nil {
			t.Errorf("%s was accepted in production", name)
		}
	}
}

func TestBucketStorageSettings(t *testing.T) {
	good := map[string]string{"STORAGE_S3_ENDPOINT": "https://s3.example.com", "STORAGE_S3_REGION": "us-east-1", "STORAGE_S3_BUCKET": "media", "STORAGE_S3_ACCESS_KEY_ID": "id", "STORAGE_S3_SECRET_ACCESS_KEY": "secret"}
	load := func(m map[string]string) (Config, error) { return Load(func(k string) string { return m[k] }) }
	c, err := load(good)
	if err != nil || !c.MediaEnabled() || c.S3.Bucket != "media" {
		t.Fatalf("good settings: %+v %v", c.S3, err)
	}
	for name, mutate := range map[string]func(map[string]string){
		"no secret key":     func(m map[string]string) { delete(m, "STORAGE_S3_SECRET_ACCESS_KEY") },
		"no region":         func(m map[string]string) { delete(m, "STORAGE_S3_REGION") },
		"key but no bucket": func(m map[string]string) { delete(m, "STORAGE_S3_BUCKET") },
		"disk and bucket":   func(m map[string]string) { m["MEDIA_DIR"] = "/tmp/x" },
	} {
		m := map[string]string{}
		for k, v := range good {
			m[k] = v
		}
		mutate(m)
		if _, err := load(m); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if _, err := load(map[string]string{}); err != nil {
		t.Errorf("no storage settings at all must be fine (uploads off): %v", err)
	}
}

func TestRateLimitSettings(t *testing.T) {
	load := func(m map[string]string) (Config, error) { return Load(func(k string) string { return m[k] }) }
	c, err := load(map[string]string{"RATE_PUBLIC_PER_MINUTE": "500", "RATE_READ_PER_MINUTE": "900", "RATE_WRITE_PER_MINUTE": "90"})
	if err != nil || c.RatePublic != 500 || c.RateRead != 900 || c.RateWrite != 90 {
		t.Fatalf("%+v %v", c, err)
	}
	if c, err := load(nil); err != nil || c.RatePublic != 0 {
		t.Errorf("unset must keep the defaults: %+v %v", c, err)
	}
	for _, bad := range []string{"0", "-5", "abc", "99999999"} {
		if _, err := load(map[string]string{"RATE_PUBLIC_PER_MINUTE": bad}); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestConnectionAndPaymentSettingsAreChecked(t *testing.T) {
	key := "ZTJlLXNlY3JldHMta2V5LXRoaXJ0eS10d28tYnl0ZXM="
	load := func(m map[string]string) error { _, err := Load(func(k string) string { return m[k] }); return err }
	prod := func(extra map[string]string) map[string]string {
		m := map[string]string{"APP_ENV": "production", "ALLOWED_ORIGINS": "https://a.example", "UNSUBSCRIBE_SECRET": "0123456789abcdef0123456789abcdef",
			"PUBLIC_BASE_URL": "https://app.example", "DATABASE_URL": "postgres://app_api@db/app", "SUPABASE_JWKS_URL": "https://x.example/jwks",
			"JWT_ISSUER": "https://x.example/auth/v1", "TRUSTED_PROXY_HOPS": "0"}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	ok := []map[string]string{
		{}, // nothing set: everything off
		{"SECRETS_KEY": key},
		{"SECRETS_KEY": key, "SLACK_CLIENT_ID": "i", "SLACK_CLIENT_SECRET": "s", "SLACK_SIGNING_SECRET": "g"},
		{"STRIPE_SECRET_KEY": "sk_test_abc", "STRIPE_WEBHOOK_SECRET": "whsec_abc"},
		{"STRIPE_SECRET_KEY": "rk_test_abc", "STRIPE_WEBHOOK_SECRET": "whsec_abc", "PLANS_CONFIG": "/etc/plans.json"},
	}
	for i, m := range ok {
		if err := load(m); err != nil {
			t.Errorf("good settings %d refused: %v", i, err)
		}
	}
	bad := map[string]map[string]string{
		"a short encryption key":             {"SECRETS_KEY": "c2hvcnQ="},
		"an encryption key that is not b64":  {"SECRETS_KEY": "!!!!"},
		"Slack with only an id":              {"SECRETS_KEY": key, "SLACK_CLIENT_ID": "i"},
		"Slack without an encryption key":    {"SLACK_CLIENT_ID": "i", "SLACK_CLIENT_SECRET": "s", "SLACK_SIGNING_SECRET": "g"},
		"Stripe without a signing secret":    {"STRIPE_SECRET_KEY": "sk_test_abc"},
		"a signing secret of the wrong kind": {"STRIPE_SECRET_KEY": "sk_test_abc", "STRIPE_WEBHOOK_SECRET": "abc"},
		"not a Stripe key":                   {"STRIPE_SECRET_KEY": "pk_test_abc", "STRIPE_WEBHOOK_SECRET": "whsec_abc"},
		"a live key outside production":      {"STRIPE_SECRET_KEY": "sk_live_abc", "STRIPE_WEBHOOK_SECRET": "whsec_abc"},
	}
	for name, m := range bad {
		if load(m) == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// production: a live key is fine, but the test-only address overrides must be https
	if err := load(prod(map[string]string{"STRIPE_SECRET_KEY": "sk_live_abc", "STRIPE_WEBHOOK_SECRET": "whsec_abc"})); err != nil {
		t.Errorf("a live key in production: %v", err)
	}
	for _, k := range []string{"STRIPE_API_BASE", "SLACK_API_BASE", "SLACK_AUTHORIZE_URL", "GITHUB_API_BASE", "LINEAR_API_BASE", "JIRA_API_BASE", "HUBSPOT_API_BASE", "CLICKUP_API_BASE", "ASANA_API_BASE", "AZURE_DEVOPS_API_BASE", "PUBLIC_API_URL"} {
		if load(prod(map[string]string{k: "http://insecure.example"})) == nil {
			t.Errorf("%s over plain http was accepted in production", k)
		}
		if err := load(prod(map[string]string{k: "https://ok.example"})); err != nil {
			t.Errorf("%s over https refused in production: %v", k, err)
		}
	}
}
