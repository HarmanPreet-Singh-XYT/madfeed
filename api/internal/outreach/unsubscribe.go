package outreach

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/google/uuid"
)

// Unsubscriber makes and checks the links at the bottom of every email. A link
// proves it was issued by us for exactly one address in one workspace, so
// nobody can unsubscribe (or probe) other people by guessing.
type Unsubscriber struct {
	BaseURL string // the public web address, no trailing slash
	Secret  []byte
}

var ErrBadToken = errors.New("outreach: invalid unsubscribe link")

func (u Unsubscriber) mac(payload []byte) []byte {
	h := hmac.New(sha256.New, u.Secret)
	h.Write([]byte("unsubscribe-v1"))
	h.Write(payload)
	return h.Sum(nil)[:16]
}

// Token encodes workspace and address with a signature.
func (u Unsubscriber) Token(workspaceID uuid.UUID, email string) string {
	payload := append(workspaceID[:], []byte(strings.ToLower(email))...)
	return base64.RawURLEncoding.EncodeToString(append(payload, u.mac(payload)...))
}

func (u Unsubscriber) URL(workspaceID uuid.UUID, email string) string {
	return u.BaseURL + "/unsubscribe/" + u.Token(workspaceID, email)
}

// Verify returns the workspace and address a token was issued for.
func (u Unsubscriber) Verify(token string) (uuid.UUID, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) < 16+1+16 || len(raw) > 16+320+16 || len(u.Secret) == 0 {
		return uuid.Nil, "", ErrBadToken
	}
	payload, sig := raw[:len(raw)-16], raw[len(raw)-16:]
	if !hmac.Equal(sig, u.mac(payload)) {
		return uuid.Nil, "", ErrBadToken
	}
	var ws uuid.UUID
	copy(ws[:], payload[:16])
	return ws, string(payload[16:]), nil
}
