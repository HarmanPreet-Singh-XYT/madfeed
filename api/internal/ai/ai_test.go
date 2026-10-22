package ai

import (
	"context"
	"errors"
	"math"
	"sync"
	"testing"
)

type fake struct {
	name  string
	resp  Response
	err   error
	calls int
	seen  []string
}

func (f *fake) Name() string { return f.name }
func (f *fake) Complete(_ context.Context, r Request) (Response, error) {
	f.calls++
	f.seen = append(f.seen, r.Model)
	return f.resp, f.err
}

type rec struct {
	mu sync.Mutex
	ev []Event
}

func (r *rec) Record(_ context.Context, e Event) { r.mu.Lock(); r.ev = append(r.ev, e); r.mu.Unlock() }

func router(t *testing.T, a, b *fake, r *rec) *Router {
	t.Helper()
	var rc Recorder // avoid a typed-nil interface when r is nil
	if r != nil {
		rc = r
	}
	rt, err := NewRouter([]Provider{a, b}, map[Tier][]Route{
		TierMid: {
			{Provider: "a", Model: "a-mid", Price: Price{InputPerM: 3, OutputPerM: 15}},
			{Provider: "b", Model: "b-mid", Price: Price{InputPerM: 1, OutputPerM: 2}},
		},
	}, rc)
	if err != nil {
		t.Fatal(err)
	}
	return rt
}

func TestUsesFirstRouteAndRecordsCost(t *testing.T) {
	a := &fake{name: "a", resp: Response{Text: "hi", Usage: Usage{InputTokens: 1000, OutputTokens: 500}}}
	b := &fake{name: "b"}
	r := &rec{}
	resp, err := router(t, a, b, r).Complete(context.Background(), TierMid, Request{Task: "extraction", PromptVersion: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Provider != "a" || resp.Model != "a-mid" || b.calls != 0 {
		t.Fatalf("wrong routing: %+v b.calls=%d", resp, b.calls)
	}
	want := (1000*3.0 + 500*15.0) / 1e6
	if len(r.ev) != 1 || math.Abs(r.ev[0].CostUSD-want) > 1e-12 || r.ev[0].PromptVersion != "v1" || r.ev[0].Task != "extraction" {
		t.Fatalf("bad event: %+v want cost %v", r.ev, want)
	}
}

func TestFallsBackOnOutageAndRateLimitOnly(t *testing.T) {
	for _, err := range []error{ErrUnavailable, ErrRateLimited, ErrAuth} {
		a := &fake{name: "a", err: err}
		b := &fake{name: "b", resp: Response{Text: "ok"}}
		r := &rec{}
		resp, e := router(t, a, b, r).Complete(context.Background(), TierMid, Request{})
		if e != nil || resp.Provider != "b" || resp.Model != "b-mid" {
			t.Fatalf("%v: no fallback: %+v %v", err, resp, e)
		}
		if len(r.ev) != 2 || r.ev[0].Err == nil {
			t.Fatalf("both attempts must be recorded: %+v", r.ev)
		}
	}
	for _, err := range []error{ErrBadRequest, ErrRefused, ErrInvalidOutput} {
		a := &fake{name: "a", err: err}
		b := &fake{name: "b", resp: Response{Text: "ok"}}
		if _, e := router(t, a, b, nil).Complete(context.Background(), TierMid, Request{}); !errors.Is(e, err) || b.calls != 0 {
			t.Fatalf("%v must not fall back (b.calls=%d, err=%v)", err, b.calls, e)
		}
	}
}

func TestAllRoutesFailing(t *testing.T) {
	a, b := &fake{name: "a", err: ErrUnavailable}, &fake{name: "b", err: ErrUnavailable}
	if _, err := router(t, a, b, nil).Complete(context.Background(), TierMid, Request{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v", err)
	}
}

func TestConfigErrorsFailAtStartup(t *testing.T) {
	a := &fake{name: "a"}
	if _, err := NewRouter([]Provider{a}, map[Tier][]Route{TierMid: {{Provider: "typo", Model: "m"}}}, nil); err == nil {
		t.Error("unknown provider accepted")
	}
	if _, err := NewRouter([]Provider{a}, map[Tier][]Route{TierMid: {}}, nil); err == nil {
		t.Error("empty tier accepted")
	}
	r, _ := NewRouter([]Provider{a}, map[Tier][]Route{TierMid: {{Provider: "a", Model: "m"}}}, nil)
	if _, err := r.Complete(context.Background(), TierLarge, Request{}); err == nil {
		t.Error("unknown tier accepted")
	}
}

func TestCachedTokensArePricedSeparately(t *testing.T) {
	p := Price{InputPerM: 10, OutputPerM: 0, CachedInputPerM: 1}
	got := p.Cost(Usage{InputTokens: 1000, CachedInputTokens: 800})
	want := (200*10.0 + 800*1.0) / 1e6
	if math.Abs(got-want) > 1e-12 {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestCustomerDataOnlyGoesToApprovedRoutes(t *testing.T) {
	a := &fake{name: "a", resp: Response{Text: "a"}}
	b := &fake{name: "b", resp: Response{Text: "b"}}
	r, err := NewRouter([]Provider{a, b}, map[Tier][]Route{
		TierMid: {{Provider: "a", Model: "ma"}, {Provider: "b", Model: "mb", AllowCustomerData: true}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Customer data skips the unapproved first route entirely.
	resp, err := r.Complete(context.Background(), TierMid, Request{ContainsCustomerData: true})
	if err != nil || resp.Provider != "b" || a.calls != 0 {
		t.Fatalf("customer data reached an unapproved route: %+v err=%v a.calls=%d", resp, err, a.calls)
	}
	// Non-customer prompts may use the cheaper route.
	if resp, _ := r.Complete(context.Background(), TierMid, Request{}); resp.Provider != "a" {
		t.Fatalf("got %+v", resp)
	}
	// No approved route at all: refuse rather than send.
	only, _ := NewRouter([]Provider{a}, map[Tier][]Route{TierMid: {{Provider: "a", Model: "ma"}}}, nil)
	a.calls = 0
	if _, err := only.Complete(context.Background(), TierMid, Request{ContainsCustomerData: true}); !errors.Is(err, ErrNoRoute) || a.calls != 0 {
		t.Fatalf("want ErrNoRoute without calling the vendor, got %v (calls=%d)", err, a.calls)
	}
}
