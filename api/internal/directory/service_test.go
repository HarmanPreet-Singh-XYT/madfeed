package directory_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/directory"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

func newTenant(t *testing.T, db *testdb.DB) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: "w"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	return ten
}

func counts(t *testing.T, db *testdb.DB, ten store.Tenant) (accounts, people int) {
	t.Helper()
	if err := db.Super.QueryRow(ctx, `SELECT (SELECT count(*) FROM account WHERE workspace_id=$1), (SELECT count(*) FROM person WHERE workspace_id=$1)`, ten.WorkspaceID).Scan(&accounts, &people); err != nil {
		t.Fatal(err)
	}
	return
}

const file = `Name,Email,Company,ARR,Plan
Dana Lee,dana@acme.com,Acme Inc,"$120,000",Enterprise
Raj Patel,raj@acme.com,Acme Inc,120000,
Sam Cho,sam@globex.io,Globex,45000.50,Team
Solo Person,,,,
`

func TestImportCreatesThenUpdatesWithoutDuplicates(t *testing.T) {
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	ten := newTenant(t, db)

	res, err := svc.Import(ctx, ten, []byte(file), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if res.AccountsCreated != 2 || res.PeopleCreated != 4 || res.AccountsUpdated != 0 || res.Skipped != 0 {
		t.Fatalf("%+v", res)
	}
	accts, ppl := counts(t, db, ten)
	if accts != 2 || ppl != 4 {
		t.Fatalf("accounts=%d people=%d", accts, ppl)
	}

	// The same file again changes nothing but is reported as updates.
	res, err = svc.Import(ctx, ten, []byte(file), nil, false)
	if err != nil || res.AccountsCreated != 0 || res.PeopleCreated != 0 || res.AccountsUpdated != 2 || res.PeopleUpdated != 4 {
		t.Fatalf("%+v %v", res, err)
	}
	if a, p := counts(t, db, ten); a != 2 || p != 4 {
		t.Fatalf("re-import duplicated: accounts=%d people=%d", a, p)
	}

	// Values landed correctly and people point at their account.
	var revenue string
	var plan *string
	if err := db.Super.QueryRow(ctx, `SELECT revenue::text, plan FROM account WHERE workspace_id=$1 AND name='Acme Inc'`, ten.WorkspaceID).Scan(&revenue, &plan); err != nil || revenue != "120000.00" || plan == nil || *plan != "Enterprise" {
		t.Fatalf("%v %v %v", revenue, plan, err)
	}
	var linked int
	_ = db.Super.QueryRow(ctx, `SELECT count(*) FROM person p JOIN account a ON a.id=p.account_id WHERE p.workspace_id=$1 AND a.name='Acme Inc'`, ten.WorkspaceID).Scan(&linked)
	if linked != 2 {
		t.Fatalf("linked=%d", linked)
	}

	// A later file that omits a value does not blank what we already know.
	if _, err := svc.Import(ctx, ten, []byte("Name,Email,Company\nDana Lee,dana@acme.com,Acme Inc\n"), nil, false); err != nil {
		t.Fatal(err)
	}
	_ = db.Super.QueryRow(ctx, `SELECT revenue::text FROM account WHERE workspace_id=$1 AND name='Acme Inc'`, ten.WorkspaceID).Scan(&revenue)
	if revenue != "120000.00" {
		t.Fatalf("revenue was blanked: %s", revenue)
	}
}

func TestNothingIsWrittenWhenTheFileHasProblemsUnlessSkippingIsChosen(t *testing.T) {
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	ten := newTenant(t, db)
	bad := "Name,Email,Company,ARR\nGood,good@x.io,Acme,10\nBad,not-an-email,Acme,10\nAlso Bad,ab@x.io,Acme,lots\n"

	_, err := svc.Import(ctx, ten, []byte(bad), nil, false)
	var inv directory.ErrInvalid
	if !errors.As(err, &inv) || !strings.Contains(err.Error(), "row 3") {
		t.Fatalf("want a row-numbered invalid error, got %v", err)
	}
	if a, p := counts(t, db, ten); a != 0 || p != 0 {
		t.Fatalf("partial import: accounts=%d people=%d", a, p)
	}

	res, err := svc.Import(ctx, ten, []byte(bad), nil, true)
	if err != nil || res.Skipped != 2 || res.PeopleCreated != 1 {
		t.Fatalf("%+v %v", res, err)
	}
	if a, p := counts(t, db, ten); a != 1 || p != 1 {
		t.Fatalf("accounts=%d people=%d", a, p)
	}

	// File-level problems are plain messages too.
	if _, err := svc.Import(ctx, ten, []byte(""), nil, false); !errors.As(err, &inv) {
		t.Fatalf("empty file: %v", err)
	}
}

func TestImportsStayInsideTheirWorkspaceAndRolesApply(t *testing.T) {
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	a, b := newTenant(t, db), newTenant(t, db)
	if _, err := svc.Import(ctx, a, []byte(file), nil, false); err != nil {
		t.Fatal(err)
	}
	if acc, ppl := counts(t, db, b); acc != 0 || ppl != 0 {
		t.Fatalf("workspace B got A's data: %d %d", acc, ppl)
	}
	// B can import the same company names independently.
	if _, err := svc.Import(ctx, b, []byte(file), nil, false); err != nil {
		t.Fatal(err)
	}
	viewer := a
	viewer.Role = store.RoleViewer
	if _, err := svc.Import(ctx, viewer, []byte(file), nil, false); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer import: %v", err)
	}
	if _, err := svc.CreateAccount(ctx, viewer, directory.AccountInput{Name: "x"}); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer create: %v", err)
	}
	if people, err := svc.ListPeople(ctx, viewer, directory.PeopleQuery{}, "", uuid.Nil, 50); err != nil || len(people) != 4 {
		t.Fatalf("viewer list: %v %d", err, len(people))
	}
	// B cannot see or touch A's people by id.
	aPeople, _ := svc.ListPeople(ctx, a, directory.PeopleQuery{}, "", uuid.Nil, 50)
	if err := svc.UpdatePerson(ctx, b, aPeople[0].ID, directory.PersonInput{Name: "hijack"}); !errors.Is(err, directory.ErrNotFound) {
		t.Fatalf("cross-tenant update: %v", err)
	}
}

