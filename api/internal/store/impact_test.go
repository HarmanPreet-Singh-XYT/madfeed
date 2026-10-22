package store_test

import (
	"fmt"
	"math/rand"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

// impactRow is request_impact as stored (value in cents to compare exactly).
type impactRow struct {
	Evidence, People, Accounts, WithValue int
	Cents                                 int64
	Newest                                *time.Time
}

// bruteForce recomputes every request's impact from the raw tables with plain
// loops, independently of the SQL the triggers use.
func bruteForce(t *testing.T, db *testdb.DB, ws uuid.UUID) map[uuid.UUID]impactRow {
	t.Helper()
	type ev struct {
		req    uuid.UUID
		person *uuid.UUID
		at     time.Time
	}
	var evs []ev
	rows, err := db.Super.Query(ctx, `SELECT request_id, person_id, created_at FROM evidence WHERE workspace_id=$1`, ws)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var e ev
		if err := rows.Scan(&e.req, &e.person, &e.at); err != nil {
			t.Fatal(err)
		}
		evs = append(evs, e)
	}
	rows.Close()

	acctOf := map[uuid.UUID]*uuid.UUID{}
	prow, _ := db.Super.Query(ctx, `SELECT id, account_id FROM person WHERE workspace_id=$1`, ws)
	for prow.Next() {
		var id uuid.UUID
		var a *uuid.UUID
		_ = prow.Scan(&id, &a)
		acctOf[id] = a
	}
	prow.Close()
	cents := map[uuid.UUID]*int64{}
	arow, _ := db.Super.Query(ctx, `SELECT id, (revenue*100)::bigint FROM account WHERE workspace_id=$1`, ws)
	for arow.Next() {
		var id uuid.UUID
		var c *int64
		_ = arow.Scan(&id, &c)
		cents[id] = c
	}
	arow.Close()

	reqs := map[uuid.UUID]bool{}
	rrow, _ := db.Super.Query(ctx, `SELECT id FROM request WHERE workspace_id=$1`, ws)
	for rrow.Next() {
		var id uuid.UUID
		_ = rrow.Scan(&id)
		reqs[id] = true
	}
	rrow.Close()

	out := map[uuid.UUID]impactRow{}
	for r := range reqs {
		people := map[uuid.UUID]bool{}
		accounts := map[uuid.UUID]bool{}
		var row impactRow
		for _, e := range evs {
			if e.req != r {
				continue
			}
			row.Evidence++
			if row.Newest == nil || e.at.After(*row.Newest) {
				at := e.at
				row.Newest = &at
			}
			if e.person != nil {
				people[*e.person] = true
				if a := acctOf[*e.person]; a != nil {
					accounts[*a] = true
				}
			}
		}
		row.People, row.Accounts = len(people), len(accounts)
		for a := range accounts {
			if c := cents[a]; c != nil {
				row.Cents += *c
				row.WithValue++
			}
		}
		out[r] = row
	}
	return out
}

func stored(t *testing.T, db *testdb.DB, ws uuid.UUID) map[uuid.UUID]impactRow {
	t.Helper()
	rows, err := db.Super.Query(ctx, `SELECT request_id, evidence_count, people_count, account_count, accounts_with_value, (total_value*100)::bigint, newest_evidence_at FROM request_impact WHERE workspace_id=$1`, ws)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[uuid.UUID]impactRow{}
	for rows.Next() {
		var id uuid.UUID
		var r impactRow
		if err := rows.Scan(&id, &r.Evidence, &r.People, &r.Accounts, &r.WithValue, &r.Cents, &r.Newest); err != nil {
			t.Fatal(err)
		}
		out[id] = r
	}
	return out
}

func assertImpact(t *testing.T, db *testdb.DB, ws uuid.UUID, step string) {
	t.Helper()
	want, got := bruteForce(t, db, ws), stored(t, db, ws)
	if len(want) != len(got) {
		t.Fatalf("%s: %d requests but %d impact rows", step, len(want), len(got))
	}
	for id, w := range want {
		g, ok := got[id]
		if !ok {
			t.Fatalf("%s: request %s has no impact row", step, id)
		}
		sameTime := (w.Newest == nil && g.Newest == nil) || (w.Newest != nil && g.Newest != nil && w.Newest.Equal(*g.Newest))
		if w.Evidence != g.Evidence || w.People != g.People || w.Accounts != g.Accounts || w.WithValue != g.WithValue || w.Cents != g.Cents || !sameTime {
			t.Fatalf("%s: request %s\n stored: %+v\n expect: %+v", step, id, g, w)
		}
	}
}

