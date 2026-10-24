package api

import (
	"net/http/httptest"
	"testing"

	"product/api/internal/devfakes"
)

// fakeGitHub is the shared GitHub stand-in served on a local address.
type fakeGitHub struct {
	*devfakes.GitHub
	srv *httptest.Server
}

func newFakeGitHub(t *testing.T) *fakeGitHub {
	f := &fakeGitHub{GitHub: devfakes.NewGitHub()}
	f.srv = httptest.NewServer(f.Handler())
	t.Cleanup(f.srv.Close)
	return f
}
