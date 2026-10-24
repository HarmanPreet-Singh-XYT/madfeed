package api

import (
	"net/http/httptest"
	"testing"
	"time"

	"product/api/internal/devfakes"
)

// fakeStripe is the shared Stripe stand-in served on a local address.
type fakeStripe struct {
	*devfakes.Stripe
	srv *httptest.Server
}

func newFakeStripe(t *testing.T) *fakeStripe {
	f := &fakeStripe{Stripe: devfakes.NewStripe()}
	f.srv = httptest.NewServer(f.Handler())
	t.Cleanup(f.srv.Close)
	return f
}

func subJSON(id, customer, status, price string, cancelAtEnd bool, periodEnd time.Time) string {
	return devfakes.NewStripe().SubJSON(id, customer, status, price, cancelAtEnd, periodEnd)
}

func signedEvent(secret, id, typ string, created time.Time, object string) ([]byte, string) {
	return devfakes.SignedEvent(secret, id, typ, created, object)
}

func stripeHeader(secret string, payload []byte, at time.Time) string {
	return devfakes.SignatureHeader(secret, payload, at)
}
