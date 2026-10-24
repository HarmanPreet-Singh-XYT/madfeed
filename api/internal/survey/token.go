package survey

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// ErrBadToken is any link that is not one of ours, was altered, or has been retired. It looks like a missing page.
var ErrBadToken = errors.New("survey: bad link")

// Links names a survey and (for a personal link) the person it was written for. Nothing is stored for a link:
// it is signed, so it cannot be forged or edited, and a survey's public link can be retired by raising its
// epoch. The secret is the server's, never shown.
type Links struct {
	Secret  []byte
	BaseURL string
}

func (l Links) mac(parts ...string) string {
	h := hmac.New(sha256.New, l.Secret)
	h.Write([]byte("survey-link\x00" + strings.Join(parts, "\x00")))
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

// InviteToken is the personal link's secret part for one invitation.
func (l Links) InviteToken(ws, invite uuid.UUID) string {
	return "i." + hexID(ws) + "." + hexID(invite) + "." + l.mac("i", ws.String(), invite.String())
}

// OpenToken is the public link's secret part for a survey.
func (l Links) OpenToken(ws, survey uuid.UUID, epoch int) string {
	return "o." + hexID(ws) + "." + hexID(survey) + "." + strconv.Itoa(epoch) + "." + l.mac("o", ws.String(), survey.String(), strconv.Itoa(epoch))
}

func (l Links) URL(token string) string {
	return strings.TrimRight(l.BaseURL, "/") + "/s/" + token
}

// Ref is what a verified link points at.
type Ref struct {
	Workspace uuid.UUID
	Survey    uuid.UUID // zero for a personal link until the invitation is read
	Invite    uuid.UUID // zero for the public link
	Epoch     int
	Open      bool
}

// Verify checks the signature in constant time. It does not check that the survey is open or the invitation exists.
func (l Links) Verify(token string) (Ref, error) {
	if len(l.Secret) == 0 || len(token) > 200 {
		return Ref{}, ErrBadToken
	}
	p := strings.Split(token, ".")
	switch {
	case len(p) == 4 && p[0] == "i":
		ws, err1 := parseHexID(p[1])
		inv, err2 := parseHexID(p[2])
		if err1 != nil || err2 != nil || !same(p[3], l.mac("i", ws.String(), inv.String())) {
			return Ref{}, ErrBadToken
		}
		return Ref{Workspace: ws, Invite: inv}, nil
	case len(p) == 5 && p[0] == "o":
		ws, err1 := parseHexID(p[1])
		sv, err2 := parseHexID(p[2])
		epoch, err3 := strconv.Atoi(p[3])
		if err1 != nil || err2 != nil || err3 != nil || epoch < 0 || strconv.Itoa(epoch) != p[3] || !same(p[4], l.mac("o", ws.String(), sv.String(), p[3])) {
			return Ref{}, ErrBadToken
		}
		return Ref{Workspace: ws, Survey: sv, Epoch: epoch, Open: true}, nil
	}
	return Ref{}, ErrBadToken
}

func same(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
