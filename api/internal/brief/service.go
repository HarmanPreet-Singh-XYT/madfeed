package brief

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/ai"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var (
	ErrNotFound   = errors.New("brief: not found")
	ErrNoEvidence = errors.New("brief: a request needs at least one customer quote first")
)

// ErrQuota means the workspace made too many briefs today. Each costs a model call.
type ErrQuota string

func (e ErrQuota) Error() string { return string(e) }

const DefaultDailyBriefs = 100

type Service struct {
	Pool        *pgxpool.Pool
	Jobs        *river.Client[pgx.Tx]
	DailyBriefs int // 0 means DefaultDailyBriefs
}

type Evidence struct {
	ID           uuid.UUID
	SourceItemID uuid.UUID
	Text         string
	SpanStart    int
	SpanEnd      int
}

type AccountFact struct {
	ID          uuid.UUID
	Name        string
	Revenue     string // decimal text, "" if unknown
	PeopleCount int
}

// Facts are computed from the database each time a brief is read.
type Facts struct {
	EvidenceCount     int
	NewLast30Days     int
	Unidentified      int
	PeopleCount       int
	AccountCount      int
	AccountsWithValue int
	TotalValue        string
	FirstEvidenceAt   *time.Time
	NewestEvidenceAt  *time.Time
	Accounts          []AccountFact
}

type View struct {
	State         string // pending, ready, failed
	Stale         bool   // evidence changed since this brief was written
	LowEvidence   bool
	Claim         string
	Disproof      string
	Quotes        []Evidence // the cited quotes, verbatim from the evidence, strongest first
	FailureReason string
	GeneratedAt   *time.Time
	Facts         Facts
}

type GenerateArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	RequestID   uuid.UUID `json:"request_id"`
	UserID      uuid.UUID `json:"user_id"`
}

func (GenerateArgs) Kind() string { return "generate_brief" }

