package langchain

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmc/langchaingo/llms/anthropic"
	"github.com/tmc/langchaingo/llms/openai"

	"product/api/internal/ai"
)

func validConfig() FileConfig {
	r := func(p, m string) []RouteConfig {
		return []RouteConfig{{Provider: p, Model: m, InputPerM: 1, OutputPerM: 2}}
	}
	return FileConfig{Tiers: map[string][]RouteConfig{
		"small": r("google", "g-small"), "mid": r("anthropic", "a-mid"), "large": r("openai", "o-large"),
	}}
}

func TestConfigValidation(t *testing.T) {
	if err := validConfig().Validate(); err != nil {
		t.Fatal(err)
	}
	bad := map[string]func(*FileConfig){
		"placeholder model": func(c *FileConfig) { c.Tiers["mid"][0].Model = "REPLACE_ME" },
		"empty model":       func(c *FileConfig) { c.Tiers["mid"][0].Model = "" },
		"unknown provider":  func(c *FileConfig) { c.Tiers["mid"][0].Provider = "acme" },
		"missing tier":      func(c *FileConfig) { delete(c.Tiers, "large") },
		"extra tier":        func(c *FileConfig) { c.Tiers["huge"] = c.Tiers["mid"] },
		"negative price":    func(c *FileConfig) { c.Tiers["mid"][0].OutputPerM = -1 },
	}
	for name, mut := range bad {
		c := validConfig()
		mut(&c)
		if c.Validate() == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestLoadConfigRejectsUnknownFieldsAndShippedExampleStillNeedsEditing(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "c.json")
	_ = os.WriteFile(p, []byte(`{"tiers":{},"typo":1}`), 0o600)
	if _, err := LoadConfig(p); err == nil {
		t.Error("unknown field accepted")
	}
	if _, err := LoadConfig("../../../config/ai.example.json"); err == nil || !strings.Contains(err.Error(), "real model id") {
		t.Errorf("example config must be refused until placeholders are replaced, got %v", err)
	}
}

func TestRouterUsesOnlyProvidersWithKeys(t *testing.T) {
	env := func(k string) string {
		if k == "ANTHROPIC_API_KEY" || k == "OPENAI_API_KEY" {
			return "test-key"
		}
		return ""
	}
	c := validConfig()
	c.Tiers["small"] = append(c.Tiers["small"], RouteConfig{Provider: "openai", Model: "o-small"})
	r, warnings, err := NewRouter(context.Background(), c, env, nil)
	if err != nil || r == nil {
		t.Fatalf("%v", err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "GOOGLE_API_KEY") {
		t.Fatalf("warnings: %v", warnings)
	}
	// A tier whose only provider has no key is a startup error, not a runtime surprise.
	if _, _, err := NewRouter(context.Background(), validConfig(), func(string) string { return "" }, nil); err == nil {
		t.Fatal("no keys at all must fail")
	}
}

func TestGoogleProviderBuildsWithAKey(t *testing.T) {
	if _, _, err := NewRouter(context.Background(), validConfig(), func(string) string { return "test-key" }, nil); err != nil {
		t.Fatalf("all three providers should initialise: %v", err)
	}
}

// Wire tests: real langchaingo provider code against canned vendor responses,
// proving usage and cached-token fields really arrive where the adapter reads them.

func serve(t *testing.T, body string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestOpenAIWireUsageAndCache(t *testing.T) {
	url := serve(t, `{"id":"x","object":"chat.completion","model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],
		"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13,"prompt_tokens_details":{"cached_tokens":4}}}`)
	m, err := openai.New(openai.WithToken("k"), openai.WithBaseURL(url), openai.WithModel("m"))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := New("openai", m).Complete(context.Background(), ai.Request{Model: "m", Messages: []ai.Message{{Role: ai.RoleUser, Text: "ping"}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != "pong" || resp.Usage.InputTokens != 10 || resp.Usage.OutputTokens != 3 {
		t.Fatalf("%+v", resp)
	}
	t.Logf("openai cached tokens read as %d (expect 4)", resp.Usage.CachedInputTokens)
	if resp.Usage.CachedInputTokens != 4 {
		t.Errorf("cached tokens not picked up: %+v", resp.Usage)
	}
}

func TestAnthropicWireUsageAndCache(t *testing.T) {
	url := serve(t, `{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[{"type":"text","text":"pong"}],"stop_reason":"end_turn",
		"usage":{"input_tokens":10,"output_tokens":3,"cache_read_input_tokens":4}}`)
	m, err := anthropic.New(anthropic.WithToken("k"), anthropic.WithBaseURL(url), anthropic.WithModel("m"))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := New("anthropic", m).Complete(context.Background(), ai.Request{Model: "m", MaxTokens: 20, Messages: []ai.Message{{Role: ai.RoleUser, Text: "ping"}}})
	if err != nil {
		t.Fatal(err)
	}
	// Anthropic reports input excluding cache reads; we normalise to total input.
	want := ai.Usage{InputTokens: 14, OutputTokens: 3, CachedInputTokens: 4}
	if resp.Text != "pong" || resp.Usage != want {
		t.Fatalf("got %+v want usage %+v", resp, want)
	}
	// 10 uncached + 4 cached, priced separately: 10*3 + 4*0.3 + 3*15 per million.
	cost := ai.Price{InputPerM: 3, OutputPerM: 15, CachedInputPerM: 0.3}.Cost(resp.Usage)
	if d := cost - (10*3+4*0.3+3*15)/1e6; d > 1e-12 || d < -1e-12 {
		t.Errorf("cost %v", cost)
	}
}

func TestVendorErrorsMapToFallbackClasses(t *testing.T) {
	for status, want := range map[int]error{429: ai.ErrRateLimited, 401: ai.ErrAuth, 400: ai.ErrBadRequest, 503: ai.ErrUnavailable} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":{"message":"x","type":"t"}}`))
		}))
		m, _ := openai.New(openai.WithToken("k"), openai.WithBaseURL(srv.URL), openai.WithModel("m"))
		_, err := New("openai", m).Complete(context.Background(), ai.Request{Model: "m", Messages: []ai.Message{{Role: ai.RoleUser, Text: "x"}}})
		srv.Close()
		if !isErr(err, want) {
			t.Errorf("openai http %d: got %v, want class %v", status, err, want)
		}
	}
}

func isErr(err, target error) bool {
	return err != nil && strings.Contains(err.Error(), target.Error())
}

func TestPlainErrorClassification(t *testing.T) {
	cases := map[string]error{
		"API returned unexpected status code: 529: overloaded":          ai.ErrUnavailable,
		"API returned unexpected status code: 413: too big":             ai.ErrBadRequest,
		"API returned unexpected status code: 403: forbidden":           ai.ErrAuth,
		"rpc error: code = ResourceExhausted desc = RESOURCE_EXHAUSTED": ai.ErrRateLimited,
		"googleapi: Error 400: API key not valid":                       ai.ErrAuth,
		"INVALID_ARGUMENT: bad schema":                                  ai.ErrBadRequest,
		"dial tcp: connection refused":                                  ai.ErrUnavailable,
	}
	for msg, want := range cases {
		if got := classifyPlain(errors.New(msg)); !errors.Is(got, want) {
			t.Errorf("%q: got %v want %v", msg, got, want)
		}
	}
}

func TestDeepSeekUsesOpenAIClientAtItsBaseURLAndCustomerDataFlag(t *testing.T) {
	// Config: omitted flag means allowed; explicit false means not.
	var c FileConfig
	if err := json.Unmarshal([]byte(`{"tiers":{"small":[{"provider":"deepseek","model":"m","allow_customer_data":false},{"provider":"openai","model":"m"}]}}`), &c); err != nil {
		t.Fatal(err)
	}
	if *c.Tiers["small"][0].AllowCustomerData != false || c.Tiers["small"][1].AllowCustomerData != nil {
		t.Fatal("flag parsing")
	}

	cfg := validConfig()
	cfg.Tiers["small"] = []RouteConfig{{Provider: "deepseek", Model: "deepseek-flash", AllowCustomerData: new(bool)}}
	r, _, err := NewRouter(context.Background(), cfg, func(string) string { return "k" }, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Customer data must not be sent to the unapproved DeepSeek route.
	if _, err := r.Complete(context.Background(), ai.TierSmall, ai.Request{ContainsCustomerData: true}); !errors.Is(err, ai.ErrNoRoute) {
		t.Fatalf("got %v", err)
	}

	// Wire: the OpenAI client posts to {baseURL}/chat/completions, which is DeepSeek's format.
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_, _ = w.Write([]byte(`{"id":"x","object":"chat.completion","model":"deepseek-flash","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}`))
	}))
	defer srv.Close()
	m, _ := openai.New(openai.WithToken("k"), openai.WithBaseURL(srv.URL))
	if resp, err := New("deepseek", m).Complete(context.Background(), ai.Request{Model: "deepseek-flash", Messages: []ai.Message{{Role: ai.RoleUser, Text: "x"}}}); err != nil || resp.Text != "pong" {
		t.Fatalf("%+v %v", resp, err)
	}
	if path != "/chat/completions" {
		t.Errorf("posted to %q", path)
	}
}

