package outreach

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"

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
	h.Write([]byte("unsubscribe-v2"))
	h.Write(payload)
	return h.Sum(nil)[:16]
}

// Token names the message the link is printed in, with a signature. It holds
// no email address or name: the token appears in request paths, and so in logs,
// browser history and mail scanners' records. The address is looked up here
// when the link is used.
func (u Unsubscriber) Token(workspaceID, messageID uuid.UUID) string {
	payload := append(append([]byte{}, workspaceID[:]...), messageID[:]...)
	return base64.RawURLEncoding.EncodeToString(append(payload, u.mac(payload)...))
}

func (u Unsubscriber) URL(workspaceID, messageID uuid.UUID) string {
	return u.BaseURL + "/unsubscribe/" + u.Token(workspaceID, messageID)
}

// Verify returns the workspace and message a token was issued for.
func (u Unsubscriber) Verify(token string) (workspaceID, messageID uuid.UUID, err error) {
	raw, derr := base64.RawURLEncoding.DecodeString(token)
	if derr != nil || len(raw) != 16+16+16 || len(u.Secret) == 0 {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	payload, sig := raw[:32], raw[32:]
	if !hmac.Equal(sig, u.mac(payload)) {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	copy(workspaceID[:], payload[:16])
	copy(messageID[:], payload[16:])
	return workspaceID, messageID, nil
}
