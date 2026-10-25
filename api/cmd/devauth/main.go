// Command devauth is a LOCAL DEVELOPMENT stand-in for the identity provider.
// It serves a JWKS with a throwaway key and mints access tokens, so the API and
// web app can be developed before a real Supabase project exists.
//
//	go run ./cmd/devauth                      # serves :9999
//	curl localhost:9999/token?sub=<uuid>      # prints a token for that user
//
// Point the API at it with SUPABASE_JWKS_URL=http://localhost:9999/jwks.json and
// JWT_ISSUER=http://localhost:9999. It refuses to start unless APP_ENV is
// "development" (or unset) and listens on localhost only.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	addr     = "127.0.0.1:9999"
	issuer   = "http://localhost:9999"
	audience = "authenticated"
	kid      = "dev-key"

	// The one account the password stand-in knows. Local development only.
	devEmail          = "tester@example.com"
	devPassword       = "correct horse battery"
	devPublishableKey = "sb_publishable_dev"
)

// passwordTTL is how long a password-grant token lives. DEVAUTH_PASSWORD_TTL (seconds) shortens it
// so tests can watch a session being renewed.
var passwordTTL = func() time.Duration {
	if n, err := strconv.Atoi(os.Getenv("DEVAUTH_PASSWORD_TTL")); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return time.Hour
}()

// Accounts made through the sign-up stand-in. Real Supabase keeps these; here they live in memory.
type account struct {
	password  string
	confirmed bool
}

var (
	accountsMu sync.Mutex
	accounts   = map[string]*account{}
)

var (
	refreshMu sync.Mutex
	refreshes = map[string]string{} // refresh token -> email, each usable once
)

func issueRefresh(email string) string {
	t := "dev-refresh-" + uuid.NewString()
	refreshMu.Lock()
	refreshes[t] = email
	refreshMu.Unlock()
	return t
}

func redeem(t string) (string, bool) {
	refreshMu.Lock()
	defer refreshMu.Unlock()
	email, ok := refreshes[t]
	delete(refreshes, t)
	return email, ok
}

type idpTrip struct {
	challenge, email string
	expires          time.Time
}

var (
	idpMu    sync.Mutex
	idpCodes = map[string]idpTrip{}
)

