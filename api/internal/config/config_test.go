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
