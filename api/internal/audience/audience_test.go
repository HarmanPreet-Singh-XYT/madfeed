package audience_test

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/audience"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

var today = time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)

type world struct {
	ws       uuid.UUID
	user     uuid.UUID
	subjects map[uuid.UUID]audience.Subject
	requests []uuid.UUID
}

// seed builds a workspace whose people cover the awkward cases: no email, odd emails, no account, accounts
// with missing fields, mixed-case text, values on both sides of every boundary.
func seed(t *testing.T, db *testdb.DB, rnd *rand.Rand, n int) *world {
	t.Helper()
	w := &world{ws: uuid.New(), user: uuid.New(), subjects: map[uuid.UUID]audience.Subject{}}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	exec := func(q string, args ...any) {
		t.Helper()
		_, err := db.Super.Exec(ctx, q, args...)
		must(err)
	}
	exec(`INSERT INTO workspace (id, name) VALUES ($1,'Aud')`, w.ws)
	exec(`INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin')`, w.ws, w.user)
	text := "We really need single sign-on today."
	for i := 0; i < 3; i++ {
		var r uuid.UUID
		must(db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,$2) RETURNING id`, w.ws, fmt.Sprintf("Request %d", i)).Scan(&r))
		w.requests = append(w.requests, r)
	}
	plans := []string{"", "Free", "free", "Pro", "PRO", "Enterprise"}
	domains := []string{"acme.com", "Beta.IO", "gamma.co", ""}
	revenues := []string{"", "0", "99.5", "100", "100.00", "1000", "99999.99", "1000000"}
	// accounts
	type acct struct {
		id      uuid.UUID
		plan, d string
		revenue string
		renewal *time.Time
	}
	var accts []acct
	for i := 0; i < 12; i++ {
		a := acct{plan: plans[rnd.Intn(len(plans))], d: domains[rnd.Intn(len(domains))], revenue: revenues[rnd.Intn(len(revenues))]}
		if rnd.Intn(4) > 0 {
			d := today.AddDate(0, 0, rnd.Intn(80)-20)
			a.renewal = &d
		}
		var plan, dom, rev any
		if a.plan != "" {
			plan = a.plan
		}
		if a.d != "" {
			dom = a.d
		}
		if a.revenue != "" {
			rev = a.revenue
		}
		var renewal any
		if a.renewal != nil {
			renewal = *a.renewal
		}
		must(db.Super.QueryRow(ctx, `INSERT INTO account (workspace_id, name, domain, revenue, plan, renewal_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, w.ws, fmt.Sprintf("Acct %d", i), dom, rev, plan, renewal).Scan(&a.id))
		accts = append(accts, a)
	}
	emails := []string{"", "dana@acme.com", "Lee@ACME.com", "sam@beta.io", "kim@gamma.co", "odd@@acme.com", "noat", "x@sub.acme.com", "z@Beta.IO"}
	names := []string{"Dana Smith", "lee jones", "SAM O'Neil", "Kim", "Álvaro Díaz", "Pat 50% Off", "under_score", "Dana-Lee"}
	for i := 0; i < n; i++ {
		s := audience.Subject{Name: names[rnd.Intn(len(names))] + fmt.Sprint(i%3), Email: emails[rnd.Intn(len(emails))], AskedRequest: map[uuid.UUID]bool{}}
		if s.Email != "" {
			s.Email = fmt.Sprintf("p%d-%s", i, s.Email) // addresses are unique within a workspace
		}
		added := today.AddDate(0, 0, -rnd.Intn(60)).Add(time.Duration(rnd.Intn(86400)) * time.Second)
		s.Added = added
		var acctID any
		if rnd.Intn(5) > 0 {
			a := accts[rnd.Intn(len(accts))]
			acctID = a.id
			s.HasAccount, s.Plan, s.AccountDom, s.Revenue, s.Renewal = true, a.plan, a.d, a.revenue, a.renewal
		}
		var email any
		if s.Email != "" {
			email = s.Email
		}
		var id uuid.UUID
		must(db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, email, account_id, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`, w.ws, s.Name, email, acctID, added).Scan(&id))
		var src, chunk uuid.UUID
		must(db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, w.ws, text, uuid.NewString(), w.user).Scan(&src))
		must(db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, w.ws, src, len(text), text).Scan(&chunk))
		for _, r := range w.requests {
			if rnd.Intn(4) == 0 {
				s.AskedRequest[r] = true
				exec(`INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,'single sign-on',15,29,$6)`, w.ws, r, src, chunk, id, w.user)
			}
		}
		w.subjects[id] = s
	}
	return w
}

// randomRule builds a random tree of rules as JSON, using values near the data so both outcomes are common.
func randomRule(rnd *rand.Rand, w *world, depth int) any {
	if depth < 3 && rnd.Intn(10) < 5 {
		switch rnd.Intn(3) {
		case 0, 1:
			key := []string{"all", "any"}[rnd.Intn(2)]
			n := rnd.Intn(4)
			if key == "any" && n == 0 {
				n = 1
			}
			kids := make([]any, n)
			for i := range kids {
				kids[i] = randomRule(rnd, w, depth+1)
			}
			return map[string]any{key: kids}
		default:
			return map[string]any{"not": randomRule(rnd, w, depth+1)}
		}
	}
	leaf := func(f, op string, v any) any { return map[string]any{"field": f, "op": op, "value": v} }
	dateNear := func() string { return today.AddDate(0, 0, rnd.Intn(80)-30).Format("2006-01-02") }
	switch rnd.Intn(14) {
	case 0:
		return leaf("name_contains", "contains", []string{"dana", "LEE", "o'neil", "50%", "_", "z", "á", "1"}[rnd.Intn(8)])
	case 1:
		return leaf("email_domain", "eq", []string{"acme.com", "BETA.io", "gamma.co", "sub.acme.com", "x"}[rnd.Intn(5)])
	case 2:
		return leaf("email_domain", "in", []string{"acme.com", "beta.io", "gamma.co"}[:1+rnd.Intn(3)])
	case 3:
		return leaf("person_added", []string{"before", "after"}[rnd.Intn(2)], dateNear())
	case 4:
		return leaf("has_account", "is", rnd.Intn(2) == 0)
	case 5:
		return leaf("account_plan", "eq", []string{"free", "PRO", "Enterprise", "none"}[rnd.Intn(4)])
	case 6:
		return leaf("account_plan", "in", []string{"free", "pro", "enterprise"}[:1+rnd.Intn(3)])
	case 7:
		return leaf("account_domain", "eq", []string{"acme.com", "beta.io", "gamma.co"}[rnd.Intn(3)])
	case 8:
		return leaf("account_revenue", "gte", json.Number([]string{"0", "99.5", "100", "100.01", "99999.99", "1000000"}[rnd.Intn(6)]))
	case 9:
		return leaf("account_revenue", "lte", json.Number([]string{"0", "99.49", "100", "1000", "99999.99"}[rnd.Intn(5)]))
	case 10:
		return leaf("account_renewal", []string{"before", "after"}[rnd.Intn(2)], dateNear())
	case 11:
		return leaf("account_renewal", "within_days", rnd.Intn(60))
	default:
		return leaf("asked_for", "is", w.requests[rnd.Intn(len(w.requests))].String())
	}
}

// The real condition (SQL) must pick exactly the people the plain-Go reference picks, for many random
// rules over data full of awkward cases.
func TestTheDatabaseMatchesABruteForceReference(t *testing.T) {
	db := testdb.New(t)
	rnd := rand.New(rand.NewSource(7))
	w := seed(t, db, rnd, 90)
	tn := store.Tenant{WorkspaceID: w.ws, UserID: w.user, Role: store.RoleAdmin}
	var matchedSome, matchedNone int
	for i := 0; i < 600; i++ {
		raw, err := json.Marshal(randomRule(rnd, w, 0))
		if err != nil {
			t.Fatal(err)
		}
		rule, err := audience.Parse(raw)
		if err != nil {
			t.Fatalf("rule %s refused: %v", raw, err)
		}
		var got []uuid.UUID
		if err := store.WithTenantTx(ctx, db.Backend, tn, func(tx pgx.Tx, _ *dbgen.Queries) (e error) {
			got, e = audience.IDs(ctx, tx, w.ws, rule, today, 10000)
			return e
		}); err != nil {
			t.Fatalf("rule %s: %v", raw, err)
		}
		var want []uuid.UUID
		for id, s := range w.subjects {
			if audience.Eval(rule, s, today) {
				want = append(want, id)
			}
		}
		sort.Slice(want, func(a, b int) bool { return want[a].String() < want[b].String() })
		sort.Slice(got, func(a, b int) bool { return got[a].String() < got[b].String() })
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("rule %s\n got %d people, reference %d\n got %v\nwant %v", raw, len(got), len(want), got, want)
		}
		if len(want) == 0 {
			matchedNone++
		} else if len(want) < len(w.subjects) {
			matchedSome++
		}
	}
	// the test is only worth something if the rules actually split the people
	if matchedSome < 150 {
		t.Errorf("only %d of 600 rules selected some-but-not-all people; the generator is too weak", matchedSome)
	}
	t.Logf("600 rules: %d selected a proper subset, %d nobody", matchedSome, matchedNone)
}

func TestCountsAndSamplesOnlyListPeopleWhoCanBeEmailed(t *testing.T) {
	db := testdb.New(t)
	rnd := rand.New(rand.NewSource(3))
	w := seed(t, db, rnd, 40)
	tn := store.Tenant{WorkspaceID: w.ws, UserID: w.user, Role: store.RoleAdmin}
	var total, withEmail int
	var sample []audience.Match
	if err := store.WithTenantTx(ctx, db.Backend, tn, func(tx pgx.Tx, _ *dbgen.Queries) (e error) {
		total, withEmail, sample, e = audience.Select(ctx, tx, w.ws, audience.Everyone(), today, 5)
		return e
	}); err != nil {
		t.Fatal(err)
	}
	wantEmail := 0
	for _, s := range w.subjects {
		if s.Email != "" {
			wantEmail++
		}
	}
	if total != 40 || withEmail != wantEmail || len(sample) != 5 {
		t.Errorf("total %d (40), with email %d (%d), sample %d (5)", total, withEmail, wantEmail, len(sample))
	}
	for _, m := range sample {
		if m.Email == "" {
			t.Error("a person without an address was offered")
		}
	}
}

func TestAnAudienceNeverReachesAnotherWorkspace(t *testing.T) {
	db := testdb.New(t)
	rnd := rand.New(rand.NewSource(5))
	a := seed(t, db, rnd, 20)
	b := seed(t, db, rnd, 20)
	tn := store.Tenant{WorkspaceID: a.ws, UserID: a.user, Role: store.RoleAdmin}
	// even if asked about the other workspace's id, the answer is empty: row-level security applies
	if err := store.WithTenantTx(ctx, db.Backend, tn, func(tx pgx.Tx, _ *dbgen.Queries) error {
		ids, err := audience.IDs(ctx, tx, b.ws, audience.Everyone(), today, 1000)
		if err != nil || len(ids) != 0 {
			t.Errorf("another workspace's people: %d, %v", len(ids), err)
		}
		// a request id from the other workspace selects nobody here
		raw := fmt.Sprintf(`{"field":"asked_for","op":"is","value":%q}`, b.requests[0])
		r, perr := audience.Parse([]byte(raw))
		if perr != nil {
			return perr
		}
		ids, err = audience.IDs(ctx, tx, a.ws, r, today, 1000)
		if err != nil || len(ids) != 0 {
			t.Errorf("a request of another workspace matched %d people here (%v)", len(ids), err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestBadAudiencesAreRefused(t *testing.T) {
	deep := `{"field":"has_account","op":"is","value":true}`
	for i := 0; i < 5; i++ {
		deep = `{"not":` + deep + `}`
	}
	many := `{"all":[` + strings.TrimSuffix(strings.Repeat(`{"field":"has_account","op":"is","value":true},`, 31), ",") + `]}`
	for name, raw := range map[string]string{
		"nothing":           ``,
		"empty object":      `{}`,
		"null":              `null`,
		"not json":          `all of them`,
		"two kinds at once": `{"all":[],"any":[]}`,
		"an extra key":      `{"all":[],"sql":"1=1"}`,
		"any of nothing":    `{"any":[]}`,
		"unknown field":     `{"field":"password","op":"eq","value":"x"}`,
		"wrong comparison":  `{"field":"has_account","op":"gte","value":1}`,
		"text for a flag":   `{"field":"has_account","op":"is","value":"yes"}`,
		"empty text":        `{"field":"name_contains","op":"contains","value":"  "}`,
		"long text":         `{"field":"name_contains","op":"contains","value":"` + strings.Repeat("a", 201) + `"}`,
		"bad number":        `{"field":"account_revenue","op":"gte","value":"1e9"}`,
		"negative number":   `{"field":"account_revenue","op":"gte","value":-5}`,
		"three decimals":    `{"field":"account_revenue","op":"gte","value":1.234}`,
		"bad date":          `{"field":"person_added","op":"before","value":"2026-13-45"}`,
		"date with time":    `{"field":"person_added","op":"before","value":"2026-01-01T00:00:00Z"}`,
		"huge days":         `{"field":"account_renewal","op":"within_days","value":99999}`,
		"negative days":     `{"field":"account_renewal","op":"within_days","value":-1}`,
		"not a request id":  `{"field":"asked_for","op":"is","value":"nope"}`,
		"too many values":   `{"field":"account_plan","op":"in","value":[` + strings.TrimSuffix(strings.Repeat(`"a",`, 51), ",") + `]}`,
		"no values":         `{"field":"account_plan","op":"in","value":[]}`,
		"nested too deeply": deep,
		"too many rules":    many,
		"sql in a value":    `{"field":"email_domain","op":"eq","value":"x' OR '1'='1"}`, // valid text, handled below
	} {
		_, err := audience.Parse([]byte(raw))
		if name == "sql in a value" {
			if err != nil {
				t.Errorf("%s: an apostrophe is just text: %v", name, err)
			}
			continue
		}
		if err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}

func TestEveryoneMustBeChosenOnPurpose(t *testing.T) {
	if _, err := audience.Parse([]byte(`{"all":[]}`)); err != nil {
		t.Errorf("everyone, written down, was refused: %v", err)
	}
	b, _ := json.Marshal(audience.Everyone())
	if string(b) != `{"all":[]}` {
		t.Errorf("everyone serialises as %s", b)
	}
	// the stored form round-trips
	r, err := audience.Parse([]byte(`{"any":[{"field":"account_plan","op":"in","value":["Pro","free"]},{"not":{"field":"has_account","op":"is","value":false}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(r)
	if _, err := audience.Parse(out); err != nil {
		t.Errorf("the saved form does not parse back: %v (%s)", err, out)
	}
}
