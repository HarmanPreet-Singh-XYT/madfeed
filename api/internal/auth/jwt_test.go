package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	issuer   = "https://example.test/auth/v1"
	audience = "authenticated"
)

type signer struct {
	kid string
	key *ecdsa.PrivateKey
}

func newSigner(t *testing.T, kid string) signer {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return signer{kid, k}
}

func (s signer) jwk() map[string]string {
	b := func(n *big.Int) string { return base64.RawURLEncoding.EncodeToString(n.FillBytes(make([]byte, 32))) }
	return map[string]string{"kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": s.kid, "x": b(s.key.X), "y": b(s.key.Y)}
}

func (s signer) token(t *testing.T, mutate func(*jwt.RegisteredClaims)) string {
	t.Helper()
	rc := jwt.RegisteredClaims{
		Subject: uuid.NewString(), Issuer: issuer, Audience: jwt.ClaimStrings{audience},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now()),
	}
	if mutate != nil {
		mutate(&rc)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims{RegisteredClaims: rc})
	tok.Header["kid"] = s.kid
	out, err := tok.SignedString(s.key)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// keyServer serves a mutable JWKS so tests can rotate keys.
type keyServer struct {
	mu   sync.Mutex
	keys []signer
	*httptest.Server
}

func newKeyServer(t *testing.T, keys ...signer) *keyServer {
	ks := &keyServer{keys: keys}
	ks.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		ks.mu.Lock()
		defer ks.mu.Unlock()
		set := []map[string]string{}
		for _, k := range ks.keys {
			set = append(set, k.jwk())
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": set})
	}))
	t.Cleanup(ks.Close)
	return ks
}

func (ks *keyServer) set(keys ...signer) { ks.mu.Lock(); ks.keys = keys; ks.mu.Unlock() }

func verifier(t *testing.T, ks *keyServer) *Verifier {
	t.Helper()
	v, err := NewVerifier(context.Background(), Config{JWKSURL: ks.URL, Issuer: issuer, Audience: audience})
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestAcceptsValidToken(t *testing.T) {
	s := newSigner(t, "k1")
	v := verifier(t, newKeyServer(t, s))
	if _, err := v.Verify(s.token(t, nil)); err != nil {
		t.Fatal(err)
	}
}

func TestRejectsInvalidTokens(t *testing.T) {
	s, other := newSigner(t, "k1"), newSigner(t, "k1") // same kid, different key
	v := verifier(t, newKeyServer(t, s))

	cases := map[string]string{
		"expired":        s.token(t, func(c *jwt.RegisteredClaims) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour)) }),
		"wrong audience": s.token(t, func(c *jwt.RegisteredClaims) { c.Audience = jwt.ClaimStrings{"other"} }),
		"wrong issuer":   s.token(t, func(c *jwt.RegisteredClaims) { c.Issuer = "https://evil.test/auth/v1" }),
		"no expiry":      s.token(t, func(c *jwt.RegisteredClaims) { c.ExpiresAt = nil }),
		"bad subject":    s.token(t, func(c *jwt.RegisteredClaims) { c.Subject = "not-a-uuid" }),
		"wrong key":      other.token(t, nil),
		"garbage":        "not.a.jwt",
		"empty":          "",
	}
	good := s.token(t, nil)
	cases["tampered payload"] = good[:len(good)-4] + "AAAA"

	// alg none
	none := jwt.NewWithClaims(jwt.SigningMethodNone, claims{RegisteredClaims: jwt.RegisteredClaims{
		Subject: uuid.NewString(), Issuer: issuer, Audience: jwt.ClaimStrings{audience}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}})
	none.Header["kid"] = "k1"
	cases["alg none"], _ = none.SignedString(jwt.UnsafeAllowNoneSignatureType)

	// HS256 signed with the public key bytes as the secret (algorithm confusion)
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{RegisteredClaims: jwt.RegisteredClaims{
		Subject: uuid.NewString(), Issuer: issuer, Audience: jwt.ClaimStrings{audience}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}})
	hs.Header["kid"] = "k1"
	cases["hs256 confusion"], _ = hs.SignedString([]byte(s.jwk()["x"]))

	for name, tok := range cases {
		_, err := v.Verify(tok)
		if !errors.Is(err, ErrUnauthorized) {
			t.Errorf("%s: want ErrUnauthorized, got %v", name, err)
		}
	}
}

func TestKeyRotationWithoutRestart(t *testing.T) {
	oldKey, newKey := newSigner(t, "old"), newSigner(t, "new")
	ks := newKeyServer(t, oldKey)
	v := verifier(t, ks)
	if _, err := v.Verify(oldKey.token(t, nil)); err != nil {
		t.Fatal(err)
	}
	ks.set(oldKey, newKey) // provider publishes a new key; the running verifier has never seen it
	if _, err := v.Verify(newKey.token(t, nil)); err != nil {
		t.Fatalf("rotated key not accepted without restart: %v", err)
	}
}

func TestBearerToken(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer abc")
	if tok, ok := BearerToken(r); !ok || tok != "abc" {
		t.Fatal("bearer not parsed")
	}
	r.Header.Set("Authorization", "Basic abc")
	if _, ok := BearerToken(r); ok {
		t.Fatal("non-bearer accepted")
	}
}
