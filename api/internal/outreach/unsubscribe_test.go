package outreach

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestUnsubscribeTokensAreBoundToOneMessageAndCarryNothingPersonal(t *testing.T) {
	u := Unsubscriber{BaseURL: "https://app.example", Secret: []byte("test-secret-value-of-some-length")}
	ws, msg := uuid.New(), uuid.New()
	tok := u.Token(ws, msg)
	gotWS, gotMsg, err := u.Verify(tok)
	if err != nil || gotWS != ws || gotMsg != msg {
		t.Fatalf("%v %v %v", gotWS, gotMsg, err)
	}
	if !strings.HasPrefix(u.URL(ws, msg), "https://app.example/unsubscribe/") {
		t.Fatal(u.URL(ws, msg))
	}
	// Nothing in the token can be read as a name or address: it is two ids and a signature.
	raw, _ := base64.RawURLEncoding.DecodeString(tok)
	if len(raw) != 48 || strings.Contains(string(raw), "acme") || strings.Contains(string(raw), ".com") {
		t.Fatalf("token is %d bytes", len(raw))
	}
	// Another secret, a tampered token, truncation, extension and garbage are all refused.
	other := Unsubscriber{Secret: []byte("a-different-secret-entirely-here")}
	cases := map[string]string{
		"other secret": other.Token(ws, msg),
		"tampered":     tok[:len(tok)-1] + flipped(tok),
		"truncated":    tok[:20],
		"extended":     tok + "AAAA",
		"empty":        "",
		"garbage":      "!!!not base64!!!",
		"old format":   base64.RawURLEncoding.EncodeToString(append(append([]byte{}, ws[:]...), []byte("dana@acme.com0123456789abcdef")...)),
	}
	for name, bad := range cases {
		if _, _, err := u.Verify(bad); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	// A token for one message cannot be edited into one for another (flip a bit in either id).
	for _, at := range []int{3, 20} {
		b, _ := base64.RawURLEncoding.DecodeString(tok)
		b[at] ^= 1
		if _, _, err := u.Verify(base64.RawURLEncoding.EncodeToString(b)); err == nil {
			t.Errorf("edited token accepted (byte %d)", at)
		}
	}
	// No secret configured means nothing verifies (fails closed).
	if _, _, err := (Unsubscriber{}).Verify(tok); err == nil {
		t.Error("verified with no secret")
	}
}

// flipped is a last character different from the one s ends with, so tampering always changes the value.
func flipped(s string) string {
	if strings.HasSuffix(s, "A") {
		return "B"
	}
	return "A"
}
