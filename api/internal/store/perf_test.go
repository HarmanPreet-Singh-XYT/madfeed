package store_test

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

// Heavy: run with PERF=1 go test -run TestListsStayFast ./internal/store
func TestListsStayFastWithTenThousandRequestsAndAHundredThousandQuotes(t *testing.T) {
	if os.Getenv("PERF") == "" {
		t.Skip("set PERF=1 to run the 10k-request / 100k-evidence check")
	}
	db := testdb.New(t)
	ten := workspace(t, db, "perf")
	ws := ten.WorkspaceID
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Super.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q[:40], err)
		}
	}

	// 100 sources of 1,000 words each; word k of source s is its own quote.
	exec(`INSERT INTO source_item (id, workspace_id, kind, raw_text, content_hash, created_by)
	      SELECT gen_random_uuid(), $1, 'paste', (SELECT string_agg('w'||lpad(k::text,4,'0')||' ', '' ORDER BY k) FROM generate_series(0,999) k), 'h'||s, $2
	      FROM generate_series(1,100) s`, ws, ten.UserID)
	exec(`INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text)
	      SELECT workspace_id, id, 0, 0, octet_length(raw_text), raw_text FROM source_item WHERE workspace_id=$1`, ws)
	exec(`INSERT INTO account (workspace_id, name, revenue) SELECT $1, 'Acct '||g, (g*137)%90000 FROM generate_series(1,2000) g`, ws)
	exec(`INSERT INTO person (workspace_id, name, email, account_id)
	      SELECT $1, 'Person '||g, 'p'||g||'@x.io', (SELECT id FROM account WHERE workspace_id=$1 AND name='Acct '||((g%2000)+1)) FROM generate_series(1,6000) g`, ws)
	exec(`INSERT INTO request (workspace_id, title, created_at) SELECT $1, 'Request '||g, now() - (g || ' minutes')::interval FROM generate_series(1,10000) g`, ws)

	start := time.Now()
	exec(`WITH srcs AS (SELECT id, workspace_id, row_number() OVER (ORDER BY id) AS sn FROM source_item WHERE workspace_id=$1),
	           reqs AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM request WHERE workspace_id=$1),
	           ppl  AS (SELECT id, row_number() OVER (ORDER BY id) AS pn FROM person WHERE workspace_id=$1),
	           chunks AS (SELECT source_item_id, id FROM chunk WHERE workspace_id=$1)
	      INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, created_by)
	      SELECT $1, r.id, s.id, c.id, p.id, 'w'||lpad(x.k::text,4,'0'), x.k*6, x.k*6+5, $2
	      FROM generate_series(0,99999) g
	      JOIN LATERAL (SELECT (g % 100) + 1 AS sn, (g / 100) AS k, (g % 10000) + 1 AS rn, (g % 6000) + 1 AS pn) x ON true
	      JOIN srcs s ON s.sn = x.sn JOIN chunks c ON c.source_item_id = s.id
	      JOIN reqs r ON r.rn = x.rn JOIN ppl p ON p.pn = x.pn`, ws, ten.UserID)
	t.Logf("100k evidence rows inserted (quote trigger + impact trigger on every row batch) in %s", time.Since(start))

	var requests, evidence, impact int
	_ = db.Super.QueryRow(ctx, `SELECT (SELECT count(*) FROM request WHERE workspace_id=$1), (SELECT count(*) FROM evidence WHERE workspace_id=$1), (SELECT count(*) FROM request_impact WHERE workspace_id=$1)`, ws).Scan(&requests, &evidence, &impact)
	if requests != 10000 || evidence != 100000 || impact != 10000 {
		t.Fatalf("data: %d requests %d evidence %d impact rows", requests, evidence, impact)
	}
	exec(`ANALYZE`)

	// Timings through the same code path the API uses.
	timed := func(name string, budget time.Duration, fn func(q *dbgen.Queries) error) {
		t.Helper()
		var best time.Duration
		for i := 0; i < 5; i++ {
			s := time.Now()
			if err := store.WithTenant(ctx, db.Backend, ten, fn); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			if d := time.Since(s); best == 0 || d < best {
				best = d
			}
		}
		t.Logf("%-34s best of 5: %s", name, best)
		if best > budget {
			t.Errorf("%s took %s, budget %s", name, best, budget)
		}
	}
	far := time.Now().Add(24 * time.Hour)
	timed("requests, newest first (page 1)", 300*time.Millisecond, func(q *dbgen.Queries) error {
		rows, err := q.ListRequestSummaries(ctx, dbgen.ListRequestSummariesParams{WorkspaceID: ws, BeforeCreatedAt: far, BeforeID: uuid.Max, PageSize: 51})
		if err == nil && len(rows) != 51 {
			err = fmt.Errorf("got %d rows", len(rows))
		}
		return err
	})
	timed("requests, by value (page 1)", 300*time.Millisecond, func(q *dbgen.Queries) error {
		var big pgtype.Numeric
		_ = big.Scan("9999999999999999")
		rows, err := q.ListRequestSummariesByValue(ctx, dbgen.ListRequestSummariesByValueParams{WorkspaceID: ws, BeforeValue: big, BeforeID: uuid.Max, PageSize: 51})
		if err == nil && len(rows) != 51 {
			err = fmt.Errorf("got %d rows", len(rows))
		}
		return err
	})
	var someReq uuid.UUID
	_ = db.Super.QueryRow(ctx, `SELECT id FROM request WHERE workspace_id=$1 LIMIT 1`, ws).Scan(&someReq)
	timed("one request with its evidence", 200*time.Millisecond, func(q *dbgen.Queries) error {
		if _, err := q.GetRequestImpact(ctx, dbgen.GetRequestImpactParams{WorkspaceID: ws, RequestID: someReq}); err != nil {
			return err
		}
		_, err := q.ListEvidenceForRequest(ctx, dbgen.ListEvidenceForRequestParams{WorkspaceID: ws, RequestID: someReq})
		return err
	})
	timed("people list (page 1)", 200*time.Millisecond, func(q *dbgen.Queries) error {
		_, err := q.ListPeople(ctx, dbgen.ListPeopleParams{WorkspaceID: ws, AfterName: "", AfterID: uuid.Nil, PageSize: 51})
		return err
	})

	// Changing one account's value must update only the requests behind it, quickly.
	s := time.Now()
	exec(`UPDATE account SET revenue = revenue + 1 WHERE workspace_id=$1 AND name='Acct 7'`, ws)
	t.Logf("changing one account's revenue (trigger recompute): %s", time.Since(s))
	if time.Since(s) > 2*time.Second {
		t.Errorf("account update too slow: %s", time.Since(s))
	}

	// Query plans: no sequential scan over the big tables for the list queries.
	plan := func(sql string, args ...any) string {
		t.Helper()
		var out []byte
		if err := store.WithTenantTx(ctx, db.Backend, ten, func(tx pgx.Tx, _ *dbgen.Queries) error {
			return tx.QueryRow(ctx, "EXPLAIN (FORMAT JSON) "+sql, args...).Scan(&out)
		}); err != nil {
			t.Fatal(err)
		}
		var parsed []map[string]any
		_ = json.Unmarshal(out, &parsed)
		return string(out)
	}
	for name, p := range map[string]string{
		"newest": plan(`SELECT r.id FROM request r JOIN request_impact i ON i.workspace_id=r.workspace_id AND i.request_id=r.id
			WHERE r.workspace_id=$1 AND (r.created_at, r.id) < ($2::timestamptz, $3::uuid) ORDER BY r.created_at DESC, r.id DESC LIMIT 51`, ws, far, uuid.Max),
		"by value": plan(`SELECT r.id FROM request r JOIN request_impact i ON i.workspace_id=r.workspace_id AND i.request_id=r.id
			WHERE r.workspace_id=$1 AND (i.total_value, r.id) < (9999999999999999::numeric, $2::uuid) ORDER BY i.total_value DESC, r.id DESC LIMIT 51`, ws, uuid.Max),
		"evidence for a request": plan(`SELECT * FROM evidence WHERE workspace_id=$1 AND request_id=$2 ORDER BY created_at DESC`, ws, someReq),
	} {
		if strings.Contains(p, `"Node Type": "Seq Scan"`) || strings.Contains(p, `"Node Type":"Seq Scan"`) {
			t.Errorf("%s uses a sequential scan:\n%s", name, p)
		}
	}
}