func TestImpactTotalsMatchABruteForceCalculationThroughRandomChanges(t *testing.T) {
	db := testdb.New(t)
	for seed := int64(1); seed <= 6; seed++ {
		seed := seed
		t.Run(fmt.Sprintf("seed %d", seed), func(t *testing.T) {
			rng := rand.New(rand.NewSource(seed))
			ten := workspace(t, db, "impact")
			ws := ten.WorkspaceID

			// One long source: word k lives at bytes [k*6, k*6+5).
			text := ""
			for k := 0; k < 300; k++ {
				text += fmt.Sprintf("w%04d ", k)
			}
			si := newSource(t, db, ten, text)
			var chunkID uuid.UUID
			run := func(sql string, args ...any) {
				t.Helper()
				if err := store.WithTenantTx(ctx, db.Backend, ten, func(tx pgx.Tx, _ *dbgen.Queries) error {
					_, err := tx.Exec(ctx, sql, args...)
					return err
				}); err != nil {
					t.Fatalf("%s: %v", sql, err)
				}
			}
			if err := db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, si.ID, len(text), text).Scan(&chunkID); err != nil {
				t.Fatal(err)
			}

			var accounts, people, requests []uuid.UUID
			for i := 0; i < 5; i++ {
				id := uuid.New()
				var rev any
				if i%3 != 2 {
					rev = fmt.Sprintf("%d.%02d", 1000+rng.Intn(9000), rng.Intn(100))
				}
				run(`INSERT INTO account (id, workspace_id, name, revenue) VALUES ($1,$2,$3,$4)`, id, ws, fmt.Sprintf("acct-%d-%d", seed, i), rev)
				accounts = append(accounts, id)
			}
			for i := 0; i < 12; i++ {
				id := uuid.New()
				var acc any
				if rng.Intn(4) != 0 {
					acc = accounts[rng.Intn(len(accounts))]
				}
				run(`INSERT INTO person (id, workspace_id, name, account_id) VALUES ($1,$2,$3,$4)`, id, ws, fmt.Sprintf("p%d", i), acc)
				people = append(people, id)
			}
			newRequest := func() {
				id := uuid.New()
				run(`INSERT INTO request (id, workspace_id, title) VALUES ($1,$2,'r')`, id, ws)
				requests = append(requests, id)
			}
			for i := 0; i < 6; i++ {
				newRequest()
			}
			assertImpact(t, db, ws, "setup")

			var evidence []uuid.UUID
			usedWord := 0
			for step := 0; step < 120; step++ {
				op := rng.Intn(9)
				label := fmt.Sprintf("seed %d step %d op %d", seed, step, op)
				switch {
				case op <= 2 && len(requests) > 0 && usedWord < 290: // add evidence (anonymous sometimes)
					id := uuid.New()
					var person any
					if rng.Intn(5) != 0 {
						person = people[rng.Intn(len(people))]
					}
					k := usedWord
					usedWord++
					run(`INSERT INTO evidence (id, workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by)
					     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, ws, requests[rng.Intn(len(requests))], si.ID, chunkID, person,
						fmt.Sprintf("w%04d", k), k*6, k*6+5, ten.UserID)
					evidence = append(evidence, id)
				case op == 3 && len(evidence) > 0: // remove evidence
					i := rng.Intn(len(evidence))
					run(`DELETE FROM evidence WHERE id=$1`, evidence[i])
					evidence = append(evidence[:i], evidence[i+1:]...)
				case op == 4 && len(evidence) > 0 && len(requests) > 1: // move evidence to another request
					run(`UPDATE evidence SET request_id=$2 WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM evidence e2 WHERE e2.request_id=$2 AND e2.span_start=evidence.span_start)`, evidence[rng.Intn(len(evidence))], requests[rng.Intn(len(requests))])
				case op == 5: // a person changes account (or leaves it)
					var acc any
					if rng.Intn(3) != 0 {
						acc = accounts[rng.Intn(len(accounts))]
					}
					run(`UPDATE person SET account_id=$2 WHERE id=$1`, people[rng.Intn(len(people))], acc)
				case op == 6: // account value changes, appears or disappears
					var rev any
					if rng.Intn(3) != 0 {
						rev = fmt.Sprintf("%d.%02d", rng.Intn(20000), rng.Intn(100))
					}
					run(`UPDATE account SET revenue=$2 WHERE id=$1`, accounts[rng.Intn(len(accounts))], rev)
				case op == 7 && len(requests) > 2: // a request is deleted with its evidence
					i := rng.Intn(len(requests))
					run(`DELETE FROM request WHERE id=$1`, requests[i])
					requests = append(requests[:i], requests[i+1:]...)
					rows, _ := db.Super.Query(ctx, `SELECT id FROM evidence WHERE workspace_id=$1`, ws)
					evidence = evidence[:0]
					for rows.Next() {
						var id uuid.UUID
						_ = rows.Scan(&id)
						evidence = append(evidence, id)
					}
					rows.Close()
				case op == 8 && rng.Intn(3) == 0 && len(accounts) > 2: // an account is deleted: its people keep existing without one
					i := rng.Intn(len(accounts))
					run(`DELETE FROM account WHERE id=$1`, accounts[i])
					accounts = append(accounts[:i], accounts[i+1:]...)
				default:
					newRequest()
				}
				assertImpact(t, db, ws, label)
			}
		})
	}
}

func TestOneAccountIsCountedOnceNoMatterHowManyQuotesOrPeople(t *testing.T) {
	db := testdb.New(t)
	ten := workspace(t, db, "once")
	ws := ten.WorkspaceID
	text := "w0000 w0001 w0002 w0003 "
	si := newSource(t, db, ten, text)
	var chunk, acct, p1, p2, p3, req uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, si.ID, len(text), text).Scan(&chunk))
	must(db.Super.QueryRow(ctx, `INSERT INTO account (workspace_id, name, revenue) VALUES ($1,'Acme',100000) RETURNING id`, ws).Scan(&acct))
	must(db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, account_id) VALUES ($1,'a',$2) RETURNING id`, ws, acct).Scan(&p1))
	must(db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name, account_id) VALUES ($1,'b',$2) RETURNING id`, ws, acct).Scan(&p2))
	must(db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name) VALUES ($1,'loner') RETURNING id`, ws).Scan(&p3))
	must(db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'r') RETURNING id`, ws).Scan(&req))
	// Three quotes from two people at one account, plus one from a person with no account.
	for k, p := range []uuid.UUID{p1, p1, p2, p3} {
		_, err := db.Super.Exec(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, ws, req, si.ID, chunk, p, fmt.Sprintf("w%04d", k), k*6, k*6+5, ten.UserID)
		must(err)
	}
	got := stored(t, db, ws)[req]
	if got.Evidence != 4 || got.People != 3 || got.Accounts != 1 || got.Cents != 10000000 || got.WithValue != 1 {
		t.Fatalf("%+v: the account's 100,000 must be counted once", got)
	}
}
