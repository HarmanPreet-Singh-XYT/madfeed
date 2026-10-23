package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"product/api/internal/apikey"
	"product/api/internal/auth"
	"product/api/internal/mcpserver"
	"product/api/internal/ratelimit"
)

// handlerTransport lets the MCP tools call this API without leaving the process: each call goes
// through the same router, key check, permissions and rate limits as a call from outside, as if it
// came from the same network address as the assistant that is connected.
type handlerTransport struct {
	h          http.Handler
	remoteAddr string
	xff        string
}

func (t handlerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// The outer request carries the router's memory of having matched /mcp; the inner call must route afresh.
	r := req.Clone(context.WithValue(req.Context(), chi.RouteCtxKey, (*chi.Context)(nil)))
	r.RequestURI = ""
	if r.Body == nil { // a request without a body, as the server side expects it
		r.Body = http.NoBody
	}
	r.RemoteAddr = t.remoteAddr
	r.Header.Del("X-Forwarded-For")
	if t.xff != "" {
		r.Header.Set("X-Forwarded-For", t.xff)
	}
	rec := httptest.NewRecorder()
	t.h.ServeHTTP(rec, r)
	return rec.Result(), nil
}

// MCPPerMinute is how many MCP messages one network address may send a minute.
const MCPPerMinute = 300

// mcpEndpoint serves the MCP protocol over HTTP at /mcp, for assistants that connect to a web address
// instead of running a program. It is stateless (any instance can answer any message) and holds no
// data: it is the same read tools as cmd/mcp, calling this API with the caller's own key.
func (s *Server) mcpEndpoint(inner http.Handler) http.Handler {
	limited := http.MaxBytesHandler(inner, 1<<20)
	h := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		key, _ := auth.BearerToken(r)
		c := &mcpserver.Client{
			BaseURL: "http://api.internal",
			Key:     key,
			HTTP: &http.Client{Timeout: 90 * time.Second, Transport: handlerTransport{
				h: limited, remoteAddr: r.RemoteAddr, xff: r.Header.Get("X-Forwarded-For"),
			}},
		}
		return mcpserver.NewServer(c, s.Version)
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := auth.BearerToken(r)
		if !ok || !strings.HasPrefix(raw, apikey.Prefix) || s.APIKeys == nil {
			writeError(w, r, errUnauthorized)
			return
		}
		// An unknown, revoked, expired or out-of-place key is refused before any MCP traffic.
		if _, err := s.APIKeys.Authenticate(r.Context(), raw, ratelimit.RealIP(r, s.Limits.TrustedHops)); err != nil {
			writeError(w, r, errUnauthorized)
			return
		}
		if s.Limiter != nil {
			if d := s.Limiter.Allow(r.Context(), "mcp", ratelimit.ClientIP(r, s.Limits.TrustedHops), MCPPerMinute, 60); !d.Allowed {
				ratelimit.Reject(w, d)
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}
