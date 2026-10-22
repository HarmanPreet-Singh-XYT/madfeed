package outreach

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestUnsubscribeTokensAreBoundToOneAddressAndWorkspace(t *testing.T) {
	u := Unsubscriber{BaseURL: "https://app.example", Secret: []byte("test-secret-value-of-some-length")}
	ws := uuid.New()
	tok := u.Token(ws, "Dana@Acme.com")
	gotWS, gotEmail, err := u.Verify(tok)
	if err != nil || gotWS != ws || gotEmail != "dana@acme.com" {
		t.Fatalf("%v %v %v", gotWS, gotEmail, err)
	}
	if !strings.HasPrefix(u.URL(ws, "a@b.io"), "https://app.example/unsubscribe/") {
		t.Fatal(u.URL(ws, "a@b.io"))
	}

	// Another secret, a tampered token, truncation and garbage are all refused.
	other := Unsubscriber{Secret: []byte("a-different-secret-entirely-here")}
	cases := map[string]string{
		"other secret": other.Token(ws, "dana@acme.com"),
		"tampered":     tok[:len(tok)-2] + "AA",
		"truncated":    tok[:20],
		"empty":        "",
		"garbage":      "!!!not base64!!!",
	}
	for name, bad := range cases {
		if _, _, err := u.Verify(bad); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	// A token for one address cannot be edited into one for another.
	raw := []byte(tok)
	raw[20] ^= 1
	if _, _, err := u.Verify(string(raw)); err == nil {
		t.Error("edited token accepted")
	}
	// No secret configured means nothing verifies (fails closed).
	if _, _, err := (Unsubscriber{}).Verify(tok); err == nil {
		t.Error("verified with no secret")
	}
}
