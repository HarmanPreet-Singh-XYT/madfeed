package langchain

import (
	"context"
	"errors"
	"testing"

	"github.com/tmc/langchaingo/llms"

	"product/api/internal/ai"
)

// stub is a langchaingo model we control.
type stub struct {
	content string
	info    map[string]any
	err     error

	gotMsgs []llms.MessageContent
	gotOpts llms.CallOptions
}

func (s *stub) Call(context.Context, string, ...llms.CallOption) (string, error) { return "", nil }
func (s *stub) GenerateContent(_ context.Context, m []llms.MessageContent, opts ...llms.CallOption) (*llms.ContentResponse, error) {
	s.gotMsgs = m
	s.gotOpts = llms.CallOptions{}
	for _, o := range opts {
		o(&s.gotOpts)
	}
	if s.err != nil {
		return nil, s.err
	}
	return &llms.ContentResponse{Choices: []*llms.ContentChoice{{Content: s.content, StopReason: "stop", GenerationInfo: s.info}}}, nil
}

func TestBuildsRequestAndReadsUsage(t *testing.T) {
	s := &stub{content: "hello", info: map[string]any{"PromptTokens": 100, "CompletionTokens": int32(40), "PromptCachedTokens": float64(30)}}
	resp, err := New("x", s).Complete(context.Background(), ai.Request{
		Model: "m1", System: "be brief", MaxTokens: 50,
		Messages: []ai.Message{{Role: ai.RoleUser, Text: "q"}, {Role: ai.RoleAssistant, Text: "a"}, {Role: ai.RoleUser, Text: "q2"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if s.gotOpts.Model != "m1" || s.gotOpts.MaxTokens != 50 || s.gotOpts.JSONMode {
		t.Fatalf("options: %+v", s.gotOpts)
	}
	if len(s.gotMsgs) != 4 || s.gotMsgs[0].Role != llms.ChatMessageTypeSystem || s.gotMsgs[2].Role != llms.ChatMessageTypeAI {
		t.Fatalf("messages: %+v", s.gotMsgs)
	}
	if resp.Text != "hello" || resp.Usage != (ai.Usage{InputTokens: 100, OutputTokens: 40, CachedInputTokens: 30}) {
		t.Fatalf("response: %+v", resp)
	}
}

const schema = `{"type":"object","required":["items"],"properties":{"items":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}`

func TestStructuredOutputIsValidatedAgainstSchema(t *testing.T) {
	good := &stub{content: ` {"items":["a","b"]} `}
	resp, err := New("x", good).Complete(context.Background(), ai.Request{Schema: []byte(schema)})
	if err != nil || string(resp.JSON) != `{"items":["a","b"]}` || !good.gotOpts.JSONMode {
		t.Fatalf("good: %v %+v json=%v", err, resp, good.gotOpts.JSONMode)
	}
	for name, content := range map[string]string{
		"not json":         "sure! here you go",
		"wrong shape":      `{"items":"a"}`,
		"missing required": `{}`,
		"extra field":      `{"items":[],"x":1}`,
	} {
		_, err := New("x", &stub{content: content}).Complete(context.Background(), ai.Request{Schema: []byte(schema)})
		if !errors.Is(err, ai.ErrInvalidOutput) {
			t.Errorf("%s: want ErrInvalidOutput, got %v", name, err)
		}
	}
	if _, err := New("x", good).Complete(context.Background(), ai.Request{Schema: []byte(`{"type": 5}`)}); !errors.Is(err, ai.ErrBadRequest) {
		t.Errorf("broken schema: got %v", err)
	}
}

func TestErrorMapping(t *testing.T) {
	cases := map[llms.ErrorCode]error{
		llms.ErrCodeRateLimit:           ai.ErrRateLimited,
		llms.ErrCodeQuotaExceeded:       ai.ErrRateLimited,
		llms.ErrCodeAuthentication:      ai.ErrAuth,
		llms.ErrCodeContentFilter:       ai.ErrRefused,
		llms.ErrCodeInvalidRequest:      ai.ErrBadRequest,
		llms.ErrCodeTokenLimit:          ai.ErrBadRequest,
		llms.ErrCodeProviderUnavailable: ai.ErrUnavailable,
		llms.ErrCodeTimeout:             ai.ErrUnavailable,
		llms.ErrCodeUnknown:             ai.ErrUnavailable,
	}
	for code, want := range cases {
		_, err := New("x", &stub{err: llms.NewError(code, "x", "boom")}).Complete(context.Background(), ai.Request{})
		if !errors.Is(err, want) {
			t.Errorf("%s: got %v want %v", code, err, want)
		}
	}
	if _, err := New("x", &stub{err: errors.New("dial tcp: refused")}).Complete(context.Background(), ai.Request{}); !errors.Is(err, ai.ErrUnavailable) {
		t.Errorf("plain error: got %v", err)
	}
	if _, err := New("x", &stub{err: context.Canceled}).Complete(context.Background(), ai.Request{}); !errors.Is(err, context.Canceled) {
		t.Errorf("cancel: got %v", err)
	}
}

func TestOwnContextCancellationStopsInsteadOfFallingBack(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := New("x", &stub{err: llms.NewError(llms.ErrCodeTimeout, "x", "late")}).Complete(ctx, ai.Request{})
	if !errors.Is(err, context.Canceled) || errors.Is(err, ai.ErrUnavailable) {
		t.Fatalf("got %v", err)
	}
}

func TestWorksUnderRouterWithFallback(t *testing.T) {
	primary := New("a", &stub{err: llms.NewError(llms.ErrCodeRateLimit, "a", "slow down")})
	backup := New("b", &stub{content: "ok", info: map[string]any{"PromptTokens": 10, "CompletionTokens": 5}})
	r, err := ai.NewRouter([]ai.Provider{primary, backup}, map[ai.Tier][]ai.Route{
		ai.TierMid: {{Provider: "a", Model: "ma"}, {Provider: "b", Model: "mb", Price: ai.Price{InputPerM: 1, OutputPerM: 2}}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := r.Complete(context.Background(), ai.TierMid, ai.Request{})
	if err != nil || resp.Provider != "b" || resp.Model != "mb" || resp.Text != "ok" {
		t.Fatalf("%+v %v", resp, err)
	}
}
