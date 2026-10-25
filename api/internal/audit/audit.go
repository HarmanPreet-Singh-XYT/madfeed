// Package audit puts a few of the assistant's answers and briefs in front of an
// admin every week to be checked against the quotes they cite. It exists
// because a quality number measured once, before release, says little about
// the live product.
package audit

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/brief"
	"product/api/internal/redact"
	"product/api/internal/research"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

var ErrNotFound = errors.New("audit: not found")

type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

const PerWeek = 3

type Quote struct {
	Text         string
	SourceItemID uuid.UUID
	SpanStart    int
	SpanEnd      int
}

type Item struct {
	ID       uuid.UUID
	Kind     string // answer or brief
	Sampled  time.Time
	Heading  string // the question asked, or the request's claim context
	Text     string // the answer, or the brief's claim
	Quotes   []Quote
	Verdict  string // empty until reviewed
	Note     string
	Reviewed *time.Time
	Gone     bool // what was sampled has since been deleted
}

type Summary struct {
	Reviewed, Supported, Waiting int
}

type Service struct {
	Pool  *pgxpool.Pool
	QA    *research.QA
	Brief *brief.Service
}

// SampleAll adds this week's samples for every workspace; called by the worker.
func (s *Service) SampleAll(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `SELECT sample_for_audit($1)`, PerWeek).Scan(&n)
	return n, err
}

// Loop samples once at start and then daily (a no-op until a workspace is below its weekly quota).
func (s *Service) Loop(ctx context.Context, log *slog.Logger) {
	if log == nil {
		log = slog.Default()
	}
	t := time.NewTicker(24 * time.Hour)
	defer t.Stop()
	for {
		if n, err := s.SampleAll(ctx); err != nil {
			log.Error("audit sampling failed", "error", err.Error())
		} else if n > 0 {
			log.Info("audit samples added", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// List shows an admin what to check (unreviewed first) with the content to judge it by.
func (s *Service) List(ctx context.Context, t store.Tenant) ([]Item, Summary, error) {
	if !t.Can(store.PermManage) {
		return nil, Summary{}, store.ErrForbidden
	}
	var rows []dbgen.AuditSample
	var sum Summary
	if err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		var err error
		if rows, err = q.ListAuditSamples(ctx, dbgen.ListAuditSamplesParams{WorkspaceID: t.WorkspaceID, PageSize: 30}); err != nil {
			return err
		}
		tot, err := q.AuditTotals(ctx, t.WorkspaceID)
		sum = Summary{Reviewed: int(tot.Reviewed), Supported: int(tot.Supported), Waiting: int(tot.Waiting)}
		return err
	}); err != nil {
		return nil, sum, err
	}
	out := make([]Item, 0, len(rows))
	for _, r := range rows {
		it := Item{ID: r.ID, Kind: r.Kind, Sampled: r.SampledAt, Verdict: r.Verdict.String, Note: r.Note}
		if r.ReviewedAt.Valid {
			rt := r.ReviewedAt.Time
			it.Reviewed = &rt
		}
		switch r.Kind {
		case "answer":
			a, err := s.QA.Get(ctx, t, r.RefID)
			if errors.Is(err, research.ErrNotFound) {
				it.Gone = true
			} else if err != nil {
				return nil, sum, err
			} else {
				it.Heading, it.Text = a.Question, a.Text
				for _, c := range a.Citations {
					it.Quotes = append(it.Quotes, Quote{Text: c.Quote, SourceItemID: c.SourceItemID, SpanStart: c.SpanStart, SpanEnd: c.SpanEnd})
				}
			}
		case "brief":
			v, err := s.Brief.Get(ctx, t, r.RefID)
			if errors.Is(err, brief.ErrNotFound) {
				it.Gone = true
			} else if err != nil {
				return nil, sum, err
			} else {
				it.Heading, it.Text = "Decision brief", v.Claim
				for _, q := range v.Quotes {
					it.Quotes = append(it.Quotes, Quote{Text: q.Text, SourceItemID: q.SourceItemID, SpanStart: q.SpanStart, SpanEnd: q.SpanEnd})
				}
			}
		}
		out = append(out, it)
	}
	return out, sum, nil
}

// Review records an admin's verdict. A sample is judged once.
func (s *Service) Review(ctx context.Context, t store.Tenant, id uuid.UUID, verdict, note string) error {
	if !t.Can(store.PermManage) {
		return store.ErrForbidden
	}
	if verdict != "supported" && verdict != "not_supported" {
		return ErrInvalid("the verdict must be supported or not supported")
	}
	note = redact.Text(strings.TrimSpace(note)).Text
	if utf8.RuneCountInString(note) > 500 {
		return ErrInvalid("a note can be at most 500 characters")
	}
	return store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetAuditSampleForUpdate(ctx, dbgen.GetAuditSampleForUpdateParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if r.Verdict.Valid {
			return ErrConflict("this one has already been checked")
		}
		return q.ReviewAuditSample(ctx, dbgen.ReviewAuditSampleParams{WorkspaceID: t.WorkspaceID, ID: id,
			Verdict: pgtype.Text{String: verdict, Valid: true}, Note: note, ReviewedBy: uuid.NullUUID{UUID: t.UserID, Valid: true}})
	})
}