func main() {
	if env := os.Getenv("APP_ENV"); env != "" && env != "development" {
		log.Fatal("devauth is for local development only")
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	b64 := func(n *big.Int) string { return base64.RawURLEncoding.EncodeToString(n.FillBytes(make([]byte, 32))) }

	mux := http.NewServeMux()
	mux.HandleFunc("/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": kid, "x": b64(key.X), "y": b64(key.Y)}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		sub := r.URL.Query().Get("sub")
		if _, err := uuid.Parse(sub); err != nil {
			sub = uuid.NewString()
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
			"sub": sub, "iss": issuer, "aud": audience, "email": sub[:8] + "@dev.local",
			"iat": time.Now().Unix(), "exp": time.Now().Add(8 * time.Hour).Unix(),
		})
		tok.Header["kid"] = kid
		signed, err := tok.SignedString(key)
		if err != nil {
			http.Error(w, "sign failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"sub": sub, "token": signed})
	})
	// A stand-in for Supabase's password sign-in, so the web app's real sign-in
	// code can be tested without a project: POST /auth/v1/token?grant_type=password.
	mux.HandleFunc("/auth/v1/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fail := func(status int, code string) {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{"error_code": code, "msg": "stand-in: " + code})
		}
		grant := r.URL.Query().Get("grant_type")
		if grant == "pkce" && r.Method == http.MethodPost {
			// finishing a company sign-in: the one-time code plus the secret the browser kept (PKCE, S256)
			var in struct {
				AuthCode     string `json:"auth_code"`
				CodeVerifier string `json:"code_verifier"`
			}
			if r.Header.Get("apikey") != devPublishableKey || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in) != nil {
				fail(http.StatusBadRequest, "validation_failed")
				return
			}
			idpMu.Lock()
			trip, ok := idpCodes[in.AuthCode]
			delete(idpCodes, in.AuthCode) // single use
			idpMu.Unlock()
			sum := sha256.Sum256([]byte(in.CodeVerifier))
			if !ok || time.Now().After(trip.expires) || base64.RawURLEncoding.EncodeToString(sum[:]) != trip.challenge {
				fail(http.StatusBadRequest, "flow_state_not_found")
				return
			}
			sub := uuid.NewSHA1(uuid.NameSpaceURL, []byte("devauth:"+trip.email)).String()
			tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
				"sub": sub, "iss": issuer, "aud": audience, "email": trip.email, "user_metadata": map[string]any{"email_verified": true},
				"iat": time.Now().Unix(), "exp": time.Now().Add(passwordTTL).Unix(),
			})
			tok.Header["kid"] = kid
			signed, err := tok.SignedString(key)
			if err != nil {
				fail(http.StatusInternalServerError, "unexpected_failure")
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": signed, "token_type": "bearer", "expires_in": int(passwordTTL.Seconds()), "refresh_token": issueRefresh(trip.email), "user": map[string]string{"id": sub, "email": trip.email}})
			return
		}
		if r.Method != http.MethodPost || (grant != "password" && grant != "refresh_token") {
			fail(http.StatusBadRequest, "unsupported_grant_type")
			return
		}
		if r.Header.Get("apikey") != devPublishableKey || r.Header.Get("Authorization") != "" {
			fail(http.StatusUnauthorized, "no_authorization")
			return
		}
		var in struct {
			Email, Password string
			RefreshToken    string `json:"refresh_token"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
			fail(http.StatusBadRequest, "validation_failed")
			return
		}
		viaRefresh := grant == "refresh_token"
		if grant == "refresh_token" {
			// The stand-in's refresh tokens are "dev-refresh-<email>-<n>"; each can be used once, like Supabase's.
			email, ok := redeem(in.RefreshToken)
			if !ok {
				fail(http.StatusBadRequest, "refresh_token_not_found")
				return
			}
			in.Email, in.Password = email, devPassword
		}
		accountsMu.Lock()
		acct := accounts[in.Email]
		accountsMu.Unlock()
		switch {
		case in.Email == "unconfirmed@example.com":
			fail(http.StatusBadRequest, "email_not_confirmed")
			return
		case acct != nil && (viaRefresh || acct.password == in.Password):
			if !acct.confirmed {
				fail(http.StatusBadRequest, "email_not_confirmed")
				return
			}
		case in.Email != devEmail || (!viaRefresh && in.Password != devPassword):
			fail(http.StatusBadRequest, "invalid_credentials")
			return
		}
		sub := uuid.NewSHA1(uuid.NameSpaceURL, []byte("devauth:"+in.Email)).String()
		tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
			"sub": sub, "iss": issuer, "aud": audience, "email": in.Email, "user_metadata": map[string]any{"email_verified": true},
			"iat": time.Now().Unix(), "exp": time.Now().Add(passwordTTL).Unix(),
		})
		tok.Header["kid"] = kid
		signed, err := tok.SignedString(key)
		if err != nil {
			fail(http.StatusInternalServerError, "unexpected_failure")
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": signed, "token_type": "bearer", "expires_in": int(passwordTTL.Seconds()), "refresh_token": issueRefresh(in.Email), "user": map[string]string{"id": sub, "email": in.Email}})
	})
	// Stands in for company sign-in. POST /auth/v1/sso finds the identity system for an email domain (only
	// sso-e2e.test has one), /auth/v1/authorize does the same for a provider button, and /dev/idp is the
	// "company sign-in page" that sends the browser straight back with a one-time code.
	mux.HandleFunc("/auth/v1/sso", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var raw struct {
			Domain              string `json:"domain"`
			RedirectTo          string `json:"redirect_to"`
			CodeChallenge       string `json:"code_challenge"`
			CodeChallengeMethod string `json:"code_challenge_method"`
		}
		if r.Method != http.MethodPost || r.Header.Get("apikey") != devPublishableKey || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&raw) != nil || raw.CodeChallenge == "" || raw.CodeChallengeMethod != "s256" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error_code":"validation_failed"}`))
			return
		}
		if raw.Domain != "sso-e2e.test" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error_code":"sso_provider_not_found","msg":"stand-in"}`))
			return
		}
		q := url.Values{"redirect_to": {raw.RedirectTo}, "challenge": {raw.CodeChallenge}, "email": {"sso-user@sso-e2e.test"}}
		_ = json.NewEncoder(w).Encode(map[string]string{"url": "http://" + r.Host + "/dev/idp?" + q.Encode()})
	})
	mux.HandleFunc("/auth/v1/authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("provider") == "" || q.Get("code_challenge") == "" || q.Get("code_challenge_method") != "s256" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		to := url.Values{"redirect_to": {q.Get("redirect_to")}, "challenge": {q.Get("code_challenge")}, "email": {"user@" + q.Get("provider") + "-e2e.test"}}
		http.Redirect(w, r, "/dev/idp?"+to.Encode(), http.StatusFound)
	})
	mux.HandleFunc("/dev/idp", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		back, err := url.Parse(q.Get("redirect_to"))
		if err != nil || back.Host != "127.0.0.1:13001" || q.Get("challenge") == "" {
			http.Error(w, "bad redirect", http.StatusBadRequest)
			return
		}
		code := uuid.NewString()
		idpMu.Lock()
		idpCodes[code] = idpTrip{challenge: q.Get("challenge"), email: q.Get("email"), expires: time.Now().Add(2 * time.Minute)}
		idpMu.Unlock()
		v := back.Query()
		v.Set("code", code)
		back.RawQuery = v.Encode()
		http.Redirect(w, r, back.String(), http.StatusFound)
	})
	// A stand-in for Supabase's sign-up: POST /auth/v1/signup. Like Supabase with email confirmation on,
	// a new account is created unconfirmed and an address that already exists gets the same answer (so
	// the endpoint cannot be used to find out who has an account). Addresses starting "autoconfirm-"
	// behave like a project with confirmation off and get a session at once.
	mux.HandleFunc("/auth/v1/signup", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fail := func(status int, code string) {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{"error_code": code, "msg": "stand-in: " + code})
		}
		if r.Method != http.MethodPost {
			fail(http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		if r.Header.Get("apikey") != devPublishableKey || r.Header.Get("Authorization") != "" {
			fail(http.StatusUnauthorized, "no_authorization")
			return
		}
		var in struct{ Email, Password string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil || in.Email == "" {
			fail(http.StatusBadRequest, "validation_failed")
			return
		}
		if len(in.Password) < 6 {
			fail(http.StatusUnprocessableEntity, "weak_password")
			return
		}
		sub := uuid.NewSHA1(uuid.NameSpaceURL, []byte("devauth:"+in.Email)).String()
		accountsMu.Lock()
		_, exists := accounts[in.Email]
		exists = exists || in.Email == devEmail
		auto := strings.HasPrefix(in.Email, "autoconfirm-")
		if !exists {
			accounts[in.Email] = &account{password: in.Password, confirmed: auto}
		}
		accountsMu.Unlock()
		if auto && !exists {
			tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
				"sub": sub, "iss": issuer, "aud": audience, "email": in.Email, "user_metadata": map[string]any{"email_verified": true},
				"iat": time.Now().Unix(), "exp": time.Now().Add(passwordTTL).Unix(),
			})
			tok.Header["kid"] = kid
			signed, err := tok.SignedString(key)
			if err != nil {
				fail(http.StatusInternalServerError, "unexpected_failure")
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": signed, "token_type": "bearer", "expires_in": int(passwordTTL.Seconds()), "refresh_token": issueRefresh(in.Email), "user": map[string]string{"id": sub, "email": in.Email}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": sub, "email": in.Email, "confirmation_sent_at": time.Now().UTC().Format(time.RFC3339)})
	})
	// Stands in for clicking the link in the confirmation email: POST /dev/confirm?email=...
	mux.HandleFunc("/dev/confirm", func(w http.ResponseWriter, r *http.Request) {
		accountsMu.Lock()
		defer accountsMu.Unlock()
		if a := accounts[r.URL.Query().Get("email")]; r.Method == http.MethodPost && a != nil {
			a.confirmed = true
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.NotFound(w, r)
	})
	fmt.Printf("devauth on http://%s  (JWKS /jwks.json, tokens /token?sub=<uuid>)\n", addr)
	log.Fatal((&http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
