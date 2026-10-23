package publicsite

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/mail"
	"strings"
	"time"
)

// A voting link is how a company's own app vouches for a signed-in user of theirs: it signs the
// user's email address and an expiry with the workspace's voting secret and puts the result on the
// roadmap link (`?vt=...`). Nothing else about the user is shared.
//
//	v1.<payload>.<signature>
//	payload   = base64url(JSON {"e": email, "x": expiry as unix seconds})
//	signature = base64url(HMAC-SHA256(secret, "vote-v1." + payload))
//
// A link is accepted only while it has not expired, and only if its expiry is no more than
// MaxVoteTokenLife away, so a link that was made to last for years is refused.
const MaxVoteTokenLife = 24 * time.Hour

var ErrBadVoteToken = errors.New("publicsite: invalid voting link")

func voteMAC(secret, payload string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte("vote-v1." + payload))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// SignVoteToken is what a company's server does (a few lines in any language); it is here for tests and docs.
func SignVoteToken(secret, email string, expires time.Time) string {
	b, _ := json.Marshal(map[string]any{"e": email, "x": expires.Unix()})
	p := base64.RawURLEncoding.EncodeToString(b)
	return "v1." + p + "." + voteMAC(secret, p)
}

// verifyVoteToken returns the email the company vouched for.
func verifyVoteToken(secret, token string, now time.Time) (string, error) {
	if secret == "" || len(token) > 800 {
		return "", ErrBadVoteToken
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return "", ErrBadVoteToken
	}
	if !hmac.Equal([]byte(voteMAC(secret, parts[1])), []byte(parts[2])) {
		return "", ErrBadVoteToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", ErrBadVoteToken
	}
	var p struct {
		E string `json:"e"`
		X int64  `json:"x"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", ErrBadVoteToken
	}
	exp := time.Unix(p.X, 0)
	if !now.Before(exp) || exp.Sub(now) > MaxVoteTokenLife {
		return "", ErrBadVoteToken
	}
	a, err := mail.ParseAddress(p.E)
	if err != nil || a.Name != "" || len(a.Address) > 320 {
		return "", ErrBadVoteToken
	}
	return strings.ToLower(a.Address), nil
}

// NewVoteSecret makes a workspace's signing secret: 32 random bytes, hex.
func NewVoteSecret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
