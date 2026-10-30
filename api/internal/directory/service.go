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
	CreatedAt   time.Time
	QuoteCount  int
	LastHeardAt *time.Time
	SimilarName bool
}

// PeopleQuery narrows the people list: part of a name or email, one company, and whether an email is known.
type PeopleQuery struct {
	Search    string
	AccountID *uuid.UUID
	Email     string // "", "with" or "without"
}

// PeopleStats is the whole directory, not the filtered page.
type PeopleStats struct {
	Total        int
	WithEmail    int
	WithoutEmail int
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

// GetAccount returns one account, for naming the filter a shared link carries.
func (s *Service) GetAccount(ctx context.Context, t store.Tenant, id uuid.UUID) (Account, error) {
	var out Account
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetAccount(ctx, dbgen.GetAccountParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = Account{ID: r.ID, Name: r.Name, Domain: textPtr(r.Domain), Revenue: numericPtr(r.Revenue), Plan: textPtr(r.Plan), RenewalDate: datePtr(r.RenewalDate)}
		return nil
	})
	return out, err
}

// GetPerson returns one person, for naming the filter a shared link carries.
func (s *Service) GetPerson(ctx context.Context, t store.Tenant, id uuid.UUID) (Person, error) {
	var out Person
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.GetPerson(ctx, dbgen.GetPersonParams{WorkspaceID: t.WorkspaceID, ID: id})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out = Person{ID: r.ID, Name: r.Name, Email: textPtr(r.Email), CreatedAt: r.CreatedAt}
		if r.AccountID.Valid {
			aid := r.AccountID.UUID
			out.AccountID = &aid
		}
		return nil
	})
	return out, err
}

// CountAccounts is how many companies match the search.
func (s *Service) CountAccounts(ctx context.Context, t store.Tenant, query string) (int, error) {
	var n int
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.CountAccounts(ctx, dbgen.CountAccountsParams{WorkspaceID: t.WorkspaceID, Q: query})
		n = int(c)
		return err
	})
	return n, err
}

func (s *Service) ListAccounts(ctx context.Context, t store.Tenant, query, afterName string, afterID uuid.UUID, limit int) ([]Account, error) {
	var out []Account
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListAccounts(ctx, dbgen.ListAccountsParams{WorkspaceID: t.WorkspaceID, Q: query, AfterName: afterName, AfterID: afterID, PageSize: int32(limit)})
		for _, r := range rows {
			out = append(out, Account{ID: r.ID, Name: r.Name, Domain: textPtr(r.Domain), Revenue: numericPtr(r.Revenue), Plan: textPtr(r.Plan), RenewalDate: datePtr(r.RenewalDate), PeopleCount: int(r.PeopleCount)})
		}
		return err
	})
	return out, err
}

func personQueryParams(t store.Tenant, q PeopleQuery) dbgen.CountPeopleParams {
	p := dbgen.CountPeopleParams{WorkspaceID: t.WorkspaceID, Q: q.Search, EmailState: q.Email}
	if q.AccountID != nil {
		p.AccountID = uuid.NullUUID{UUID: *q.AccountID, Valid: true}
	}
	if q.Email != "with" && q.Email != "without" {
		p.EmailState = ""
	}
	return p
}

func (s *Service) ListPeople(ctx context.Context, t store.Tenant, query PeopleQuery, afterName string, afterID uuid.UUID, limit int) ([]Person, error) {
	var out []Person
	base := personQueryParams(t, query)
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		rows, err := q.ListPeople(ctx, dbgen.ListPeopleParams{
			WorkspaceID: t.WorkspaceID, Q: base.Q, AccountID: base.AccountID, EmailState: base.EmailState,
			AfterName: afterName, AfterID: afterID, PageSize: int32(limit),
		})
		for _, r := range rows {
			p := Person{ID: r.ID, Name: r.Name, Email: textPtr(r.Email), AccountName: textPtr(r.AccountName), CreatedAt: r.CreatedAt, QuoteCount: int(r.QuoteCount), SimilarName: r.SimilarName}
			if r.AccountID.Valid {
				id := r.AccountID.UUID
				p.AccountID = &id
			}
			if !r.LastHeard.IsZero() {
				at := r.LastHeard
				p.LastHeardAt = &at
			}
			out = append(out, p)
		}
		return err
	})
	return out, err
}

