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
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
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
		if r.Method != http.MethodPost || r.URL.Query().Get("grant_type") != "password" {
			fail(http.StatusBadRequest, "unsupported_grant_type")
			return
		}
		if r.Header.Get("apikey") != devPublishableKey || r.Header.Get("Authorization") != "" {
			fail(http.StatusUnauthorized, "no_authorization")
			return
		}
		var in struct{ Email, Password string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
			fail(http.StatusBadRequest, "validation_failed")
			return
		}
		switch {
		case in.Email == "unconfirmed@example.com":
			fail(http.StatusBadRequest, "email_not_confirmed")
			return
		case in.Email != devEmail || in.Password != devPassword:
			fail(http.StatusBadRequest, "invalid_credentials")
			return
		}
		sub := uuid.NewSHA1(uuid.NameSpaceURL, []byte("devauth:"+in.Email)).String()
		tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
			"sub": sub, "iss": issuer, "aud": audience, "email": in.Email,
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
		})
		tok.Header["kid"] = kid
		signed, err := tok.SignedString(key)
		if err != nil {
			fail(http.StatusInternalServerError, "unexpected_failure")
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": signed, "token_type": "bearer", "expires_in": 3600, "refresh_token": "dev-refresh", "user": map[string]string{"id": sub, "email": in.Email}})
	})
	fmt.Printf("devauth on http://%s  (JWKS /jwks.json, tokens /token?sub=<uuid>)\n", addr)
	log.Fatal((&http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
