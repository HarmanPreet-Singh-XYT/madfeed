package hooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/secretbox"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// backoff is the wait before each retry: the first retry comes after a minute, the last after a day.
var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 6 * time.Hour, 12 * time.Hour, 24 * time.Hour}

// Sign is the value of the Webhook-Signature header: the time and an HMAC-SHA256 of "time.body" under the endpoint's secret.
// A receiver recomputes it and rejects messages whose time is far from its own clock.
func Sign(secret string, at time.Time, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	ts := strconv.FormatInt(at.Unix(), 10)
	m.Write([]byte(ts))
	m.Write([]byte{'.'})
	m.Write(body)
	return "t=" + ts + ",v1=" + hex.EncodeToString(m.Sum(nil))
}

// blockedIP is every address a message must never be sent to: this machine, private networks, link-local
// (including cloud metadata addresses), shared address space, multicast and the unspecified address.
func blockedIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return true
	}
	if ip.Is4() {
		b := ip.As4()
		if b[0] == 100 && b[1] >= 64 && b[1] <= 127 { // 100.64.0.0/10, shared address space
			return true
		}
		if b[0] == 192 && b[1] == 0 && b[2] == 0 { // 192.0.0.0/24
			return true
		}
	}
	return false
}

// Sender delivers queued messages.
type Sender struct {
	Pool *pgxpool.Pool
	Box  *secretbox.Box
	Log  *slog.Logger
	// AllowPrivate switches off the private-network check (development and tests only).
	AllowPrivate bool
	HTTP         *http.Client
	Now          func() time.Time
}

func (s *Sender) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Sender) client() *http.Client {
	if s.HTTP != nil {
		return s.HTTP
	}
	d := &net.Dialer{Timeout: 5 * time.Second}
	if !s.AllowPrivate {
		// Checked on the address actually being connected to, after name lookup, so a name that
		// resolves to a private address (or is changed to one later) cannot be used.
		d.Control = func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip, err := netip.ParseAddr(host)
			if err != nil || blockedIP(ip) {
				return errors.New("address not allowed")
			}
			return nil
		}
	}
	return &http.Client{
		Timeout:       10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			Proxy:               nil, // a proxy would connect on our behalf and skip the check
			DialContext:         d.DialContext,
			TLSHandshakeTimeout: 5 * time.Second,
			DisableKeepAlives:   true,
		},
	}
}

type job struct {
	id, ws uuid.UUID
}