// CountPeople is how many people match the filters, for "showing 50 of 312".
func (s *Service) CountPeople(ctx context.Context, t store.Tenant, query PeopleQuery) (int, error) {
	var n int
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		c, err := q.CountPeople(ctx, personQueryParams(t, query))
		n = int(c)
		return err
	})
	return n, err
}

// PersonStats counts the whole directory: who exists, and who has an email to write to.
func (s *Service) PersonStats(ctx context.Context, t store.Tenant) (PeopleStats, error) {
	var out PeopleStats
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		r, err := q.PersonStats(ctx, t.WorkspaceID)
		out = PeopleStats{Total: int(r.Total), WithEmail: int(r.WithEmail), WithoutEmail: int(r.WithoutEmail)}
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

// Merge folds one person into another: what they said, voted on, were invited to and talked to us in moves to
// the surviving person, then the other row is deleted. It refuses when both were told about the same request,
// because one of the two send records would have to be dropped. Admin only, one transaction, nothing partial.
// MergeAccounts folds one company into another: its people and saved views move to the survivor, which keeps its
// own name and any value it already has. Missing details (domain, revenue, plan, renewal) come from the other.
// Admin only, one transaction; the person/account triggers keep request impact correct as people move.
func (s *Service) MergeAccounts(ctx context.Context, t store.Tenant, sourceID, targetID uuid.UUID) (uuid.UUID, error) {
	if !t.Can(store.PermManage) {
		return uuid.Nil, store.ErrForbidden
	}
	if sourceID == targetID {
		return uuid.Nil, ErrInvalid("choose two different companies")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		first, second := sourceID, targetID
		if second.String() < first.String() {
			first, second = second, first
		}
		for _, id := range []uuid.UUID{first, second} {
			if _, err := q.LockAccount(ctx, dbgen.LockAccountParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
		}
		src, err := q.GetAccount(ctx, dbgen.GetAccountParams{WorkspaceID: t.WorkspaceID, ID: sourceID})
		if err != nil {
			return ErrNotFound
		}
		tgt, err := q.GetAccount(ctx, dbgen.GetAccountParams{WorkspaceID: t.WorkspaceID, ID: targetID})
		if err != nil {
			return ErrNotFound
		}
		fill := dbgen.MergeAccountProfileParams{WorkspaceID: t.WorkspaceID, ID: targetID}
		if !tgt.Domain.Valid && src.Domain.Valid {
			fill.FillDomain = src.Domain
		}
		if !tgt.Revenue.Valid && src.Revenue.Valid {
			fill.FillRevenue = src.Revenue
		}
		if !tgt.Plan.Valid && src.Plan.Valid {
			fill.FillPlan = src.Plan
		}
		if !tgt.RenewalDate.Valid && src.RenewalDate.Valid {
			fill.FillRenewal = src.RenewalDate
		}
		if err := q.MergeAccountProfile(ctx, fill); err != nil {
			return err
		}
		if err := q.MergeAccountPeople(ctx, dbgen.MergeAccountPeopleParams{
			WorkspaceID: t.WorkspaceID,
			AccountID:   uuid.NullUUID{UUID: src.ID, Valid: true},
			AccountID_2: uuid.NullUUID{UUID: tgt.ID, Valid: true},
		}); err != nil {
			return err
		}
		if err := q.MergeAccountQuoteViews(ctx, dbgen.MergeAccountQuoteViewsParams{
			WorkspaceID: t.WorkspaceID,
			AccountID:   uuid.NullUUID{UUID: src.ID, Valid: true},
			AccountID_2: uuid.NullUUID{UUID: tgt.ID, Valid: true},
		}); err != nil {
			return err
		}
		n, err := q.DeleteMergedAccount(ctx, dbgen.DeleteMergedAccountParams{WorkspaceID: t.WorkspaceID, ID: src.ID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return targetID, nil
}

func (s *Service) Merge(ctx context.Context, t store.Tenant, sourceID, targetID uuid.UUID) (uuid.UUID, error) {
	if !t.Can(store.PermManage) {
		return uuid.Nil, store.ErrForbidden
	}
	if sourceID == targetID {
		return uuid.Nil, ErrInvalid("choose two different people")
	}
	err := store.WithTenant(ctx, s.Pool, t, func(q *dbgen.Queries) error {
		// Lock in a fixed order so two merges of the same pair cannot deadlock.
		first, second := sourceID, targetID
		if second.String() < first.String() {
			first, second = second, first
		}
		for _, id := range []uuid.UUID{first, second} {
			if _, err := q.LockPerson(ctx, dbgen.LockPersonParams{WorkspaceID: t.WorkspaceID, ID: id}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
		}
		src, err := q.GetPerson(ctx, dbgen.GetPersonParams{WorkspaceID: t.WorkspaceID, ID: sourceID})
		if err != nil {
			return ErrNotFound
		}
		tgt, err := q.GetPerson(ctx, dbgen.GetPersonParams{WorkspaceID: t.WorkspaceID, ID: targetID})
		if err != nil {
			return ErrNotFound
		}

		conflicts, err := q.OutreachMergeConflicts(ctx, dbgen.OutreachMergeConflictsParams{
			WorkspaceID: t.WorkspaceID, SourceID: sourceID, TargetID: targetID,
		})
		if err != nil {
			return err
		}
		if conflicts > 0 {
			return ErrInvalid(fmt.Sprintf("both people were told about %d request%s, so merging would lose one send record; nothing changed", conflicts, plural(conflicts)))
		}

		if err := q.DropDuplicateVotes(ctx, dbgen.DropDuplicateVotesParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		if err := q.MergeVotes(ctx, dbgen.MergeVotesParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		if err := q.DropDuplicateSurveyInvites(ctx, dbgen.DropDuplicateSurveyInvitesParams{WorkspaceID: t.WorkspaceID, PersonID: src.ID, PersonID_2: tgt.ID}); err != nil {
			return err
		}
		if err := q.MergeSurveyInvites(ctx, dbgen.MergeSurveyInvitesParams{WorkspaceID: t.WorkspaceID, PersonID: src.ID, PersonID_2: tgt.ID}); err != nil {
			return err
		}
		if err := q.MergeSurveyResponses(ctx, dbgen.MergeSurveyResponsesParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		if err := q.MergeMedia(ctx, dbgen.MergeMediaParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		if err := q.MergeConversations(ctx, dbgen.MergeConversationsParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		if err := q.MergeQuoteViews(ctx, dbgen.MergeQuoteViewsParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		if err := q.MergeOutreach(ctx, dbgen.MergeOutreachParams{WorkspaceID: t.WorkspaceID, PersonID: src.ID, PersonID_2: tgt.ID}); err != nil {
			return err
		}
		if err := q.MergeSourceItems(ctx, dbgen.MergeSourceItemsParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		if err := q.MergeEvidence(ctx, dbgen.MergeEvidenceParams{WorkspaceID: t.WorkspaceID, PersonID: nu(src.ID), PersonID_2: nu(tgt.ID)}); err != nil {
			return err
		}
		n, err := q.DeleteMergedPerson(ctx, dbgen.DeleteMergedPersonParams{WorkspaceID: t.WorkspaceID, ID: src.ID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		// Fill the survivor only after the source row is gone: its email still holds the unique index until then.
		p := dbgen.MergePersonProfileParams{WorkspaceID: t.WorkspaceID, ID: targetID}
		if !tgt.Email.Valid && src.Email.Valid {
			p.FillEmail = src.Email
		}
		if !tgt.AccountID.Valid && src.AccountID.Valid {
			p.FillAccount = src.AccountID
		}
		return q.MergePersonProfile(ctx, p)
	})
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23503" {
		return uuid.Nil, ErrInvalid("that person is still linked to something that cannot be merged")
	}
	if err != nil {
		return uuid.Nil, err
	}
	return targetID, nil
}

func nu(id uuid.UUID) uuid.NullUUID { return uuid.NullUUID{UUID: id, Valid: true} }

func plural(n int32) string {
	if n == 1 {
		return ""
	}
	return "s"
}