func TestManualAccountAndPersonEditing(t *testing.T) {
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	ten := newTenant(t, db)

	accID, err := svc.CreateAccount(ctx, ten, directory.AccountInput{Name: "Initech", Revenue: "$9,000", Plan: "Team", RenewalDate: "2026-06-30"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateAccount(ctx, ten, directory.AccountInput{Name: "initech"}); !errors.As(err, new(directory.ErrConflict)) {
		t.Fatalf("duplicate account name: %v", err)
	}
	for name, in := range map[string]directory.AccountInput{
		"blank name":  {Name: "  "},
		"bad revenue": {Name: "x", Revenue: "lots"},
		"bad date":    {Name: "x", RenewalDate: "31/12/2026"},
		"long plan":   {Name: "x", Plan: strings.Repeat("p", 101)},
	} {
		if _, err := svc.CreateAccount(ctx, ten, in); !errors.As(err, new(directory.ErrInvalid)) {
			t.Errorf("%s: %v", name, err)
		}
	}

	pid, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Pete", Email: "Pete@Initech.com", AccountID: &accID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Other", Email: "pete@initech.com"}); !errors.As(err, new(directory.ErrConflict)) {
		t.Fatalf("duplicate email: %v", err)
	}
	other := uuid.New()
	if _, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Ghost", AccountID: &other}); !errors.As(err, new(directory.ErrInvalid)) {
		t.Fatalf("unknown account: %v", err)
	}
	if err := svc.UpdatePerson(ctx, ten, pid, directory.PersonInput{Name: "Peter", Email: "pete@initech.com"}); err != nil {
		t.Fatal(err)
	}
	people, _ := svc.ListPeople(ctx, ten, directory.PeopleQuery{}, "", uuid.Nil, 50)
	var gotAcct *string
	for _, p := range people {
		if p.ID == pid {
			gotAcct = p.AccountName
			if p.Name != "Peter" || p.AccountID != nil {
				t.Fatalf("%+v", p)
			}
		}
	}
	_ = gotAcct

	accts, _ := svc.ListAccounts(ctx, ten, "", "", uuid.Nil, 50)
	if len(accts) != 1 || accts[0].Revenue == nil || *accts[0].Revenue != "9000.00" || accts[0].RenewalDate == nil || *accts[0].RenewalDate != "2026-06-30" {
		t.Fatalf("%+v", accts)
	}
}