// RunDue sends what is due and returns how many messages were attempted. Safe from several processes at once:
// each message is claimed (leased for two minutes) before it is sent.
func (s *Sender) RunDue(ctx context.Context, max int) (int, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id, workspace_id FROM outbound_claim_due($1)`, max)
	if err != nil {
		return 0, err
	}
	var due []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.ws); err != nil {
			rows.Close()
			return 0, err
		}
		due = append(due, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	var first error
	for _, j := range due {
		if err := s.deliver(ctx, j); err != nil && first == nil {
			first = err
		}
	}
	return len(due), first
}

func (s *Sender) deliver(ctx context.Context, j job) error {
	t := store.Tenant{WorkspaceID: j.ws, Role: store.RoleMember}
	var (
		url, typ, state string
		sealed          []byte
		payload         []byte
		attempts        int
		eventID         uuid.UUID
		enabled         bool
		endpoint        uuid.UUID
	)
	err := store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		return tx.QueryRow(ctx, `
			SELECT d.endpoint_id, d.event_id, d.event_type, d.state, d.attempts, d.payload, e.url, e.secret, e.enabled
			FROM outbound_delivery d JOIN outbound_endpoint e ON e.workspace_id = d.workspace_id AND e.id = d.endpoint_id
			WHERE d.workspace_id = $1 AND d.id = $2`, j.ws, j.id).
			Scan(&endpoint, &eventID, &typ, &state, &attempts, &payload, &url, &sealed, &enabled)
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && state != "pending") {
		return nil // the endpoint was removed, or someone else already finished this
	}
	if err != nil {
		return err
	}
	if !enabled && typ != Ping {
		return s.finish(ctx, j, endpoint, attempts, 0, "endpoint is switched off", true, false)
	}
	secret, err := s.Box.Open(sealed, owner(j.ws, endpoint))
	if err != nil {
		return s.finish(ctx, j, endpoint, attempts, 0, "the signing secret could not be opened", true, false)
	}

	status, why := s.post(ctx, url, string(secret), eventID, typ, payload)
	ok := status >= 200 && status < 300
	return s.finish(ctx, j, endpoint, attempts+1, status, why, false, ok)
}

// post sends one message and says what happened in words that are safe to store and show (no response body).
func (s *Sender) post(ctx context.Context, url, secret string, eventID uuid.UUID, typ string, body []byte) (int, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, "the address could not be used"
	}
	now := s.now()
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "feedback-webhooks/1")
	req.Header.Set("Webhook-Id", eventID.String())
	req.Header.Set("Webhook-Event", typ)
	req.Header.Set("Webhook-Signature", Sign(secret, now, body))
	resp, err := s.client().Do(req)
	if err != nil {
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			return 0, "timed out after 10 seconds"
		case bytes.Contains([]byte(err.Error()), []byte("address not allowed")):
			return 0, "the address points inside a private network"
		}
		return 0, "could not connect"
	}
	defer resp.Body.Close()
	_, _ = io.CopyN(io.Discard, resp.Body, 4096)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp.StatusCode, ""
	}
	return resp.StatusCode, fmt.Sprintf("the receiver answered %d", resp.StatusCode)
}

// finish records one attempt: sent, scheduled again, or given up. Failures also count against the endpoint.
func (s *Sender) finish(ctx context.Context, j job, endpoint uuid.UUID, attempts, status int, why string, giveUp, ok bool) error {
	t := store.Tenant{WorkspaceID: j.ws, Role: store.RoleMember}
	return store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, _ *dbgen.Queries) error {
		var st *int
		if status != 0 {
			st = &status
		}
		switch {
		case ok:
			if _, err := tx.Exec(ctx, `UPDATE outbound_delivery SET state = 'sent', attempts = $3, last_status = $4, last_error = '', sent_at = now() WHERE workspace_id = $1 AND id = $2`, j.ws, j.id, attempts, st); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE outbound_endpoint SET consecutive_failures = 0 WHERE workspace_id = $1 AND id = $2`, j.ws, endpoint)
			return err
		case giveUp || attempts >= MaxAttempts:
			_, err := tx.Exec(ctx, `UPDATE outbound_delivery SET state = 'failed', attempts = $3, last_status = $4, last_error = $5 WHERE workspace_id = $1 AND id = $2`, j.ws, j.id, attempts, st, why)
			if err != nil || giveUp {
				return err
			}
		default:
			wait := backoff[min(attempts-1, len(backoff)-1)]
			if _, err := tx.Exec(ctx, `UPDATE outbound_delivery SET attempts = $3, last_status = $4, last_error = $5, next_attempt_at = $6 WHERE workspace_id = $1 AND id = $2`,
				j.ws, j.id, attempts, st, why, s.now().Add(wait)); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `
			UPDATE outbound_endpoint SET consecutive_failures = consecutive_failures + 1,
			  enabled = enabled AND consecutive_failures + 1 < $3,
			  paused_reason = CASE WHEN enabled AND consecutive_failures + 1 >= $3 THEN 'switched off after repeated failures' ELSE paused_reason END
			WHERE workspace_id = $1 AND id = $2`, j.ws, endpoint, PauseAfter)
		return err
	})
}

// Loop sends due messages every few seconds and tidies old ones, until ctx ends.
func (s *Sender) Loop(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	purge := time.NewTicker(6 * time.Hour)
	defer purge.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-purge.C:
			if _, err := s.Pool.Exec(ctx, `SELECT outbound_purge()`); err != nil && s.Log != nil {
				s.Log.Error("webhook purge", "error", err)
			}
		case <-t.C:
			if _, err := s.RunDue(ctx, 50); err != nil && s.Log != nil {
				s.Log.Error("webhook delivery", "error", err)
			}
		}
	}
}
