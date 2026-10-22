// Package quality reports how often the machine's suggestions are right, from
// what people did with them, and what the AI costs. It is the evidence for
// whether auto-accept should ever be offered.
package quality

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// MinDecided is how many decisions we need before showing rates; below it the
// numbers are noise and showing them would mislead.
const MinDecided = 20

type Counts struct {
	Accepted, AcceptedEdited, Dismissed, StillOpen int
}

// Decided is how many suggestions a person has ruled on.
func (c Counts) Decided() int { return c.Accepted + c.Dismissed }

// Rates are fractions of decided suggestions; nil when nothing was decided.
type Rates struct {
	Accepted         *float64 // accepted / decided
	AcceptedAsIs     *float64 // accepted without a change / decided
	EditedOfAccepted *float64 // accepted with a change / accepted
	Dismissed        *float64 // dismissed / decided
}

func (c Counts) Rates() Rates {
	var r Rates
	if d := c.Decided(); d > 0 {
		a, asIs, dm := frac(c.Accepted, d), frac(c.Accepted-c.AcceptedEdited, d), frac(c.Dismissed, d)
		r.Accepted, r.AcceptedAsIs, r.Dismissed = &a, &asIs, &dm
	}
	if c.Accepted > 0 {
		e := frac(c.AcceptedEdited, c.Accepted)
		r.EditedOfAccepted = &e
	}
	return r
}

func frac(n, d int) float64 { return float64(n) / float64(d) }

type SourceStats struct {
	Kind   string
	Counts Counts
	Rates  Rates
}

type WeekStats struct {
	WeekStart time.Time
	Counts    Counts
	Rates     Rates
}

type AICost struct {
	Task                      string
	Calls, Errors             int
	CostUSD                   string
	InputTokens, OutputTokens int64
}

type View struct {
	Days       int
	Total      Counts
	Rates      Rates
	EnoughData bool // false until MinDecided suggestions have been ruled on
	BySource   []SourceStats
	ByWeek     []WeekStats
	AI         []AICost
}

type Service struct{ Pool *pgxpool.Pool }

func (s *Service) Get(ctx context.Context, t store.Tenant, days int) (View, error) {
	if days < 1 || days > 365 {
		days = 30
	}
	since := time.Now().AddDate(0, 0, -days)
	v := View{Days: days}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.QualityByWeek(ctx, dbgen.QualityByWeekParams{WorkspaceID: t.WorkspaceID, CreatedAt: since})
		if err != nil {
			return err
		}
		bySource := map[string]*Counts{}
		byWeek := map[time.Time]*Counts{}
		for _, r := range rows {
			add := Counts{Accepted: int(r.Accepted), AcceptedEdited: int(r.AcceptedEdited), Dismissed: int(r.Dismissed), StillOpen: int(r.StillOpen)}
			merge(&v.Total, add)
			if bySource[r.SourceKind] == nil {
				bySource[r.SourceKind] = &Counts{}
			}
			merge(bySource[r.SourceKind], add)
			if byWeek[r.Week] == nil {
				byWeek[r.Week] = &Counts{}
			}
			merge(byWeek[r.Week], add)
		}
		for k, c := range bySource {
			v.BySource = append(v.BySource, SourceStats{Kind: k, Counts: *c, Rates: c.Rates()})
		}
		sort.Slice(v.BySource, func(i, j int) bool { return v.BySource[i].Kind < v.BySource[j].Kind })
		for w, c := range byWeek {
			v.ByWeek = append(v.ByWeek, WeekStats{WeekStart: w, Counts: *c, Rates: c.Rates()})
		}
		sort.Slice(v.ByWeek, func(i, j int) bool { return v.ByWeek[i].WeekStart.Before(v.ByWeek[j].WeekStart) })

		costs, err := q.AICostByTask(ctx, dbgen.AICostByTaskParams{WorkspaceID: t.WorkspaceID, CreatedAt: since})
		for _, c := range costs {
			v.AI = append(v.AI, AICost{Task: c.Task, Calls: int(c.Calls), Errors: int(c.Errors), CostUSD: numText(c.CostUsd), InputTokens: c.InputTokens, OutputTokens: c.OutputTokens})
		}
		return err
	})
	v.Rates = v.Total.Rates()
	v.EnoughData = v.Total.Decided() >= MinDecided
	return v, err
}

func merge(dst *Counts, add Counts) {
	dst.Accepted += add.Accepted
	dst.AcceptedEdited += add.AcceptedEdited
	dst.Dismissed += add.Dismissed
	dst.StillOpen += add.StillOpen
}

func numText(n pgtype.Numeric) string {
	v, err := n.Value()
	if err != nil || v == nil {
		return "0"
	}
	return fmt.Sprint(v)
}
