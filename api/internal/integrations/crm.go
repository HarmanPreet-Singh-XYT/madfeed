package integrations

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// The part of a CRM sync that does not depend on which CRM it is: read the people we have, and apply what the CRM
// said about their companies. A CRM-specific file only has to find, for each email, the company it works at and a
// value for it.

// MaxSyncPeople bounds one sync: the people with an email address, in the order they were added.
const MaxSyncPeople = 5000

// CRMRun is what the last sync did.
type CRMRun struct {
	At              time.Time `json:"at"`
	OK              bool      `json:"ok"`
	Error           string    `json:"error,omitempty"`
	People          int       `json:"people"`          // people with an email we looked up
	Matched         int       `json:"matched"`         // of those, found in the CRM with a company
	PeopleLinked    int       `json:"peopleLinked"`    // given an account they did not have
	AccountsCreated int       `json:"accountsCreated"` // new accounts
	AccountsUpdated int       `json:"accountsUpdated"` // existing accounts whose value or domain was filled in
	Skipped         int       `json:"skipped"`         // a person's own account is a different company, left alone
}

// HubSpotRun is kept as a name for the same record.
type HubSpotRun = CRMRun

type crmCompany struct {
	ID, Name, Domain string
	Value            *string // money as text with two decimals
}

type syncPerson struct {
	ID          uuid.UUID
	Email       string
	AccountID   *uuid.UUID
	AccountName string
	Domain      string
}

func (s *Service) crmPeople(ctx context.Context, ws uuid.UUID) ([]syncPerson, error) {
	var people []syncPerson
	err := store.WithTenantTx(ctx, s.Pool, system(ws, store.RoleMember), func(tx pgx.Tx, _ *dbgen.Queries) error {
		rows, err := tx.Query(ctx, `
			SELECT p.id, lower(p.email), p.account_id, coalesce(a.name, ''), coalesce(a.domain, '')
			FROM person p LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id
			WHERE p.workspace_id = $1 AND p.email IS NOT NULL ORDER BY p.created_at, p.id LIMIT $2`, ws, MaxSyncPeople)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p syncPerson
			if err := rows.Scan(&p.ID, &p.Email, &p.AccountID, &p.AccountName, &p.Domain); err != nil {
				return err
			}
			people = append(people, p)
		}
		return rows.Err()
	})
	return people, err
}

// crmApply changes only what is safe: a person's own account is updated (value, domain if empty) only when it is
// the same company; a person with no account is given the matching account, or a new one; people are never
// created or deleted; nothing is written to the CRM.
func (s *Service) crmApply(ctx context.Context, ws uuid.UUID, people []syncPerson, byEmail map[string]crmCompany, run *CRMRun) error {
	return store.WithTenantTx(ctx, s.Pool, system(ws, store.RoleMember), func(tx pgx.Tx, _ *dbgen.Queries) error {
		resolved := map[string]uuid.UUID{} // the CRM's company id -> account, for people who had none
		touched := map[uuid.UUID]bool{}
		for _, p := range people {
			c, ok := byEmail[p.Email]
			if !ok {
				continue
			}
			run.Matched++
			if p.AccountID != nil {
				same := strings.EqualFold(p.AccountName, c.Name) || (p.Domain != "" && c.Domain != "" && strings.EqualFold(p.Domain, c.Domain))
				if !same {
					run.Skipped++
					continue
				}
				if !touched[*p.AccountID] {
					touched[*p.AccountID] = true
					tag, err := tx.Exec(ctx, `UPDATE account SET revenue = coalesce($3::numeric, revenue), domain = coalesce(domain, nullif($4, '')), updated_at = now()
						WHERE workspace_id = $1 AND id = $2 AND (($3::numeric IS NOT NULL AND revenue IS DISTINCT FROM $3::numeric) OR (domain IS NULL AND $4 <> ''))`,
						ws, *p.AccountID, c.Value, c.Domain)
					if err != nil {
						return err
					}
					if tag.RowsAffected() > 0 {
						run.AccountsUpdated++
					}
				}
				continue
			}
			acct, have := resolved[c.ID]
			if !have {
				var inserted bool
				err := tx.QueryRow(ctx, `
					INSERT INTO account (workspace_id, name, domain, revenue) VALUES ($1, $2, nullif($3, ''), $4::numeric)
					ON CONFLICT (workspace_id, lower(name)) DO UPDATE SET
					  revenue = coalesce(EXCLUDED.revenue, account.revenue), domain = coalesce(account.domain, EXCLUDED.domain), updated_at = now()
					RETURNING id, (xmax = 0)`, ws, c.Name, c.Domain, c.Value).Scan(&acct, &inserted)
				if err != nil {
					return err
				}
				resolved[c.ID] = acct
				switch {
				case inserted:
					run.AccountsCreated++
					touched[acct] = true
				case !touched[acct]:
					run.AccountsUpdated++
					touched[acct] = true
				}
			}
			if _, err := tx.Exec(ctx, `UPDATE person SET account_id = $3 WHERE workspace_id = $1 AND id = $2 AND account_id IS NULL`, ws, p.ID, acct); err != nil {
				return err
			}
			run.PeopleLinked++
		}
		return nil
	})
}

// CRMSyncDue runs every CRM sync that is due or asked for (HubSpot, Salesforce). One workspace failing does not
// stop the others, and a CRM that is switched off is skipped.
func (s *Service) CRMSyncDue(ctx context.Context) {
	rows, err := s.Pool.Query(ctx, `SELECT workspace_id, kind FROM integrations_crm_due()`)
	if err != nil {
		return
	}
	type item struct {
		ws   uuid.UUID
		kind string
	}
	var due []item
	for rows.Next() {
		var it item
		if rows.Scan(&it.ws, &it.kind) == nil {
			due = append(due, it)
		}
	}
	rows.Close()
	for _, it := range due {
		if !s.On(it.kind) {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		switch it.kind {
		case "hubspot":
			_, _ = s.HubSpotSync(cctx, it.ws)
		case "salesforce":
			_, _ = s.SalesforceSync(cctx, it.ws)
		}
		cancel()
	}
}

// CRMLoop runs CRMSyncDue now and then until ctx ends.
func (s *Service) CRMLoop(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = time.Minute
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.CRMSyncDue(ctx)
		}
	}
}
