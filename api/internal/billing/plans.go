// Package billing decides what each workspace may use, from the plan it pays for, and keeps that in step
// with the payment provider (Stripe) through its notifications. The plans themselves (names, prices, what
// each includes) are the owner's to choose: they live in a settings file, not in code.
package billing

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"

	"product/api/internal/modules"
)

// Entitlements are what a plan includes.
type Entitlements struct {
	AIBudgetUSD  float64 `json:"aiBudgetUsd"`  // what the model may cost per day for this workspace
	Recordings   bool    `json:"recordings"`   // upload recordings for transcription
	APIKeys      int     `json:"apiKeys"`      // active API keys (0 to 10)
	PublicPages  bool    `json:"publicPages"`  // website form, public roadmap and votes
	Digest       bool    `json:"digest"`       // the weekly team digest
	Surveys      bool    `json:"surveys"`      // surveys and survey invitations
	Integrations bool    `json:"integrations"` // Slack and the issue tracker
	// Modules are the tools the plan switches on (see package modules). Leave it out for all of them.
	Modules []string `json:"modules,omitempty"`
}

// ModuleSet is Modules as a set; an empty list means every tool.
func (e Entitlements) ModuleSet() modules.Set { return modules.NewSet(e.Modules) }

type Plan struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	PriceText     string       `json:"priceText"`     // shown as is, for example "$29 a month"; Stripe holds the real price
	StripePriceID string       `json:"stripePriceId"` // empty: not for sale (yet)
	Entitlements  Entitlements `json:"entitlements"`
}

// PlanSet is the list of plans. "free" always exists: it is what a workspace falls back to.
type PlanSet struct {
	Plans []Plan `json:"plans"`
}

var planID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)
var priceID = regexp.MustCompile(`^price_[A-Za-z0-9]{6,80}$`)

// DefaultPlans is used when no plans file is given. The paid plans have no price attached, so nothing can be
// bought until the owner sets real ones.
func DefaultPlans() PlanSet {
	return PlanSet{Plans: []Plan{
		{ID: "free", Name: "Free", PriceText: "Free", Entitlements: Entitlements{AIBudgetUSD: 1}},
		{ID: "team", Name: "Team", Entitlements: Entitlements{AIBudgetUSD: 5, Recordings: true, APIKeys: 3, PublicPages: true, Digest: true, Surveys: true, Integrations: true}},
		{ID: "business", Name: "Business", Entitlements: Entitlements{AIBudgetUSD: 25, Recordings: true, APIKeys: 10, PublicPages: true, Digest: true, Surveys: true, Integrations: true}},
	}}
}

func (p PlanSet) Validate() error {
	seen, prices := map[string]bool{}, map[string]bool{}
	for _, pl := range p.Plans {
		if !planID.MatchString(pl.ID) || seen[pl.ID] {
			return fmt.Errorf("plan id %q is not valid or is repeated", pl.ID)
		}
		seen[pl.ID] = true
		if pl.Name == "" || len(pl.Name) > 60 || len(pl.PriceText) > 60 {
			return fmt.Errorf("plan %q needs a name of up to 60 characters", pl.ID)
		}
		e := pl.Entitlements
		if e.AIBudgetUSD <= 0 || e.AIBudgetUSD > 1000 || e.APIKeys < 0 || e.APIKeys > 10 {
			return fmt.Errorf("plan %q: aiBudgetUsd must be above 0 and at most 1000, apiKeys from 0 to 10", pl.ID)
		}
		for _, m := range e.Modules {
			if !modules.Valid(modules.ID(m)) {
				return fmt.Errorf("plan %q: %q is not a tool (use %v)", pl.ID, m, modules.All())
			}
		}
		if pl.StripePriceID != "" {
			if pl.ID == "free" {
				return fmt.Errorf("the free plan cannot have a price")
			}
			if !priceID.MatchString(pl.StripePriceID) || prices[pl.StripePriceID] {
				return fmt.Errorf("plan %q: stripePriceId must be a Stripe price id (price_...) used by one plan only", pl.ID)
			}
			prices[pl.StripePriceID] = true
		}
	}
	if !seen["free"] {
		return fmt.Errorf("there must be a plan with the id \"free\"")
	}
	return nil
}

// LoadPlans reads the plans file; an empty path means the defaults.
func LoadPlans(path string) (PlanSet, error) {
	if path == "" {
		return DefaultPlans(), nil
	}
	b, err := os.ReadFile(path) // #nosec G304 -- an operator-set setting, not user input
	if err != nil {
		return PlanSet{}, fmt.Errorf("plans file: %w", err)
	}
	var ps PlanSet
	dec := json.NewDecoder(bytesReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&ps); err != nil {
		return PlanSet{}, fmt.Errorf("plans file: %w", err)
	}
	return ps, ps.Validate()
}

func (p PlanSet) Get(id string) (Plan, bool) {
	for _, pl := range p.Plans {
		if pl.ID == id {
			return pl, true
		}
	}
	return Plan{}, false
}

func (p PlanSet) Free() Plan { pl, _ := p.Get("free"); return pl }

func (p PlanSet) ByPrice(price string) (Plan, bool) {
	if price == "" {
		return Plan{}, false
	}
	for _, pl := range p.Plans {
		if pl.StripePriceID == price {
			return pl, true
		}
	}
	return Plan{}, false
}
