package secretbox

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func key(b byte) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{b}, 32)) }

func TestSealedValuesOpenOnlyForTheirOwnerAndKey(t *testing.T) {
	a, err := New(key(1))
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte("xoxb-very-secret-token")
	sealed := a.Seal(secret, "ws1|slack")
	if bytes.Contains(sealed, secret) || bytes.Contains(sealed, []byte("xoxb")) {
		t.Fatal("the plaintext is visible in the sealed value")
	}
	if got, err := a.Open(sealed, "ws1|slack"); err != nil || !bytes.Equal(got, secret) {
		t.Fatalf("open: %q %v", got, err)
	}
	// another owner (a copied row in another workspace), another key, a flipped bit, a truncation: all refused
	if _, err := a.Open(sealed, "ws2|slack"); err == nil {
		t.Error("opened for another owner")
	}
	if _, err := a.Open(sealed, "ws1|github"); err == nil {
		t.Error("opened for another purpose")
	}
	other, _ := New(key(2))
	if _, err := other.Open(sealed, "ws1|slack"); err == nil {
		t.Error("opened with another key")
	}
	flipped := append([]byte{}, sealed...)
	flipped[len(flipped)-1] ^= 1
	if _, err := a.Open(flipped, "ws1|slack"); err == nil {
		t.Error("opened a damaged value")
	}
	for _, bad := range [][]byte{nil, {1}, sealed[:10], append([]byte{9}, sealed[1:]...)} {
		if _, err := a.Open(bad, "ws1|slack"); err == nil {
			t.Errorf("opened %v", bad)
		}
	}
	// a new nonce every time
	if bytes.Equal(a.Seal(secret, "x"), a.Seal(secret, "x")) {
		t.Error("the same value sealed twice looks identical")
	}
}

func TestKeysMustBeThirtyTwoBytes(t *testing.T) {
	for _, bad := range []string{"", "short", base64.StdEncoding.EncodeToString([]byte("only sixteen byt")), strings.Repeat("!", 44)} {
		if _, err := New(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if _, err := New(base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))); err != nil {
		t.Errorf("a URL-safe key: %v", err)
	}
}

func TestDerivedKeysDifferByPurposeAndByKey(t *testing.T) {
	a, _ := New(key(1))
	b, _ := New(key(2))
	if bytes.Equal(a.Derive("x"), a.Derive("y")) || bytes.Equal(a.Derive("x"), b.Derive("x")) || !bytes.Equal(a.Derive("x"), a.Derive("x")) {
		t.Error("derived keys are not separated by purpose and key")
	}
	if bytes.Equal(a.Derive("x"), bytes.Repeat([]byte{1}, 32)) {
		t.Error("a derived key equals the main key")
	}
}
