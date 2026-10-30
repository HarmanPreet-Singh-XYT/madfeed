// Package quality reports how often the machine's suggestions are right, from
// what people did with them, and what the AI costs. It is the evidence for
// whether auto-accept should ever be offered.
package quality

import (
	"context"
	"encoding/json"
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

// PublicSignalCount is how many requests carry each verdict from the public-source check.
type PublicSignalCount struct {
	Verdict string
	Count   int
}

// AlreadyPossible is a request whose public check says the capability already exists: a
// documentation gap rather than work to schedule.
type AlreadyPossible struct {
	ID, Title string
	URLs      []string
}

type AICost struct {
	Task, Provider, Model     string
	Calls, Errors             int
	CostUSD                   string
	InputTokens, OutputTokens int64
}

type View struct {
	Days            int
	Total           Counts
	Rates           Rates
	Previous        Counts // the equally long window just before this one
	PreviousRates   Rates
	EnoughData      bool // false until MinDecided suggestions have been ruled on
	BySource        []SourceStats
	ByWeek          []WeekStats
	AI              []AICost
	PublicSignals   []PublicSignalCount
	AlreadyPossible []AlreadyPossible
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

		prev, err := q.QualityCountsBetween(ctx, dbgen.QualityCountsBetweenParams{
			WorkspaceID: t.WorkspaceID, CreatedAt: since.AddDate(0, 0, -days), CreatedAt_2: since,
		})
		if err != nil {
			return err
		}
		v.Previous = Counts{Accepted: int(prev.Accepted), AcceptedEdited: int(prev.AcceptedEdited), Dismissed: int(prev.Dismissed), StillOpen: int(prev.StillOpen)}

		sigs, err := q.PublicSignalCounts(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		for _, c := range sigs {
			v.PublicSignals = append(v.PublicSignals, PublicSignalCount{Verdict: c.Verdict, Count: int(c.N)})
		}
		possible, err := q.RequestsAlreadyPossible(ctx, t.WorkspaceID)
		if err != nil {
			return err
		}
		for _, r := range possible {
			ref := AlreadyPossible{ID: r.ID.String(), Title: r.Title}
			var sig struct {
				Sources []struct {
					URL string `json:"url"`
				} `json:"sources"`
			}
			if len(r.PublicSignal) > 0 && json.Unmarshal(r.PublicSignal, &sig) == nil {
				for _, s := range sig.Sources {
					if s.URL != "" {
						ref.URLs = append(ref.URLs, s.URL)
					}
				}
			}
			v.AlreadyPossible = append(v.AlreadyPossible, ref)
		}

		costs, err := q.AICostByTaskModel(ctx, dbgen.AICostByTaskModelParams{WorkspaceID: t.WorkspaceID, CreatedAt: since})
		for _, c := range costs {
			v.AI = append(v.AI, AICost{Task: c.Task, Provider: c.Provider, Model: c.Model, Calls: int(c.Calls), Errors: int(c.Errors), CostUSD: numText(c.CostUsd), InputTokens: c.InputTokens, OutputTokens: c.OutputTokens})
		}
		return err
	})
	v.Rates = v.Total.Rates()
	v.PreviousRates = v.Previous.Rates()
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
