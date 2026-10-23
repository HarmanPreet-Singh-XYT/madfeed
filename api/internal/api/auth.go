package api

import (
	"context"
	"net/http"
	"strings"

	"product/api/internal/auth"
)

// TokenVerifier proves who a bearer token belongs to (auth.Verifier in
// production). Membership and role are looked up separately, per workspace.
type TokenVerifier interface {
	Verify(raw string) (auth.Identity, error)
}

type identityKey struct{}

func identityFrom(ctx context.Context) (auth.Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(auth.Identity)
	return id, ok
}

// publicPaths and the /v1/public/ prefix are the only routes that work without a token.
var publicPaths = map[string]bool{"/healthz": true, "/readyz": true}

// authenticate rejects every request outside publicPaths that does not carry a
// valid bearer token. The reason for a rejection is never returned to the
// caller.
func authenticate(v TokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// /v1/ext/ is guarded by its own check, which accepts API keys and nothing else.
			if publicPaths[r.URL.Path] || strings.HasPrefix(r.URL.Path, "/v1/public/") || strings.HasPrefix(r.URL.Path, "/v1/ext/") {
				next.ServeHTTP(w, r)
				return
			}
			raw, ok := auth.BearerToken(r)
			if !ok || raw == "" {
				writeError(w, r, errUnauthorized)
				return
			}
			id, err := v.Verify(raw)
			if err != nil {
				writeError(w, r, errUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, id)))
		})
	}
}
