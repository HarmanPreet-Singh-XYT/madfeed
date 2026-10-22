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
	if people, err := svc.ListPeople(ctx, viewer, "", uuid.Nil, 50); err != nil || len(people) != 4 {
		t.Fatalf("viewer list: %v %d", err, len(people))
	}
	// B cannot see or touch A's people by id.
	aPeople, _ := svc.ListPeople(ctx, a, "", uuid.Nil, 50)
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
	people, _ := svc.ListPeople(ctx, ten, "", uuid.Nil, 50)
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

	accts, _ := svc.ListAccounts(ctx, ten, "", uuid.Nil, 50)
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
