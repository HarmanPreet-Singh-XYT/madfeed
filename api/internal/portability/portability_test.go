package portability_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/directory"
	"product/api/internal/portability"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

func tenant(t *testing.T, db *testdb.DB, role store.Role) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ten.WorkspaceID, Name: "Original ☕ workspace"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ten.WorkspaceID, UserID: ten.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	ten.Role = role
	return ten
}

// populate builds a workspace with accounts, people, sources (with unicode and
// several chunks), requests and evidence, directly in SQL.
func populate(t *testing.T, db *testdb.DB, ten store.Tenant) {
	t.Helper()
	ws := ten.WorkspaceID
	if _, err := (&directory.Service{Pool: db.Backend}).Import(ctx, ten, []byte("Name,Email,Company,ARR,Plan,Renewal\nDana,dana@acme.com,Acme,\"$120,000\",Enterprise,2026-12-31\nRaj,raj@acme.com,Acme,,,\nSam,sam@globex.io,Globex,5000.50,Team,\nNobody,,,,,\n"), nil, false); err != nil {
		t.Fatal(err)
	}
	var dana, sam uuid.UUID
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.Super.QueryRow(ctx, `SELECT id FROM person WHERE workspace_id=$1 AND email='dana@acme.com'`, ws).Scan(&dana))
	must(db.Super.QueryRow(ctx, `SELECT id FROM person WHERE workspace_id=$1 AND email='sam@globex.io'`, ws).Scan(&sam))

	var reqs []uuid.UUID
	for i := 0; i < 3; i++ {
		var id uuid.UUID
		must(db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title, created_via) VALUES ($1,$2,'machine') RETURNING id`, ws, fmt.Sprintf("Request %d ☕", i)).Scan(&id))
		reqs = append(reqs, id)
	}
	var firstSrc, firstChunk uuid.UUID
	var firstText string
	for s := 0; s < 4; s++ {
		// Long enough for several chunks, with accents and emoji so byte offsets matter.
		text := strings.Repeat(fmt.Sprintf("Intro %d. Café ☕ chatter goes here and there. ", s), 400) + fmt.Sprintf("We really need feature number %d, café ☕ style. ", s) + strings.Repeat("More filler follows. ", 300)
		person := []uuid.UUID{dana, sam, dana, sam}[s]
		var src uuid.UUID
		must(db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, person_id, created_by, processing_state)
			VALUES ($1,'paste',$2,$3,$4,$5,$6,'done') RETURNING id`, ws, fmt.Sprintf("Call %d", s), text, uuid.NewString(), person, ten.UserID).Scan(&src))
		var chunk uuid.UUID
		must(db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, ws, src, len(text), text).Scan(&chunk))
		if s == 0 {
			firstSrc, firstChunk, firstText = src, chunk, text
		}
		quote := fmt.Sprintf("We really need feature number %d, café ☕ style.", s)
		start := strings.Index(text, quote)
		var anon any
		if s == 3 {
			anon = nil // one quote with no recorded speaker
		} else {
			anon = person
		}
		_, err := db.Super.Exec(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, person_id, quote_text, span_start, span_end, confidence, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0.8,$9)`, ws, reqs[s%3], src, chunk, anon, quote, start, start+len(quote), ten.UserID)
		must(err)
	}
	// The codebook, highlights (with multi-byte text) and tags on requests.
	var tagA, tagB uuid.UUID
	must(db.Super.QueryRow(ctx, `INSERT INTO tag (workspace_id, name, definition, color, created_by) VALUES ($1,'Café ☕','Mentions coffee','red',$2) RETURNING id`, ws, ten.UserID).Scan(&tagA))
	must(db.Super.QueryRow(ctx, `INSERT INTO tag (workspace_id, name, color, created_by, archived_at) VALUES ($1,'Old tag','gray',$2, now()) RETURNING id`, ws, ten.UserID).Scan(&tagB))
	hq := "Café ☕ chatter goes here"
	hs := strings.Index(firstText, hq)
	var hid uuid.UUID
	must(db.Super.QueryRow(ctx, `INSERT INTO highlight (workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, note, author_id) VALUES ($1,$2,$3,$4,$5,$6,'a note',$7) RETURNING id`,
		ws, firstSrc, firstChunk, hs, hs+len(hq), hq, ten.UserID).Scan(&hid))
	_, err := db.Super.Exec(ctx, `INSERT INTO highlight_tag (workspace_id, highlight_id, tag_id) VALUES ($1,$2,$3),($1,$2,$4)`, ws, hid, tagA, tagB)
	must(err)
	_, err = db.Super.Exec(ctx, `INSERT INTO request_tag (workspace_id, request_id, tag_id) VALUES ($1,$2,$3)`, ws, reqs[0], tagA)
	must(err)
	var custom uuid.UUID
	must(db.Super.QueryRow(ctx, `INSERT INTO status (workspace_id, name, bucket, position) VALUES ($1,'Waiting on legal','active',50) RETURNING id`, ws).Scan(&custom))
	_, err = db.Super.Exec(ctx, `UPDATE request SET status_id=$2 WHERE id=$1`, reqs[1], custom)
	must(err)
	_, err = db.Super.Exec(ctx, `UPDATE request SET status_id=(SELECT id FROM status WHERE workspace_id=$2 AND bucket='done' LIMIT 1) WHERE id=$1`, reqs[2], ws)
	must(err)
	var note uuid.UUID
	must(db.Super.QueryRow(ctx, `INSERT INTO release_note (workspace_id, title, body, state, published_at, created_by) VALUES ($1,'Shipped ☕','Body text','published', now(), $2) RETURNING id`, ws, ten.UserID).Scan(&note))
	_, err = db.Super.Exec(ctx, `INSERT INTO release_note_request (workspace_id, release_note_id, request_id) VALUES ($1,$2,$3)`, ws, note, reqs[2])
	must(err)
	_, err = db.Super.Exec(ctx, `INSERT INTO release_note (workspace_id, title, state, scheduled_for, created_by) VALUES ($1,'Later','scheduled', now() + interval '3 days', $2)`, ws, ten.UserID)
	must(err)
	_, err = db.Super.Exec(ctx, `INSERT INTO suppression (workspace_id, email, reason) VALUES ($1,'gone@example.com','unsubscribed'),($1,'bounce@example.com','bounced')`, ws)
	must(err)
}

type snapshot struct {
	Accounts []string
	People   []string
	Requests []string // title | evidence quotes with speaker | impact
	Sources  []string
	Tags     []string // name | definition | colour | archived
	OptOuts  []string
	Statuses []string // name | type | position
	Notes    []string
	Research []string // highlights with their tags, and tags on requests
}

// summarise describes a workspace without using any ids, so two workspaces can be compared.
func summarise(t *testing.T, db *testdb.DB, ws uuid.UUID) snapshot {
	t.Helper()
	var s snapshot
	collect := func(sql string) []string {
		rows, err := db.Super.Query(ctx, sql, ws)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				t.Fatal(err)
			}
			out = append(out, v)
		}
		sort.Strings(out)
		return out
	}
	s.Accounts = collect(`SELECT name||'|'||coalesce(domain,'')||'|'||coalesce(revenue::text,'')||'|'||coalesce(plan,'')||'|'||coalesce(renewal_date::text,'') FROM account WHERE workspace_id=$1`)
	s.People = collect(`SELECT p.name||'|'||coalesce(p.email,'')||'|'||coalesce(a.name,'') FROM person p LEFT JOIN account a ON a.id=p.account_id WHERE p.workspace_id=$1`)
	s.Sources = collect(`SELECT s.title||'|'||md5(s.raw_text)||'|'||coalesce(p.name,'') FROM source_item s LEFT JOIN person p ON p.id=s.person_id WHERE s.workspace_id=$1`)
	s.Requests = collect(`SELECT r.title||'|'||r.created_via||'|'||(SELECT name FROM status WHERE id=r.status_id)||'|'||i.evidence_count||'|'||i.people_count||'|'||i.account_count||'|'||i.total_value||'|'||
		coalesce((SELECT string_agg(e.quote_text||'@'||e.span_start||'-'||e.span_end||'/'||s.title||'/'||coalesce(p.name,'?'), ';' ORDER BY e.quote_text)
		          FROM evidence e JOIN source_item s ON s.id=e.source_item_id LEFT JOIN person p ON p.id=e.person_id WHERE e.request_id=r.id),'')
		FROM request r JOIN request_impact i ON i.request_id=r.id WHERE r.workspace_id=$1`)
	s.Statuses = collect(`SELECT name||'|'||bucket||'|'||position FROM status WHERE workspace_id=$1`)
	s.Notes = collect(`SELECT n.title||'|'||n.state||'|'||n.body||'|'||(n.published_at IS NOT NULL)||'|'||(n.scheduled_for IS NOT NULL)||'|'||coalesce((SELECT string_agg(r.title, ',' ORDER BY r.title) FROM release_note_request l JOIN request r ON r.id=l.request_id WHERE l.release_note_id=n.id),'') FROM release_note n WHERE n.workspace_id=$1`)
	s.OptOuts = collect(`SELECT email||'|'||reason FROM suppression WHERE workspace_id=$1`)
	s.Tags = collect(`SELECT name||'|'||definition||'|'||color||'|'||(archived_at IS NOT NULL) FROM tag WHERE workspace_id=$1`)
	s.Research = collect(`SELECT 'h:'||h.quote_text||'@'||h.span_start||'-'||h.span_end||'/'||h.note||'/'||coalesce((SELECT string_agg(t.name, ',' ORDER BY t.name) FROM highlight_tag ht JOIN tag t ON t.id=ht.tag_id WHERE ht.highlight_id=h.id),'')
		FROM highlight h WHERE h.workspace_id=$1
		UNION ALL SELECT 'r:'||r.title||'/'||t.name FROM request_tag rt JOIN request r ON r.id=rt.request_id JOIN tag t ON t.id=rt.tag_id WHERE rt.workspace_id=$1`)
	return s
}

func TestExportThenImportIntoACleanWorkspacePreservesEverything(t *testing.T) {
	db := testdb.New(t)
	svc := &portability.Service{Pool: db.Backend}
	src := tenant(t, db, store.RoleAdmin)
	populate(t, db, src)
	before := summarise(t, db, src.WorkspaceID)
	if len(before.Requests) != 3 || len(before.Sources) != 4 || len(before.Accounts) != 2 || len(before.Tags) != 2 || len(before.OptOuts) != 2 || len(before.Notes) != 2 || len(before.Statuses) != 6 || len(before.Research) != 2 {
		t.Fatalf("test data: %+v", before)
	}

	var buf bytes.Buffer
	if err := svc.Export(ctx, src, &buf); err != nil {
		t.Fatal(err)
	}
	if !json.Valid(buf.Bytes()) {
		t.Fatal("export is not valid JSON")
	}
	var doc portability.Document
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Version != portability.Version || len(doc.Evidence) != 4 || len(doc.Sources) != 4 || len(doc.Requests) != 3 || len(doc.People) != 4 || len(doc.Accounts) != 2 || len(doc.Tags) != 2 || len(doc.Suppressions) != 2 || len(doc.ReleaseNotes) != 2 || len(doc.Statuses) != 6 || len(doc.Highlights) != 1 {
		t.Fatalf("document counts: %+v", doc)
	}
	// The file can be checked on its own, with no database.
	if err := portability.Verify(&doc); err != nil {
		t.Fatalf("the export does not verify: %v", err)
	}

	dst := tenant(t, db, store.RoleAdmin)
	if err := svc.Import(ctx, dst, bytes.NewReader(buf.Bytes())); err != nil {
		t.Fatal(err)
	}
	after := summarise(t, db, dst.WorkspaceID)
	for name, pair := range map[string][2][]string{"accounts": {before.Accounts, after.Accounts}, "people": {before.People, after.People}, "sources": {before.Sources, after.Sources}, "requests": {before.Requests, after.Requests}, "tags": {before.Tags, after.Tags}, "opt-outs": {before.OptOuts, after.OptOuts}, "statuses": {before.Statuses, after.Statuses}, "release notes": {before.Notes, after.Notes}, "highlights and tag use": {before.Research, after.Research}} {
		if strings.Join(pair[0], "\n") != strings.Join(pair[1], "\n") {
			t.Errorf("%s differ after the round trip:\n before: %v\n  after: %v", name, pair[0], pair[1])
		}
	}
	// Importing a request that is already shipped must not start any messages.
	var batches, messages int
	_ = db.Super.QueryRow(ctx, `SELECT (SELECT count(*) FROM outreach_batch WHERE workspace_id=$1), (SELECT count(*) FROM outreach_message WHERE workspace_id=$1)`, dst.WorkspaceID).Scan(&batches, &messages)
	if batches != 0 || messages != 0 {
		t.Fatalf("import created %d batches and %d messages", batches, messages)
	}
	// Nothing was shared between the two workspaces (fresh ids).
	var shared int
	_ = db.Super.QueryRow(ctx, `SELECT count(*) FROM request a JOIN request b ON a.title=b.title AND a.id=b.id AND a.workspace_id<>b.workspace_id`).Scan(&shared)
	if shared != 0 {
		t.Fatal("ids were reused")
	}
	// The new workspace exports to an equivalent document.
	var again bytes.Buffer
	if err := svc.Export(ctx, dst, &again); err != nil {
		t.Fatal(err)
	}
	var doc2 portability.Document
	_ = json.Unmarshal(again.Bytes(), &doc2)
	if len(doc2.Evidence) != len(doc.Evidence) || len(doc2.Sources) != len(doc.Sources) {
		t.Fatal("second export differs in size")
	}
}

func TestImportRefusesNonEmptyWorkspacesBadFilesAndNonAdmins(t *testing.T) {
	db := testdb.New(t)
	svc := &portability.Service{Pool: db.Backend}
	src := tenant(t, db, store.RoleAdmin)
	populate(t, db, src)
	var buf bytes.Buffer
	if err := svc.Export(ctx, src, &buf); err != nil {
		t.Fatal(err)
	}

	// Importing into the workspace it came from (not empty) is refused and changes nothing.
	before := summarise(t, db, src.WorkspaceID)
	if err := svc.Import(ctx, src, bytes.NewReader(buf.Bytes())); !errors.Is(err, portability.ErrNotEmpty) {
		t.Fatalf("non-empty import: %v", err)
	}
	if after := summarise(t, db, src.WorkspaceID); strings.Join(before.Requests, "") != strings.Join(after.Requests, "") {
		t.Fatal("a refused import changed data")
	}

	// A tampered file is rejected as a whole and writes nothing.
	var doc portability.Document
	_ = json.Unmarshal(buf.Bytes(), &doc)
	doc.Evidence[0].Quote = "something the customer never said"
	tampered, _ := json.Marshal(doc)
	dst := tenant(t, db, store.RoleAdmin)
	if err := svc.Import(ctx, dst, bytes.NewReader(tampered)); !errors.Is(err, portability.ErrBadFormat) {
		t.Fatalf("tampered quote: %v", err)
	}
	if s := summarise(t, db, dst.WorkspaceID); len(s.Requests)+len(s.Sources)+len(s.People)+len(s.Accounts) != 0 {
		t.Fatalf("partial import: %+v", s)
	}
	for name, bad := range map[string]string{
		"not json":      "hello",
		"wrong version": `{"version":"other"}`,
		"unknown field": `{"version":"workspace-export-v1","hacked":true}`,
		"dangling ref":  `{"version":"workspace-export-v1","evidence":[{"id":"` + uuid.NewString() + `","requestId":"` + uuid.NewString() + `","sourceId":"` + uuid.NewString() + `","quote":"x","spanStart":0,"spanEnd":1,"createdAt":"2026-01-01T00:00:00Z"}]}`,
	} {
		if err := svc.Import(ctx, dst, strings.NewReader(bad)); !errors.Is(err, portability.ErrBadFormat) {
			t.Errorf("%s: %v", name, err)
		}
	}

	// Only admins may export or import: exports contain everything, including people's emails.
	member := src
	member.Role = store.RoleMember
	if err := svc.Export(ctx, member, &bytes.Buffer{}); !errors.Is(err, portability.ErrNotAdmin) {
		t.Fatalf("member export: %v", err)
	}
	if err := svc.Import(ctx, member, bytes.NewReader(buf.Bytes())); !errors.Is(err, portability.ErrNotAdmin) {
		t.Fatalf("member import: %v", err)
	}
	// Exporting never includes another workspace's data.
	other := tenant(t, db, store.RoleAdmin)
	var otherBuf bytes.Buffer
	_ = svc.Export(ctx, other, &otherBuf)
	var otherDoc portability.Document
	_ = json.Unmarshal(otherBuf.Bytes(), &otherDoc)
	if len(otherDoc.People)+len(otherDoc.Sources)+len(otherDoc.Evidence) != 0 {
		t.Fatal("export leaked another workspace's data")
	}
}

func TestExportStreamsLargeWorkspacesInPages(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	db := testdb.New(t)
	svc := &portability.Service{Pool: db.Backend}
	ten := tenant(t, db, store.RoleAdmin)
	// 2,500 accounts and people force more than one page for each.
	if _, err := db.Super.Exec(ctx, `INSERT INTO account (workspace_id, name, revenue) SELECT $1, 'Acct '||g, g FROM generate_series(1,2500) g`, ten.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Super.Exec(ctx, `INSERT INTO person (workspace_id, name, email, account_id) SELECT $1, 'Person '||g, 'p'||g||'@x.io', (SELECT id FROM account WHERE workspace_id=$1 AND name='Acct '||g) FROM generate_series(1,2500) g`, ten.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := svc.Export(ctx, ten, &buf); err != nil {
		t.Fatal(err)
	}
	var doc portability.Document
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Accounts) != 2500 || len(doc.People) != 2500 {
		t.Fatalf("paging lost rows: %d accounts, %d people", len(doc.Accounts), len(doc.People))
	}
	seen := map[uuid.UUID]bool{}
	for _, a := range doc.Accounts {
		if seen[a.ID] {
			t.Fatal("an account was exported twice")
		}
		seen[a.ID] = true
	}
}

func TestVerifyRejectsTamperedHighlightsAndTags(t *testing.T) {
	good := func() *portability.Document {
		d := &portability.Document{Version: portability.Version}
		src, tag := uuid.New(), uuid.New()
		d.Sources = []portability.Source{{ID: src, Title: "s", Text: "We need single sign-on today."}}
		d.Tags = []portability.Tag{{ID: tag, Name: "Security", Color: "red", Origin: "human"}}
		d.Highlights = []portability.Highlight{{ID: uuid.New(), SourceID: src, Quote: "single sign-on", SpanStart: 8, SpanEnd: 22, TagIDs: []uuid.UUID{tag}}}
		return d
	}
	if err := portability.Verify(good()); err != nil {
		t.Fatalf("a good document was refused: %v", err)
	}
	for name, mutate := range map[string]func(*portability.Document){
		"changed quote":    func(d *portability.Document) { d.Highlights[0].Quote = "single sign-off" },
		"shifted span":     func(d *portability.Document) { d.Highlights[0].SpanStart++ },
		"missing source":   func(d *portability.Document) { d.Highlights[0].SourceID = uuid.New() },
		"missing tag":      func(d *portability.Document) { d.Highlights[0].TagIDs = []uuid.UUID{uuid.New()} },
		"duplicate tag id": func(d *portability.Document) { d.Tags = append(d.Tags, d.Tags[0]) },
		"request missing tag": func(d *portability.Document) {
			d.Requests = []portability.Request{{ID: uuid.New(), Title: "r", TagIDs: []uuid.UUID{uuid.New()}}}
		},
	} {
		d := good()
		mutate(d)
		if err := portability.Verify(d); !errors.Is(err, portability.ErrBadFormat) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestSampleWorkspaceIsAVerifiedRealLookingWorkspaceDatedToNow(t *testing.T) {
	db := testdb.New(t)
	svc := &portability.Service{Pool: db.Backend}
	ten := tenant(t, db, store.RoleAdmin)

	if err := svc.ImportSample(ctx, ten); err != nil {
		t.Fatal(err)
	}
	ws := ten.WorkspaceID
	count := func(q string) int {
		t.Helper()
		var n int
		if err := db.Super.QueryRow(ctx, q, ws).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	// Enough of each thing that every screen has something to show.
	for q, min := range map[string]int{
		`SELECT count(*) FROM request WHERE workspace_id=$1`:     6,
		`SELECT count(*) FROM evidence WHERE workspace_id=$1`:    8,
		`SELECT count(*) FROM person WHERE workspace_id=$1`:      4,
		`SELECT count(*) FROM account WHERE workspace_id=$1`:     3,
		`SELECT count(*) FROM source_item WHERE workspace_id=$1`: 4,
		`SELECT count(*) FROM tag WHERE workspace_id=$1`:         2,
		`SELECT count(*) FROM highlight WHERE workspace_id=$1`:   1,
	} {
		if got := count(q); got < min {
			t.Errorf("%s: %d rows, want at least %d", q, got, min)
		}
	}
	// Every status type is represented, so board and roadmap are not lopsided.
	if got := count(`SELECT count(DISTINCT s.bucket) FROM request r JOIN status s ON s.id=r.status_id AND s.workspace_id=r.workspace_id WHERE r.workspace_id=$1`); got != 4 {
		t.Errorf("requests span %d status types, want 4", got)
	}
	// No claim without a source: every stored quote is verbatim at its stored offsets.
	if got := count(`SELECT count(*) FROM evidence e JOIN source_item s ON s.id=e.source_item_id WHERE e.workspace_id=$1 AND convert_from(substring(convert_to(s.raw_text,'UTF8') from e.span_start+1 for e.span_end-e.span_start),'UTF8') <> e.quote_text`); got != 0 {
		t.Errorf("%d evidence rows do not match their source text", got)
	}
	// Dates are moved to now, so "last 30 days" charts are not empty whenever someone opens the sample.
	var newest, oldest time.Time
	if err := db.Super.QueryRow(ctx, `SELECT max(created_at), min(created_at) FROM source_item WHERE workspace_id=$1`, ws).Scan(&newest, &oldest); err != nil {
		t.Fatal(err)
	}
	if age := time.Since(newest); age < 0 || age > 7*24*time.Hour {
		t.Errorf("newest conversation is %v old, want within a week", age)
	}
	if time.Since(oldest) > 30*24*time.Hour {
		t.Errorf("oldest conversation is %v old, want within 30 days", time.Since(oldest))
	}

	// Only an admin, and only into an empty workspace.
	if err := svc.ImportSample(ctx, ten); !errors.Is(err, portability.ErrNotEmpty) {
		t.Errorf("second import: %v", err)
	}
	member := tenant(t, db, store.RoleMember)
	if err := svc.ImportSample(ctx, member); !errors.Is(err, portability.ErrNotAdmin) {
		t.Errorf("member import: %v", err)
	}
}
