// Package langchain adapts any langchaingo model (Anthropic, OpenAI, Google,
// Mistral, Ollama, Bedrock, ...) to ai.Provider. langchaingo is a community
// port, so it is used only for the vendor plumbing: routing, fallback, cost
// and schema validation stay in package ai and here. No langchaingo type
// leaves this package.
package langchain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/tmc/langchaingo/llms"

	"product/api/internal/ai"
)

type Adapter struct {
	name  string
	model llms.Model
}

// New wraps a langchaingo model under a provider name used in config routes.
func New(name string, m llms.Model) *Adapter { return &Adapter{name: name, model: m} }

func (a *Adapter) Name() string { return a.name }

var _ ai.Provider = (*Adapter)(nil)

func (a *Adapter) Complete(ctx context.Context, req ai.Request) (ai.Response, error) {
	msgs := make([]llms.MessageContent, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, llms.TextParts(llms.ChatMessageTypeSystem, req.System))
	}
	for _, m := range req.Messages {
		role := llms.ChatMessageTypeHuman
		if m.Role == ai.RoleAssistant {
			role = llms.ChatMessageTypeAI
		}
		msgs = append(msgs, llms.TextParts(role, m.Text))
	}

	opts := []llms.CallOption{llms.WithModel(req.Model)}
	if req.MaxTokens > 0 {
		opts = append(opts, llms.WithMaxTokens(req.MaxTokens))
	}
	var schema *jsonschema.Schema
	if len(req.Schema) > 0 {
		s, err := compile(req.Schema)
		if err != nil {
			return ai.Response{}, fmt.Errorf("%w: invalid schema: %v", ai.ErrBadRequest, err)
		}
		schema = s
		opts = append(opts, llms.WithJSONMode())
	}

	out, err := a.model.GenerateContent(ctx, msgs, opts...)
	if err != nil {
		return ai.Response{}, mapError(ctx, err)
	}
	if out == nil || len(out.Choices) == 0 {
		return ai.Response{}, fmt.Errorf("%w: empty response", ai.ErrUnavailable)
	}
	ch := out.Choices[0]
	resp := ai.Response{Text: ch.Content, FinishReason: ch.StopReason, Usage: usage(ch.GenerationInfo)}

	if schema != nil {
		raw := json.RawMessage(bytes.TrimSpace([]byte(ch.Content)))
		v, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			return resp, fmt.Errorf("%w: not JSON", ai.ErrInvalidOutput)
		}
		if err := schema.Validate(v); err != nil {
			return resp, fmt.Errorf("%w", ai.ErrInvalidOutput)
		}
		resp.JSON = raw
	}
	return resp, nil
}

func compile(raw json.RawMessage) (*jsonschema.Schema, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource("schema.json", doc); err != nil {
		return nil, err
	}
	return c.Compile("schema.json")
}

// mapError turns langchaingo's standardised error codes into package ai's.
// Unclassified errors are treated as transient outages (network failures
// usually are); the original error is kept for logs but must not be shown to
// users.
func mapError(ctx context.Context, err error) error {
	// Our own request was cancelled or timed out: stop, do not try other routes.
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var e *llms.Error
	if !errors.As(err, &e) {
		if errors.Is(err, context.Canceled) {
			return err
		}
		return classifyPlain(err)
	}
	switch e.Code {
	case llms.ErrCodeRateLimit, llms.ErrCodeQuotaExceeded:
		return fmt.Errorf("%w: %v", ai.ErrRateLimited, err)
	case llms.ErrCodeAuthentication:
		return fmt.Errorf("%w: %v", ai.ErrAuth, err)
	case llms.ErrCodeContentFilter:
		return fmt.Errorf("%w: %v", ai.ErrRefused, err)
	case llms.ErrCodeInvalidRequest, llms.ErrCodeTokenLimit, llms.ErrCodeResourceNotFound, llms.ErrCodeNotImplemented:
		return fmt.Errorf("%w: %v", ai.ErrBadRequest, err)
	case llms.ErrCodeCanceled:
		return context.Canceled
	default: // a provider-side timeout, provider_unavailable, unknown
		return fmt.Errorf("%w: %v", ai.ErrUnavailable, err)
	}
}

// usage normalises token counts. ai.Usage.InputTokens always means TOTAL input
// including cached tokens, because Price.Cost subtracts the cached part.
// Providers differ: Anthropic reports input excluding cache reads/writes
// ("InputTokens", separate cache keys); OpenAI and Gemini report prompt totals
// that include cached tokens ("PromptTokens"). Cache *writes* (Anthropic) are
// counted at the normal input rate, a small underestimate of their surcharge.
func usage(info map[string]any) ai.Usage {
	if _, anthropicStyle := info["InputTokens"]; anthropicStyle {
		read := num(info, "CacheReadInputTokens")
		return ai.Usage{
			InputTokens:       num(info, "InputTokens") + read + num(info, "CacheCreationInputTokens"),
			OutputTokens:      num(info, "OutputTokens"),
			CachedInputTokens: read,
		}
	}
	return ai.Usage{
		InputTokens:       num(info, "PromptTokens"),
		OutputTokens:      num(info, "CompletionTokens"),
		CachedInputTokens: num(info, "PromptCachedTokens", "CachedTokens", "CacheReadInputTokens"),
	}
}

func num(info map[string]any, keys ...string) int {
	for _, k := range keys {
		switch v := info[k].(type) {
		case int:
			return v
		case int32:
			return int(v)
		case int64:
			return int(v)
		case float64:
			return int(v)
		}
	}
	return 0
}

// OpenAI and Anthropic clients in langchaingo return plain errors such as
// "API returned unexpected status code: 429: ...", with no type or code.
// We classify by that status number (pinned by wire tests, so a format change
// in a future langchaingo fails the build) and, for Gemini, by the vendor's
// status words (best effort, not yet verified against the live service).
var statusRe = regexp.MustCompile(`status code: (\d{3})`)

func classifyPlain(err error) error {
	if m := statusRe.FindStringSubmatch(err.Error()); m != nil {
		code, _ := strconv.Atoi(m[1])
		switch {
		case code == 429:
			return fmt.Errorf("%w: %v", ai.ErrRateLimited, err)
		case code == 401 || code == 403:
			return fmt.Errorf("%w: %v", ai.ErrAuth, err)
		case code == 408 || code >= 500:
			return fmt.Errorf("%w: %v", ai.ErrUnavailable, err)
		case code >= 400:
			return fmt.Errorf("%w: %v", ai.ErrBadRequest, err)
		}
	}
	low := strings.ToLower(err.Error())
	switch {
	case strings.Contains(low, "resource_exhausted") || strings.Contains(low, "quota"):
		return fmt.Errorf("%w: %v", ai.ErrRateLimited, err)
	case strings.Contains(low, "unauthenticated") || strings.Contains(low, "permission_denied") || strings.Contains(low, "api key not valid"):
		return fmt.Errorf("%w: %v", ai.ErrAuth, err)
	case strings.Contains(low, "invalid_argument"):
		return fmt.Errorf("%w: %v", ai.ErrBadRequest, err)
	}
	// Unclassified (network failure, unknown vendor error): assume transient.
	return fmt.Errorf("%w: %v", ai.ErrUnavailable, err)
}
