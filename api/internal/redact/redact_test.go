package redact

import (
	"strings"
	"testing"
	"time"
)

func TestSecretsAndCardsAreMasked(t *testing.T) {
	cases := []struct {
		name, in string
		kind     string
	}{
		{"visa", "my card is 4111 1111 1111 1111 thanks", "card"},
		{"visa dashes", "4111-1111-1111-1111", "card"},
		{"visa plain", "pay with 4111111111111111 please", "card"},
		{"mastercard", "5555 5555 5555 4444", "card"},
		{"amex", "3782 822463 10005", "card"}, // 15 digits, irregular grouping with spaces only
		{"openai key", "key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "secret"},
		{"stripe", "sk_live_51HxxxxxxxxxxxxxxxxxxxxxxxxXXXX", "secret"},
		{"aws", "AKIAIOSFODNN7EXAMPLE is mine", "secret"},
		{"github", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "secret"},
		{"slack", "xoxb-1234567890-abcdefghij", "secret"},
		{"supabase secret", "sb_secret_abcdefghijklmnopqrstuv", "secret"},
		{"google", "AIzaSyA-1234567890abcdefghijklmnopqrstu", "secret"},
		{"jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", "secret"},
		{"bearer", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", "secret"},
		{"private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----", "private key"},
		{"cut off private key", "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "private key"},
		{"password label", "password: hunter2xyz", "password"},
		{"password quoted", `PASSWORD = "correct horse"`, "password"},
		{"api key assignment", "api_key=abc123def456", "password"},
		{"client secret", "client_secret: Zx9!qw", "password"},
		{"password is", "the password is Tr0ub4dor", "password"},
		{"url credentials", "postgres://admin:s3cr3t@db.example.com:5432/app", "password"},
	}
	for _, c := range cases {
		r := Text(c.in)
		if r.Counts[c.kind] == 0 || r.Total == 0 {
			t.Errorf("%s: nothing %s removed from %q -> %q", c.name, c.kind, c.in, r.Text)
		}
		for _, leak := range []string{"4111", "4444", "hunter2", "AKIAIOSFODNN", "ghp_abc", "xoxb-", "MIIEow", "MIIEvQ", "Tr0ub4dor", "s3cr3t", "sk-proj", "sk_live", "correct horse", "abc123def", "sb_secret_abc", "AIzaSy", "eyJhbGci", "Zx9!qw", "abcdefghijklmnopqrstuvwxyz012345"} {
			if strings.Contains(c.in, leak) && strings.Contains(r.Text, leak) {
				t.Errorf("%s: %q still in %q", c.name, leak, r.Text)
			}
		}
	}
}

func TestOrdinaryTextIsLeftAlone(t *testing.T) {
	for _, s := range []string{
		"We need single sign-on before we can roll this out to the whole company.",
		"Call me on +1 415 555 0132 or dana@acme.com.",
		"Our order number is 4111 1111 1111 1112", // fails the checksum: not a card
		"Invoice 20261023 for 120000 dollars",
		"Reference 1234567890123 (a 13 digit id starting with 1)",
		"Sprint 42, build 8675309, ticket PROJ-12345",
		"The token is expired, please resend.",
		"password reset emails are slow",
		"I forgot my password",
		"secret sauce is the pricing",
		"sk-ip: skip this sk-",
		"2026-10-23T14:05:00Z",
		"9999 8888 7777 6666 (not a known card prefix)",
		"café ☕ naïve — “quotes” 日本語",
		"",
	} {
		if r := Text(s); r.Text != s || r.Total != 0 {
			t.Errorf("changed ordinary text: %q -> %q (%v)", s, r.Text, r.Counts)
		}
	}
}

func TestRedactionIsIdempotentAndKeepsTheRestIntact(t *testing.T) {
	in := "Hi, my card 4111 1111 1111 1111 and key sk-abcdefghijklmnopqrstuvwxyz1234 — please help with SSO.\nThanks, Dana"
	once := Text(in)
	if once.Total != 2 {
		t.Fatalf("%+v", once)
	}
	twice := Text(once.Text)
	if twice.Text != once.Text || twice.Total != 0 {
		t.Errorf("second pass changed things: %q", twice.Text)
	}
	if !strings.HasPrefix(once.Text, "Hi, my card [card number removed] and key [secret removed] — please help with SSO.\nThanks, Dana") {
		t.Errorf("%q", once.Text)
	}
	// A placeholder in a password field is not redacted again.
	if r := Text("password: [password removed]"); r.Total != 0 {
		t.Errorf("%+v", r)
	}
}

func TestHostileInputIsHandledInLinearTime(t *testing.T) {
	big := strings.Repeat("1 ", 250_000) + strings.Repeat("-----BEGIN PRIVATE KEY-----", 5000) + strings.Repeat("a", 500_000)
	start := time.Now()
	r := Text(big)
	if d := time.Since(start); d > 3*time.Second*slowdown {
		t.Errorf("1 MB of adversarial text took %s", d)
	}
	if r.Total == 0 {
		t.Error("nothing found in a pile of key headers")
	}
	for _, s := range []string{strings.Repeat("password:", 100_000), strings.Repeat("4", 1_000_000), strings.Repeat("sk-", 300_000), strings.Repeat("eyJ.", 250_000)} {
		start := time.Now()
		Text(s)
		if d := time.Since(start); d > 3*time.Second*slowdown {
			t.Errorf("%.12q... took %s", s, d)
		}
	}
}
