// Package webhook receives delivery reports from the email provider. A hard
// bounce or a spam complaint puts the address on the workspace's opt-out list,
// so we never write to it again. The endpoint is public, so everything about
// the request is distrusted until its signature checks out.
package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxBody   = 64 << 10
	tolerance = 5 * time.Minute
)

// Suppressor is satisfied by *outreach.Service.
type Suppressor interface {
	RecordSuppression(ctx context.Context, workspaceID uuid.UUID, email, reason string) error
}

type Resend struct {
	Pool     *pgxpool.Pool
	Suppress Suppressor
	Secret   string // "whsec_..." as shown by the provider; empty switches the endpoint off
	Now      func() time.Time
	Log      *slog.Logger
}

var ErrBadSignature = errors.New("webhook: signature does not verify")

// key turns the provider's secret ("whsec_" + base64) into the signing key.
func key(secret string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
}

// Sign produces the header value for a payload; used by tests and by the stand-in.
func Sign(secret, id string, ts time.Time, body []byte) (string, error) {
	k, err := key(secret)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, k)
	mac.Write([]byte(id + "." + strconv.FormatInt(ts.Unix(), 10) + "."))
	mac.Write(body)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

// Verify checks the three signature headers against the raw body. It accepts
// any one of several space-separated signatures (the provider rotates secrets
// by sending two), rejects stale and future timestamps, and compares in
// constant time.
func Verify(secret string, h http.Header, body []byte, now time.Time) error {
	id, tsRaw, sigs := h.Get("svix-id"), h.Get("svix-timestamp"), h.Get("svix-signature")
	if id == "" || tsRaw == "" || sigs == "" || len(id) > 200 {
		return ErrBadSignature
	}
	sec, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		return ErrBadSignature
	}
	ts := time.Unix(sec, 0)
	if d := now.Sub(ts); d > tolerance || d < -tolerance {
		return ErrBadSignature
	}
	want, err := Sign(secret, id, ts, body)
	if err != nil {
		return ErrBadSignature
	}
	ok := false
	for _, s := range strings.Fields(sigs) {
		if hmac.Equal([]byte(s), []byte(want)) { // keep going: no early exit on which one matched
			ok = true
		}
	}
	if !ok {
		return ErrBadSignature
	}
	return nil
}

type event struct {
	Type string `json:"type"`
	Data struct {
		EmailID string `json:"email_id"`
		Bounce  struct {
			Type string `json:"type"`
		} `json:"bounce"`
	} `json:"data"`
}

func (r *Resend) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	log := r.Log
	if log == nil {
		log = slog.Default()
	}
	if r.Secret == "" {
		http.Error(w, "not configured", http.StatusServiceUnavailable)
		return
	}
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxBody))
	if err != nil {
		http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		return
	}
	now := time.Now()
	if r.Now != nil {
		now = r.Now()
	}
	if err := Verify(r.Secret, req.Header, body, now); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized) // no reason given
		return
	}
	var ev event
	if err := json.Unmarshal(body, &ev); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	reason := ""
	switch ev.Type {
	case "email.complained":
		reason = "complained"
	case "email.bounced":
		// A temporary problem (full mailbox, server down) says nothing about the address; only a permanent failure does.
		if strings.EqualFold(ev.Data.Bounce.Type, "permanent") {
			reason = "bounced"
		}
	}
	if reason != "" && ev.Data.EmailID != "" {
		if err := r.act(req.Context(), ev.Data.EmailID, reason); err != nil {
			log.Error("delivery report not recorded", "type", ev.Type, "error", err)
			http.Error(w, "try again", http.StatusInternalServerError) // the provider retries
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// act suppresses the address of one of our own messages. A report about an id
// we never sent is ignored, so the endpoint cannot be used to suppress arbitrary addresses.
func (r *Resend) act(ctx context.Context, providerID, reason string) error {
	var ws uuid.UUID
	var to string
	err := r.Pool.QueryRow(ctx, `SELECT workspace_id, to_email FROM message_for_provider_id($1)`, providerID).Scan(&ws, &to)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return r.Suppress.RecordSuppression(ctx, ws, to, reason)
}
