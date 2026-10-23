package langchain

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/tmc/langchaingo/llms"
	"github.com/tmc/langchaingo/llms/anthropic"
	"github.com/tmc/langchaingo/llms/googleai"
	"github.com/tmc/langchaingo/llms/openai"

	"product/api/internal/ai"
)

// Provider names used in config routes, and the env var holding each key.
var keyEnv = map[string]string{
	"anthropic": "ANTHROPIC_API_KEY",
	"openai":    "OPENAI_API_KEY",
	"google":    "GOOGLE_API_KEY", // Gemini
	"deepseek":  "DEEPSEEK_API_KEY",
}

// DeepSeek speaks the OpenAI wire format, so it reuses that client.
const deepseekBaseURL = "https://api.deepseek.com"

// Placeholder shipped in the example config; the loader refuses it so a model
// ID is never guessed. Look up current IDs in each vendor's docs.
const placeholder = "REPLACE_ME"

type FileConfig struct {
	Tiers map[string][]RouteConfig `json:"tiers"`
}

type RouteConfig struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// USD per million tokens, from the vendor's price page.
	InputPerM       float64 `json:"input_per_m"`
	OutputPerM      float64 `json:"output_per_m"`
	CachedInputPerM float64 `json:"cached_input_per_m"`
	// AllowCustomerData defaults to true when omitted. Set false for any
	// vendor not yet approved to receive customer conversation content.
	AllowCustomerData *bool `json:"allow_customer_data"`
}

// LoadConfig reads and validates a tier/route file.
func LoadConfig(path string) (FileConfig, error) {
	raw, err := os.ReadFile(path) // #nosec G304 -- the path is the operator's own AI_CONFIG setting, never request input
	if err != nil {
		return FileConfig{}, err
	}
	var c FileConfig
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return c, fmt.Errorf("ai config: %w", err)
	}
	return c, c.Validate()
}

func (c FileConfig) Validate() error {
	for _, t := range []ai.Tier{ai.TierSmall, ai.TierMid, ai.TierLarge} {
		if len(c.Tiers[string(t)]) == 0 {
			return fmt.Errorf("ai config: tier %q has no routes", t)
		}
	}
	for tier, routes := range c.Tiers {
		if !slices.Contains([]string{"small", "mid", "large"}, tier) {
			return fmt.Errorf("ai config: unknown tier %q", tier)
		}
		for _, r := range routes {
			if _, ok := keyEnv[r.Provider]; !ok {
				return fmt.Errorf("ai config: tier %q: unknown provider %q", tier, r.Provider)
			}
			if r.Model == "" || r.Model == placeholder {
				return fmt.Errorf("ai config: tier %q provider %q: set a real model id (got %q)", tier, r.Provider, r.Model)
			}
			if r.InputPerM < 0 || r.OutputPerM < 0 || r.CachedInputPerM < 0 {
				return fmt.Errorf("ai config: tier %q provider %q: negative price", tier, r.Provider)
			}
		}
	}
	return nil
}

// NewRouter builds providers for every route whose API key is present and
// drops routes for providers without one (returning a warning for each), so
// the product runs with whichever providers are configured. It fails if that
// leaves any tier with no route.
func NewRouter(ctx context.Context, c FileConfig, getenv func(string) string, rec ai.Recorder) (*ai.Router, []string, error) {
	if err := c.Validate(); err != nil {
		return nil, nil, err
	}
	var warnings []string
	built := map[string]ai.Provider{}
	tiers := map[ai.Tier][]ai.Route{}
	for tier, routes := range c.Tiers {
		for _, r := range routes {
			key := getenv(keyEnv[r.Provider])
			if key == "" {
				warnings = append(warnings, fmt.Sprintf("tier %s: skipping %s/%s (%s not set)", tier, r.Provider, r.Model, keyEnv[r.Provider]))
				continue
			}
			if _, ok := built[r.Provider]; !ok {
				m, err := newModel(ctx, r.Provider, key)
				if err != nil {
					return nil, warnings, fmt.Errorf("ai: init %s: %w", r.Provider, err)
				}
				built[r.Provider] = New(r.Provider, m)
			}
			tiers[ai.Tier(tier)] = append(tiers[ai.Tier(tier)], ai.Route{
				Provider: r.Provider, Model: r.Model,
				Price:             ai.Price{InputPerM: r.InputPerM, OutputPerM: r.OutputPerM, CachedInputPerM: r.CachedInputPerM},
				AllowCustomerData: r.AllowCustomerData == nil || *r.AllowCustomerData,
			})
		}
		if len(tiers[ai.Tier(tier)]) == 0 {
			return nil, warnings, fmt.Errorf("ai: tier %q has no usable route: set an API key for one of its providers", tier)
		}
	}
	providers := make([]ai.Provider, 0, len(built))
	for _, p := range built {
		providers = append(providers, p)
	}
	r, err := ai.NewRouter(providers, tiers, rec)
	return r, warnings, err
}

func newModel(ctx context.Context, provider, key string) (llms.Model, error) {
	switch provider {
	case "anthropic":
		return anthropic.New(anthropic.WithToken(key))
	case "openai":
		return openai.New(openai.WithToken(key))
	case "google":
		return googleai.New(ctx, googleai.WithAPIKey(key))
	case "deepseek":
		return openai.New(openai.WithToken(key), openai.WithBaseURL(deepseekBaseURL))
	}
	return nil, fmt.Errorf("unknown provider %q", provider)
}
