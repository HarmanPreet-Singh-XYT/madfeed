package directory

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
)

// ErrInvalid is input the caller must fix; the message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

// ErrConflict means the change would duplicate something that already exists.
type ErrConflict string

func (e ErrConflict) Error() string { return string(e) }

var ErrNotFound = errors.New("directory: not found")

type Service struct{ Pool *pgxpool.Pool }

type Account struct {
	ID          uuid.UUID
	Name        string
	Domain      *string
	Revenue     *string // decimal text
	Plan        *string
	RenewalDate *string // YYYY-MM-DD
	PeopleCount int
}

type Person struct {
	ID          uuid.UUID
	Name        string
	Email       *string
	AccountID   *uuid.UUID
	AccountName *string
}

type AccountInput struct {
	Name, Domain, Plan string
	Revenue            string // decimal text, "" for none
	RenewalDate        string // YYYY-MM-DD, "" for none
}

type PersonInput struct {
	Name      string
	Email     string
	AccountID *uuid.UUID
}

func (s *Service) ListAccounts(ctx context.Context, t store.Tenant, afterName string, afterID uuid.UUID, limit int) ([]Account, error) {
	var out []Account
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListAccounts(ctx, dbgen.ListAccountsParams{WorkspaceID: t.WorkspaceID, AfterName: afterName, AfterID: afterID, PageSize: int32(limit)})
		for _, r := range rows {
			out = append(out, Account{ID: r.ID, Name: r.Name, Domain: textPtr(r.Domain), Revenue: numericPtr(r.Revenue), Plan: textPtr(r.Plan), RenewalDate: datePtr(r.RenewalDate), PeopleCount: int(r.PeopleCount)})
		}
		return err
	})
	return out, err
}

func (s *Service) ListPeople(ctx context.Context, t store.Tenant, afterName string, afterID uuid.UUID, limit int) ([]Person, error) {
	var out []Person
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListPeople(ctx, dbgen.ListPeopleParams{WorkspaceID: t.WorkspaceID, AfterName: afterName, AfterID: afterID, PageSize: int32(limit)})
		for _, r := range rows {
			p := Person{ID: r.ID, Name: r.Name, Email: textPtr(r.Email), AccountName: textPtr(r.AccountName)}
			if r.AccountID.Valid {
				id := r.AccountID.UUID
				p.AccountID = &id
			}
			out = append(out, p)
		}
		return err
	})
	return out, err
}

func (s *Service) CreateAccount(ctx context.Context, t store.Tenant, in AccountInput) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	p, err := accountParams(in)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		a, err := q.CreateAccount(ctx, dbgen.CreateAccountParams{WorkspaceID: t.WorkspaceID, Name: p.Name, Domain: p.Domain, Revenue: p.Revenue, Plan: p.Plan, RenewalDate: p.RenewalDate})
		id = a.ID
		return err
	})
	return id, mapDup(err, "an account with that name already exists")
}

func (s *Service) UpdateAccount(ctx context.Context, t store.Tenant, id uuid.UUID, in AccountInput) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	p, err := accountParams(in)
	if err != nil {
		return err
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdateAccount(ctx, dbgen.UpdateAccountParams{WorkspaceID: t.WorkspaceID, ID: id, Name: p.Name, Domain: p.Domain, Revenue: p.Revenue, Plan: p.Plan, RenewalDate: p.RenewalDate})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
	return mapDup(err, "an account with that name already exists")
}

func (s *Service) CreatePerson(ctx context.Context, t store.Tenant, in PersonInput) (uuid.UUID, error) {
	if !t.CanWrite() {
		return uuid.Nil, store.ErrForbidden
	}
	name, email, err := personFields(in)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		p, err := q.InsertPerson(ctx, dbgen.InsertPersonParams{WorkspaceID: t.WorkspaceID, Name: name, Email: email, AccountID: nullUUID(in.AccountID)})
		id = p.ID
		return err
	})
	return id, mapDup(mapFK(err), "a person with that email already exists")
}

func (s *Service) UpdatePerson(ctx context.Context, t store.Tenant, id uuid.UUID, in PersonInput) error {
	if !t.CanWrite() {
		return store.ErrForbidden
	}
	name, email, err := personFields(in)
	if err != nil {
		return err
	}
	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		n, err := q.UpdatePerson(ctx, dbgen.UpdatePersonParams{WorkspaceID: t.WorkspaceID, ID: id, Name: name, Email: email, AccountID: nullUUID(in.AccountID)})
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
	return mapDup(mapFK(err), "a person with that email already exists")
}

type ImportResult struct {
	AccountsCreated, AccountsUpdated int
	PeopleCreated, PeopleUpdated     int
	Skipped                          int
}

