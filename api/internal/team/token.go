package team

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/google/uuid"
)

// ErrBadToken is any link that is not one of ours or was altered. It looks like a missing page.
var ErrBadToken = errors.New("team: bad link")

// Links makes and checks invitation links. Nothing secret is stored for one: the link is signed with the
// server's secret, so it cannot be forged or edited, and it can be rebuilt at any time to resend it.
type Links struct {
	Secret  []byte
	BaseURL string
}

func (l Links) mac(ws, inv uuid.UUID) string {
	h := hmac.New(sha256.New, l.Secret)
	h.Write([]byte("team-invite\x00" + ws.String() + "\x00" + inv.String()))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil)[:16])
}

func hexID(id uuid.UUID) string { return hex.EncodeToString(id[:]) }

func parseHexID(s string) (uuid.UUID, error) {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 16 {
		return uuid.Nil, ErrBadToken
	}
	var id uuid.UUID
	copy(id[:], b)
	return id, nil
}

func (l Links) Token(ws, inv uuid.UUID) string {
	return "m." + hexID(ws) + "." + hexID(inv) + "." + l.mac(ws, inv)
}

func (l Links) URL(token string) string {
	return strings.TrimRight(l.BaseURL, "/") + "/invite/" + token
}

// Verify returns the workspace and invitation a link points at, if it is genuine.
func (l Links) Verify(token string) (ws, inv uuid.UUID, err error) {
	p := strings.Split(token, ".")
	if len(l.Secret) == 0 || len(p) != 4 || p[0] != "m" || len(token) > 200 {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	if ws, err = parseHexID(p[1]); err != nil {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	if inv, err = parseHexID(p[2]); err != nil {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	if subtle.ConstantTimeCompare([]byte(p[3]), []byte(l.mac(ws, inv))) != 1 {
		return uuid.Nil, uuid.Nil, ErrBadToken
	}
	return ws, inv, nil
}
