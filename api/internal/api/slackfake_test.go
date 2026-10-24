package api

import (
	"net/http/httptest"
	"net/url"
	"testing"

	"product/api/internal/devfakes"
)

// fakeSlack is the shared Slack stand-in served on a local address.
type fakeSlack struct {
	*devfakes.Slack
	srv *httptest.Server
}

func newFakeSlack(t *testing.T) *fakeSlack {
	f := &fakeSlack{Slack: devfakes.NewSlack()}
	f.srv = httptest.NewServer(f.Handler())
	t.Cleanup(f.srv.Close)
	return f
}

func authorizeParams(raw string) url.Values {
	u, _ := url.Parse(raw)
	return u.Query()
}