func fingerprint(evs []dbgen.Evidence) string {
	ids := make([]string, len(evs))
	for i, e := range evs {
		ids[i] = e.ID.String()
	}
	sort.Strings(ids)
	h := sha256.New()
	for _, id := range ids {
		h.Write([]byte(id))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Request starts a brief unless an up-to-date one already exists (then it
// costs nothing). started reports whether a new generation was queued.
func (s *Service) Request(ctx context.Context, t store.Tenant, requestID uuid.UUID) (v View, started bool, err error) {
	if !t.CanWrite() {
		return v, false, store.ErrForbidden
	}
	daily := s.DailyBriefs
	if daily <= 0 {
		daily = DefaultDailyBriefs
	}
	err = store.WithTenantTx(ctx, s.Pool, t, func(tx pgx.Tx, q *dbgen.Queries) error {
		if _, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: requestID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		evs, err := q.ListEvidenceForRequest(ctx, dbgen.ListEvidenceForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if err != nil {
			return err
		}
		if len(evs) == 0 {
			return ErrNoEvidence
		}
		fp := fingerprint(evs)
		if existing, err := q.GetBrief(ctx, dbgen.GetBriefParams{WorkspaceID: t.WorkspaceID, RequestID: requestID}); err == nil {
			if existing.State == "pending" || (existing.State == "ready" && existing.EvidenceFingerprint.String == fp) {
				return nil // already fresh, or already being written
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		n, err := q.CountBriefsSince(ctx, dbgen.CountBriefsSinceParams{WorkspaceID: t.WorkspaceID, UpdatedAt: time.Now().Add(-24 * time.Hour)})
		if err != nil {
			return err
		}
		if int(n) >= daily {
			return ErrQuota("too many briefs generated today; try again tomorrow")
		}
		if _, err := q.UpsertBriefPending(ctx, dbgen.UpsertBriefPendingParams{WorkspaceID: t.WorkspaceID, RequestID: requestID, RequestedBy: t.UserID}); err != nil {
			return err
		}
		if _, err := s.Jobs.InsertTx(ctx, tx, GenerateArgs{WorkspaceID: t.WorkspaceID, RequestID: requestID, UserID: t.UserID}, nil); err != nil {
			return fmt.Errorf("enqueue brief: %w", err)
		}
		started = true
		return nil
	})
	if err != nil {
		return v, false, err
	}
	v, err = s.Get(ctx, t, requestID)
	return v, started, err
}

// Get returns the current brief with freshly computed facts.
func (s *Service) Get(ctx context.Context, t store.Tenant, requestID uuid.UUID) (View, error) {
	var v View
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		b, err := q.GetBrief(ctx, dbgen.GetBriefParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		evs, err := q.ListEvidenceForRequest(ctx, dbgen.ListEvidenceForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if err != nil {
			return err
		}
		v = View{State: b.State, LowEvidence: b.LowEvidence, Claim: b.Claim.String, Disproof: b.Disproof.String, FailureReason: b.FailureReason.String}
		if b.GeneratedAt.Valid {
			g := b.GeneratedAt.Time
			v.GeneratedAt = &g
		}
		v.Stale = b.State == "ready" && b.EvidenceFingerprint.String != fingerprint(evs)

		byID := map[uuid.UUID]dbgen.Evidence{}
		for _, e := range evs {
			byID[e.ID] = e
		}
		for _, id := range b.QuoteEvidenceIds {
			if e, ok := byID[id]; ok { // evidence removed since: the brief is stale, the quote is gone
				v.Quotes = append(v.Quotes, Evidence{ID: e.ID, SourceItemID: e.SourceItemID, Text: e.QuoteText, SpanStart: int(e.SpanStart), SpanEnd: int(e.SpanEnd)})
			}
		}

		im, err := q.GetRequestImpact(ctx, dbgen.GetRequestImpactParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if err != nil {
			return err
		}
		st, err := q.EvidenceWindowStats(ctx, dbgen.EvidenceWindowStatsParams{WorkspaceID: t.WorkspaceID, RequestID: requestID, Since: time.Now().AddDate(0, 0, -30)})
		if err != nil {
			return err
		}
		accts, err := q.ListRequestAccounts(ctx, dbgen.ListRequestAccountsParams{WorkspaceID: t.WorkspaceID, RequestID: requestID})
		if err != nil {
			return err
		}
		v.Facts = Facts{
			EvidenceCount: int(im.EvidenceCount), NewLast30Days: int(st.Recent), Unidentified: int(st.Unidentified), PeopleCount: int(im.PeopleCount),
			AccountCount: int(im.AccountCount), AccountsWithValue: int(im.AccountsWithValue), TotalValue: numText(im.TotalValue),
			FirstEvidenceAt: tsIf(st.Total > 0, st.FirstAt), NewestEvidenceAt: tsIf(st.Total > 0, st.NewestAt),
		}
		for _, a := range accts {
			v.Facts.Accounts = append(v.Facts.Accounts, AccountFact{ID: a.ID, Name: a.Name, Revenue: numText(a.Revenue), PeopleCount: int(a.PeopleCount)})
		}
		return nil
	})
	return v, err
}

func numText(n pgtype.Numeric) string {
	v, err := n.Value()
	if err != nil || v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// tsIf returns the time only when there was evidence to take it from.
func tsIf(ok bool, t time.Time) *time.Time {
	if !ok {
		return nil
	}
	return &t
}

// Worker generates briefs in the background.
type Worker struct {
	river.WorkerDefaults[GenerateArgs]
	Pool      *pgxpool.Pool
	Completer Completer
}

func (w *Worker) Work(ctx context.Context, job *river.Job[GenerateArgs]) error {
	if w.Completer == nil {
		return river.JobSnooze(5 * time.Minute) // no AI provider configured here: wait without using up attempts
	}
	a := job.Args
	t := store.Tenant{WorkspaceID: a.WorkspaceID, UserID: a.UserID, Role: store.RoleMember}
	ctx = store.WithContext(ctx, t) // so the AI event recorder can write tenant-scoped rows

	var title string
	var evs []dbgen.Evidence
	var state string
	err := store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		b, err := q.GetBrief(ctx, dbgen.GetBriefParams{WorkspaceID: t.WorkspaceID, RequestID: a.RequestID})
		if err != nil {
			return err
		}
		state = b.State
		r, err := q.GetRequest(ctx, dbgen.GetRequestParams{WorkspaceID: t.WorkspaceID, ID: a.RequestID})
		if err != nil {
			return err
		}
		title = r.Title
		evs, err = q.ListEvidenceForRequest(ctx, dbgen.ListEvidenceForRequestParams{WorkspaceID: t.WorkspaceID, RequestID: a.RequestID})
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // the request or brief was deleted while this job waited
	}
	if err != nil {
		return err
	}
	if state != "pending" || len(evs) == 0 {
		return nil // already done, or nothing to write about
	}

	quotes := make([]Quote, len(evs)) // newest first, as the query returns them
	for i, e := range evs {
		quotes[i] = Quote{ID: e.ID, Text: e.QuoteText}
	}
	out, resp, genErr := Generate(ctx, w.Completer, title, quotes, len(evs))
	if errors.Is(genErr, ai.ErrBudgetExceeded) {
		return river.JobSnooze(30 * time.Minute) // wait for the allowance rather than fail the brief
	}
	if genErr != nil {
		if job.Attempt >= job.MaxAttempts {
			reason := "could not write a brief"
			if errors.Is(genErr, ai.ErrNoRoute) {
				reason = "no AI provider is approved for customer data"
			}
			_ = store.WithTenant(context.WithoutCancel(ctx), w.Pool, t, func(q *dbgen.Queries) error {
				return q.FailBrief(ctx, dbgen.FailBriefParams{WorkspaceID: t.WorkspaceID, RequestID: a.RequestID, FailureReason: pgtype.Text{String: reason, Valid: true}})
			})
		}
		return fmt.Errorf("generate brief: %w", genErr)
	}
	return store.WithTenant(ctx, w.Pool, t, func(q *dbgen.Queries) error {
		return q.CompleteBrief(ctx, dbgen.CompleteBriefParams{
			WorkspaceID: t.WorkspaceID, RequestID: a.RequestID,
			Claim: pgtype.Text{String: out.Claim, Valid: true}, Disproof: pgtype.Text{String: out.Disproof, Valid: true},
			QuoteEvidenceIds: out.QuoteIDs, EvidenceFingerprint: pgtype.Text{String: fingerprint(evs), Valid: true},
			LowEvidence:   len(evs) < lowEvidenceBelow,
			PromptVersion: pgtype.Text{String: PromptVersion, Valid: true},
			Provider:      pgtype.Text{String: resp.Provider, Valid: resp.Provider != ""}, Model: pgtype.Text{String: resp.Model, Valid: resp.Model != ""},
		})
	})
}