// Import writes the file in one transaction. Rows with problems stop the whole
// import unless skipInvalid is set, in which case they are left out and counted.
func (s *Service) Import(ctx context.Context, t store.Tenant, raw []byte, mapping Mapping, skipInvalid bool) (ImportResult, error) {
	var res ImportResult
	if !t.CanWrite() {
		return res, store.ErrForbidden
	}
	p, err := Parse(raw, mapping)
	if err != nil {
		var ef ErrFile
		if errors.As(err, &ef) {
			return res, ErrInvalid(ef.Error())
		}
		return res, err
	}
	if p.ErrorCount > 0 && !skipInvalid {
		return res, ErrInvalid(fmt.Sprintf("%d problem(s) in the file, starting with %s. Fix them, or choose to skip the rows that have problems.", p.ErrorCount, p.Errors[0]))
	}
	res.Skipped = p.TotalRows - len(p.Records)

	err = store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		// One upsert per distinct account, using the first non-empty value of each field.
		type acct struct{ domain, plan, revenue, renewal string }
		order := []string{}
		accts := map[string]*acct{}
		for _, r := range p.Records {
			if r.Account == "" {
				continue
			}
			k := strings.ToLower(r.Account)
			a, ok := accts[k]
			if !ok {
				a = &acct{}
				accts[k] = a
				order = append(order, r.Account)
			}
			a.domain, a.plan, a.revenue, a.renewal = first(a.domain, r.Domain), first(a.plan, r.Plan), first(a.revenue, r.Revenue), first(a.renewal, r.Renewal)
		}
		ids := map[string]uuid.UUID{}
		for _, name := range order {
			a := accts[strings.ToLower(name)]
			ap, err := accountParams(AccountInput{Name: name, Domain: a.domain, Plan: a.plan, Revenue: a.revenue, RenewalDate: a.renewal})
			if err != nil {
				return err
			}
			row, err := q.UpsertAccountByName(ctx, dbgen.UpsertAccountByNameParams{WorkspaceID: t.WorkspaceID, Name: ap.Name, Domain: ap.Domain, Revenue: ap.Revenue, Plan: ap.Plan, RenewalDate: ap.RenewalDate})
			if err != nil {
				return fmt.Errorf("account %q: %w", name, err)
			}
			ids[strings.ToLower(name)] = row.ID
			if row.Inserted {
				res.AccountsCreated++
			} else {
				res.AccountsUpdated++
			}
		}
		for _, r := range p.Records {
			var acc uuid.NullUUID
			if r.Account != "" {
				acc = uuid.NullUUID{UUID: ids[strings.ToLower(r.Account)], Valid: true}
			}
			name := r.Name
			if name == "" {
				name = r.Email
			}
			if r.Email != "" {
				row, err := q.UpsertPersonByEmail(ctx, dbgen.UpsertPersonByEmailParams{WorkspaceID: t.WorkspaceID, Name: name, Email: pgtype.Text{String: r.Email, Valid: true}, AccountID: acc})
				if err != nil {
					return fmt.Errorf("row %d: %w", r.Row, err)
				}
				if row.Inserted {
					res.PeopleCreated++
				} else {
					res.PeopleUpdated++
				}
				continue
			}
			existing, err := q.FindPersonByNameAndAccount(ctx, dbgen.FindPersonByNameAndAccountParams{WorkspaceID: t.WorkspaceID, Lower: name, AccountID: acc})
			if err == nil {
				_ = existing
				res.PeopleUpdated++
				continue
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if _, err := q.InsertPerson(ctx, dbgen.InsertPersonParams{WorkspaceID: t.WorkspaceID, Name: name, AccountID: acc}); err != nil {
				return fmt.Errorf("row %d: %w", r.Row, err)
			}
			res.PeopleCreated++
		}
		return nil
	})
	return res, err
}

// --- helpers ---

type acctParams struct {
	Name        string
	Domain      pgtype.Text
	Revenue     pgtype.Numeric
	Plan        pgtype.Text
	RenewalDate pgtype.Date
}

func accountParams(in AccountInput) (acctParams, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > 200 {
		return acctParams{}, ErrInvalid("account name must be 1 to 200 characters")
	}
	p := acctParams{Name: name}
	if d := strings.ToLower(strings.TrimSpace(in.Domain)); d != "" {
		if len(d) > 253 {
			return p, ErrInvalid("domain is too long")
		}
		p.Domain = pgtype.Text{String: d, Valid: true}
	}
	if pl := strings.TrimSpace(in.Plan); pl != "" {
		if len(pl) > 100 {
			return p, ErrInvalid("plan is too long")
		}
		p.Plan = pgtype.Text{String: pl, Valid: true}
	}
	if in.Revenue != "" {
		v, err := parseRevenue(in.Revenue)
		if err != nil {
			return p, ErrInvalid(err.Error())
		}
		if err := p.Revenue.Scan(v); err != nil {
			return p, ErrInvalid("revenue is not a valid number")
		}
	}
	if in.RenewalDate != "" {
		d, err := time.Parse("2006-01-02", in.RenewalDate)
		if err != nil {
			return p, ErrInvalid("renewal date must look like 2026-03-31")
		}
		p.RenewalDate = pgtype.Date{Time: d, Valid: true}
	}
	return p, nil
}

func personFields(in PersonInput) (string, pgtype.Text, error) {
	name, email := strings.TrimSpace(in.Name), strings.ToLower(strings.TrimSpace(in.Email))
	if email != "" && (!emailRe.MatchString(email) || len(email) > 320) {
		return "", pgtype.Text{}, ErrInvalid("that is not a valid email address")
	}
	if name == "" {
		name = email
	}
	if name == "" || utf8.RuneCountInString(name) > 200 {
		return "", pgtype.Text{}, ErrInvalid("a name (or an email) is required, up to 200 characters")
	}
	return name, pgtype.Text{String: email, Valid: email != ""}, nil
}

func mapDup(err error, msg string) error {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return ErrConflict(msg)
	}
	return err
}

// mapFK turns "that account is not in this workspace" into a plain message.
func mapFK(err error) error {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23503" {
		return ErrInvalid("that account does not exist")
	}
	return err
}

func first(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func nullUUID(id *uuid.UUID) uuid.NullUUID {
	if id == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *id, Valid: true}
}

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func numericPtr(n pgtype.Numeric) *string {
	if !n.Valid {
		return nil
	}
	v, err := n.Value()
	if err != nil || v == nil {
		return nil
	}
	s := fmt.Sprint(v)
	return &s
}

func datePtr(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	s := d.Time.Format("2006-01-02")
	return &s
}