func TestFiftyThousandRowImportCompletesInReasonableTime(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	ten := newTenant(t, db)
	var b strings.Builder
	b.WriteString("Name,Email,Company,ARR\n")
	for i := 0; i < directory.MaxCSVRows; i++ {
		fmt.Fprintf(&b, "Person %d,p%d@co%d.io,Company %d,%d\n", i, i, i%2000, i%2000, 1000+i%2000)
	}
	start := time.Now()
	res, err := svc.Import(ctx, ten, []byte(b.String()), nil, false)
	took := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("50k rows imported in %s (%+v)", took, res)
	if res.PeopleCreated != directory.MaxCSVRows || res.AccountsCreated != 2000 {
		t.Fatalf("%+v", res)
	}
	if took > 90*time.Second {
		t.Fatalf("too slow: %s", took)
	}
}

func TestOnePersonOrAccountCanBeRead(t *testing.T) {
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	ten := newTenant(t, db)

	account, err := svc.CreateAccount(ctx, ten, directory.AccountInput{Name: "Acme"})
	if err != nil {
		t.Fatal(err)
	}
	person, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Dana", AccountID: &account})
	if err != nil {
		t.Fatal(err)
	}
	gotAccount, err := svc.GetAccount(ctx, ten, account)
	if err != nil || gotAccount.Name != "Acme" {
		t.Fatalf("account = %+v, %v", gotAccount, err)
	}
	gotPerson, err := svc.GetPerson(ctx, ten, person)
	if err != nil || gotPerson.Name != "Dana" || gotPerson.AccountID == nil || *gotPerson.AccountID != account {
		t.Fatalf("person = %+v, %v", gotPerson, err)
	}
	if _, err := svc.GetPerson(ctx, ten, uuid.New()); !errors.Is(err, directory.ErrNotFound) {
		t.Fatalf("missing person = %v, want not found", err)
	}
	if _, err := svc.GetAccount(ctx, ten, uuid.New()); !errors.Is(err, directory.ErrNotFound) {
		t.Fatalf("missing account = %v, want not found", err)
	}
	other := newTenant(t, db)
	if _, err := svc.GetPerson(ctx, other, person); !errors.Is(err, directory.ErrNotFound) {
		t.Fatalf("another workspace = %v, want not found", err)
	}
}

func TestPeopleCanBeFilteredAndCarryTheirActivity(t *testing.T) {
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	ten := newTenant(t, db)

	acme, err := svc.CreateAccount(ctx, ten, directory.AccountInput{Name: "Acme"})
	if err != nil {
		t.Fatal(err)
	}
	withEmail, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Ada", Email: "ada@acme.test", AccountID: &acme})
	if err != nil {
		t.Fatal(err)
	}
	noEmail, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Grace"})
	if err != nil {
		t.Fatal(err)
	}

	// One quote for Ada, so the row can say how much she has said and when.
	var reqID, srcID, chunkID uuid.UUID
	if err := db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'SSO') RETURNING id`, ten.WorkspaceID).Scan(&reqID); err != nil {
		t.Fatal(err)
	}
	if err := db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, person_id, created_by) VALUES ($1,'paste','Call','we need sso',$2,$3,$4) RETURNING id`,
		ten.WorkspaceID, uuid.NewString(), withEmail, ten.UserID).Scan(&srcID); err != nil {
		t.Fatal(err)
	}
	if err := db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,11,'we need sso') RETURNING id`, ten.WorkspaceID, srcID).Scan(&chunkID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Super.Exec(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by, created_at) VALUES ($1,$2,$3,$4,'we need sso',0,11,$5, now() - interval '2 days')`,
		ten.WorkspaceID, reqID, srcID, chunkID, ten.UserID); err != nil {
		t.Fatal(err)
	}

	all, err := svc.ListPeople(ctx, ten, directory.PeopleQuery{}, "", uuid.Nil, 50)
	if err != nil || len(all) != 2 {
		t.Fatalf("all = %+v, %v", all, err)
	}
	var ada directory.Person
	for _, p := range all {
		if p.ID == withEmail {
			ada = p
		}
	}
	if ada.QuoteCount != 1 || ada.LastHeardAt == nil || ada.AccountName == nil || *ada.AccountName != "Acme" {
		t.Fatalf("ada = %+v; want one quote, a last-heard time and her company", ada)
	}

	noMail, err := svc.ListPeople(ctx, ten, directory.PeopleQuery{Email: "without"}, "", uuid.Nil, 50)
	if err != nil || len(noMail) != 1 || noMail[0].ID != noEmail {
		t.Fatalf("without email = %+v, %v", noMail, err)
	}
	atAcme, err := svc.ListPeople(ctx, ten, directory.PeopleQuery{AccountID: &acme}, "", uuid.Nil, 50)
	if err != nil || len(atAcme) != 1 || atAcme[0].ID != withEmail {
		t.Fatalf("by account = %+v, %v", atAcme, err)
	}
	if n, err := svc.CountPeople(ctx, ten, directory.PeopleQuery{}); err != nil || n != 2 {
		t.Fatalf("count = %d, %v", n, err)
	}
	if n, err := svc.CountPeople(ctx, ten, directory.PeopleQuery{Email: "with"}); err != nil || n != 1 {
		t.Fatalf("count with email = %d, %v", n, err)
	}
	stats, err := svc.PersonStats(ctx, ten)
	if err != nil || stats.Total != 2 || stats.WithEmail != 1 || stats.WithoutEmail != 1 {
		t.Fatalf("stats = %+v, %v", stats, err)
	}
	if n, err := svc.CountAccounts(ctx, ten, "ac"); err != nil || n != 1 {
		t.Fatalf("account count = %d, %v", n, err)
	}
}