func TestNebiusSpeaksOpenAIWireAndAllowsCustomerData(t *testing.T) {
	// The Nebius route carries the extraction prompts, which contain customer
	// conversation text, so the default (no allow_customer_data flag) must let it.
	const modelID = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
	var path, posted string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		var body struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		posted = body.Model
		_, _ = w.Write([]byte(`{"id":"x","object":"chat.completion","model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500}}`))
	}))
	defer srv.Close()

	env := func(k string) string {
		switch k {
		case "NEBIUS_API_KEY":
			return "k"
		case "NEBIUS_API_BASE":
			return srv.URL
		}
		return ""
	}
	cfg := FileConfig{Tiers: map[string][]RouteConfig{}}
	for _, tier := range []string{"small", "mid", "large"} {
		cfg.Tiers[tier] = []RouteConfig{{Provider: "nebius", Model: modelID, InputPerM: 0.06, OutputPerM: 0.24}}
	}
	r, warnings, err := NewRouter(context.Background(), cfg, env, nil)
	if err != nil {
		t.Fatalf("%v (warnings %v)", err, warnings)
	}
	resp, err := r.Complete(context.Background(), ai.TierMid, ai.Request{ContainsCustomerData: true, Messages: []ai.Message{{Role: ai.RoleUser, Text: "the export button is broken"}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != "pong" || resp.Provider != "nebius" || resp.Model != modelID || posted != modelID {
		t.Fatalf("resp %+v, posted model %q", resp, posted)
	}
	if path != "/chat/completions" {
		t.Errorf("posted to %q", path)
	}
	// 1000 input at 0.06/M plus 500 output at 0.24/M.
	price := ai.Price{InputPerM: 0.06, OutputPerM: 0.24}
	if cost, want := price.Cost(resp.Usage), (1000*0.06+500*0.24)/1e6; cost != want {
		t.Errorf("cost %v want %v", cost, want)
	}
}

func TestNebiusBuildsWithItsDefaultBaseURL(t *testing.T) {
	if _, err := newModel(context.Background(), "nebius", "k", func(string) string { return "" }); err != nil {
		t.Fatal(err)
	}
}