func TestMergingPeopleMovesEverythingAndKeepsSendHistory(t *testing.T) {
	db := testdb.New(t)
	svc := &directory.Service{Pool: db.Backend}
	ten := newTenant(t, db)
	viewer := store.Tenant{WorkspaceID: ten.WorkspaceID, UserID: uuid.New(), Role: store.RoleViewer}
	if _, err := db.Super.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ten.WorkspaceID, viewer.UserID); err != nil {
		t.Fatal(err)
	}

	acct, err := svc.CreateAccount(ctx, ten, directory.AccountInput{Name: "Acme"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Ada", Email: "ada@acme.test", AccountID: &acct})
	if err != nil {
		t.Fatal(err)
	}
	target, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Grace"})
	if err != nil {
		t.Fatal(err)
	}

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// Requests, a survey and a second survey, plus a batch per request that needs one.
	var r1, r2, r3, r4, s1, s2, b3, b4 uuid.UUID
	for _, id := range []*uuid.UUID{&r1, &r2, &r3, &r4} {
		must(db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'R') RETURNING id`, ten.WorkspaceID).Scan(id))
	}
	must(db.Super.QueryRow(ctx, `INSERT INTO survey (workspace_id, title, created_by) VALUES ($1,'S1',$2) RETURNING id`, ten.WorkspaceID, ten.UserID).Scan(&s1))
	must(db.Super.QueryRow(ctx, `INSERT INTO survey (workspace_id, title, created_by) VALUES ($1,'S2',$2) RETURNING id`, ten.WorkspaceID, ten.UserID).Scan(&s2))
	for _, p := range []struct {
		req *uuid.UUID
		id  *uuid.UUID
	}{{&r3, &b3}, {&r4, &b4}} {
		must(db.Super.QueryRow(ctx, `INSERT INTO outreach_batch (workspace_id, request_id, state, created_by) VALUES ($1,$2,'done',$3) RETURNING id`, ten.WorkspaceID, *p.req, ten.UserID).Scan(p.id))
	}

	// A quote from Ada, linked both through the source and on the evidence row.
	var src, chunk uuid.UUID
	must(db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, person_id, created_by) VALUES ($1,'paste','Call','we need sso',$2,$3,$4) RETURNING id`,
		ten.WorkspaceID, uuid.NewString(), source, ten.UserID).Scan(&src))
	must(db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,11,'we need sso') RETURNING id`, ten.WorkspaceID, src).Scan(&chunk))
	must2 := func(_ int64, err error) {}
	_, err = db.Super.Exec(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,'we need sso',0,11,$6)`,
		ten.WorkspaceID, r1, src, chunk, source, ten.UserID)
	must(err)
	must2(0, nil)

	// Votes: both voted for r1; only Ada voted for r2.
	must2(0, nil)
	for _, v := range []struct {
		req    uuid.UUID
		person uuid.UUID
	}{{r1, source}, {r1, target}, {r2, source}} {
		_, err := db.Super.Exec(ctx, `INSERT INTO request_vote (workspace_id, request_id, voter_id, person_id, verified_via) VALUES ($1,$2,$3,$4,'email')`,
			ten.WorkspaceID, v.req, uuid.New(), v.person)
		must(err)
	}

	// Invitations: both were invited to s1; only Ada to s2. One response from Ada.
	for _, v := range []struct {
		survey uuid.UUID
		person uuid.UUID
	}{{s1, source}, {s1, target}, {s2, source}} {
		_, err := db.Super.Exec(ctx, `INSERT INTO survey_invite (workspace_id, survey_id, person_id, to_email) VALUES ($1,$2,$3,'a@x.test')`,
			ten.WorkspaceID, v.survey, v.person)
		must(err)
	}
	_, err = db.Super.Exec(ctx, `INSERT INTO survey_response (workspace_id, survey_id, person_id) VALUES ($1,$2,$3)`, ten.WorkspaceID, s1, source)
	must(err)

	// A recording, a conversation, a saved quote view and one send record.
	_, err = db.Super.Exec(ctx, `INSERT INTO media (workspace_id, uploaded_by, person_id, filename, mime_type, size_bytes, storage_key) VALUES ($1,$2,$3,'a.m4a','audio/mp4',10,$4)`,
		ten.WorkspaceID, ten.UserID, source, uuid.NewString())
	must(err)
	_, err = db.Super.Exec(ctx, `INSERT INTO conversation (workspace_id, channel, person_id, ref) VALUES ($1,'chat',$2,$3)`,
		ten.WorkspaceID, source, uuid.NewString()[0:8])
	must(err)
	_, err = db.Super.Exec(ctx, `INSERT INTO quote_view (workspace_id, name, person_id, created_by) VALUES ($1,'Ada view',$2,$3)`,
		ten.WorkspaceID, source, ten.UserID)
	must(err)
	_, err = db.Super.Exec(ctx, `INSERT INTO outreach_message (workspace_id, batch_id, request_id, person_id, to_email) VALUES ($1,$2,$3,$4,'ada@acme.test')`,
		ten.WorkspaceID, b3, r3, source)
	must(err)

	if _, err := svc.Merge(ctx, viewer, source, target); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer merge = %v, want forbidden", err)
	}
	merged, err := svc.Merge(ctx, ten, source, target)
	if err != nil || merged != target {
		t.Fatalf("merge = %s, %v; want %s", merged, err, target)
	}
	got, err := svc.GetPerson(ctx, ten, target)
	if err != nil {
		t.Fatal(err)
	}
	if got.Email == nil || *got.Email != "ada@acme.test" || got.AccountID == nil || *got.AccountID != acct {
		t.Fatalf("survivor = %+v; want Ada's email and company filled in", got)
	}
	if _, err := svc.GetPerson(ctx, ten, source); !errors.Is(err, directory.ErrNotFound) {
		t.Fatalf("source still there: %v", err)
	}

	counts := []struct {
		sql  string
		want int
	}{
		{`SELECT count(*) FROM source_item WHERE person_id=$1`, 1},
		{`SELECT count(*) FROM evidence WHERE person_id=$1`, 1},
		{`SELECT count(*) FROM media WHERE person_id=$1`, 1},
		{`SELECT count(*) FROM conversation WHERE person_id=$1`, 1},
		{`SELECT count(*) FROM quote_view WHERE person_id=$1`, 1},
		{`SELECT count(*) FROM outreach_message WHERE person_id=$1`, 1},
		{`SELECT count(*) FROM request_vote WHERE person_id=$1`, 2},
		{`SELECT count(*) FROM request_vote WHERE person_id=$1 AND request_id=$2`, 1},
		{`SELECT count(*) FROM survey_invite WHERE person_id=$1`, 2},
		{`SELECT count(*) FROM survey_response WHERE person_id=$1`, 1},
	}
	for i, c := range counts {
		args := []any{target}
		if strings.Contains(c.sql, "$2") {
			args = append(args, r1)
		}
		var n int
		if err := db.Super.QueryRow(ctx, c.sql, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != c.want {
			t.Errorf("count %d = %d, want %d", i, n, c.want)
		}
	}

	// Both told about the same request: refused, and neither row changes.
	p3, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "One"})
	if err != nil {
		t.Fatal(err)
	}
	p4, err := svc.CreatePerson(ctx, ten, directory.PersonInput{Name: "Two"})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []uuid.UUID{p3, p4} {
		_, err := db.Super.Exec(ctx, `INSERT INTO outreach_message (workspace_id, batch_id, request_id, person_id, to_email) VALUES ($1,$2,$3,$4,'told@x.test')`,
			ten.WorkspaceID, b4, r4, p)
		must(err)
	}
	if _, err := svc.Merge(ctx, ten, p3, p4); err == nil {
		t.Fatal("a merge that would lose a send record must be refused")
	}
	if _, err := svc.GetPerson(ctx, ten, p3); err != nil {
		t.Fatalf("refused merge must leave both people: %v", err)
	}
	if _, err := svc.Merge(ctx, ten, p3, p3); err == nil {
		t.Fatal("merging a person into themselves must be refused")
	}
}
