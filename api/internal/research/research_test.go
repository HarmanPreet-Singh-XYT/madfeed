package research_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/research"
	"product/api/internal/store"
	"product/api/internal/store/dbgen"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type env struct {
	db     *testdb.DB
	svc    *research.Service
	admin  store.Tenant
	member store.Tenant
	viewer store.Tenant
}

func newTenant(t *testing.T, db *testdb.DB, ws uuid.UUID, role store.Role) store.Tenant {
	t.Helper()
	ten := store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: role}
	if err := store.WithTenant(ctx, db.Backend, ten, func(q *dbgen.Queries) error {
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws, UserID: ten.UserID, Role: string(role)})
	}); err != nil {
		t.Fatal(err)
	}
	return ten
}

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	ws := uuid.New()
	admin := store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, db.Backend, admin, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: ws, Name: "Acme"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: ws, UserID: admin.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	return &env{db: db, svc: &research.Service{Pool: db.Backend}, admin: admin,
		member: newTenant(t, db, ws, store.RoleMember), viewer: newTenant(t, db, ws, store.RoleViewer)}
}

// source stores a conversation split into two chunks and returns its id.
func (e *env) source(t *testing.T, ws uuid.UUID, text string) uuid.UUID {
	t.Helper()
	var src uuid.UUID
	if err := e.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste',$2,$3,$4) RETURNING id`, ws, text, uuid.NewString(), e.admin.UserID).Scan(&src); err != nil {
		t.Fatal(err)
	}
	mid := len(text) / 2
	for i, r := range [][2]int{{0, mid}, {mid, len(text)}} {
		if _, err := e.db.Super.Exec(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,$3,$4,$5,$6)`, ws, src, i, r[0], r[1], text[r[0]:r[1]]); err != nil {
			t.Fatal(err)
		}
	}
	return src
}

func span(text, quote string) (int, int) {
	i := strings.Index(text, quote)
	return i, i + len(quote)
}

const convo = "Priya: we need single sign-on, it blocks our rollout. Also the export is slow — très lent, honestly."

func TestHighlightsAreVerbatimAndTagged(t *testing.T) {
	e := setup(t)
	src := e.source(t, e.admin.WorkspaceID, convo)
	tag, err := e.svc.CreateTag(ctx, e.member, research.TagInput{Name: "  Security  ", Definition: "Anything about access control", Color: "red"})
	if err != nil {
		t.Fatal(err)
	}
	quote := "single sign-on, it blocks our rollout"
	s, en := span(convo, quote)
	h, err := e.svc.CreateHighlight(ctx, e.member, research.HighlightInput{SourceItemID: src, SpanStart: s, SpanEnd: en, Quote: quote, TagIDs: []uuid.UUID{tag}})
	if err != nil {
		t.Fatal(err)
	}
	if h.Quote != quote || len(h.Tags) != 1 || h.Tags[0].Name != "Security" {
		t.Fatalf("%+v", h)
	}
	// Same passage again returns the same highlight, not a duplicate.
	again, err := e.svc.CreateHighlight(ctx, e.member, research.HighlightInput{SourceItemID: src, SpanStart: s, SpanEnd: en, Quote: quote})
	if err != nil || again.ID != h.ID {
		t.Fatalf("%v %+v", err, again)
	}
	// A passage with multi-byte characters keeps byte-exact offsets.
	q2 := "très lent"
	s2, e2 := span(convo, q2)
	if _, err := e.svc.CreateHighlight(ctx, e.member, research.HighlightInput{SourceItemID: src, SpanStart: s2, SpanEnd: e2, Quote: q2}); err != nil {
		t.Fatal(err)
	}
	// A quote that is not what the source says at that span is refused; so are splits inside a character and bad ranges.
	bad := []research.HighlightInput{
		{SourceItemID: src, SpanStart: s, SpanEnd: en, Quote: "single sign-on, it blocks our rollout!"},
		{SourceItemID: src, SpanStart: s + 1, SpanEnd: en, Quote: quote},
		{SourceItemID: src, SpanStart: s2 + 3, SpanEnd: s2 + 5, Quote: convo[s2+3 : s2+5]}, // starts in the middle of "è"
		{SourceItemID: src, SpanStart: -1, SpanEnd: 5, Quote: "Priya"},
		{SourceItemID: src, SpanStart: 0, SpanEnd: len(convo) + 10, Quote: convo},
		{SourceItemID: src, SpanStart: 0, SpanEnd: 5, Quote: "  "},
	}
	for i, in := range bad {
		var inv research.ErrInvalid
		if _, err := e.svc.CreateHighlight(ctx, e.member, in); !errors.As(err, &inv) {
			t.Errorf("bad input %d accepted or wrong error: %v", i, err)
		}
	}
	// The database refuses a mismatched quote even if code is bypassed.
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO highlight (workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, author_id)
		SELECT $1, $2, id, 0, 5, 'WRONG', $3 FROM chunk WHERE source_item_id=$2 AND ordinal=0`, e.admin.WorkspaceID, src, e.admin.UserID); err == nil {
		t.Error("database accepted a quote that is not in the source")
	}
	// An archived tag cannot be applied.
	if err := e.svc.ArchiveTag(ctx, e.admin, tag); err != nil {
		t.Fatal(err)
	}
	var inv research.ErrInvalid
	if _, err := e.svc.CreateHighlight(ctx, e.member, research.HighlightInput{SourceItemID: src, SpanStart: 0, SpanEnd: 5, Quote: "Priya", TagIDs: []uuid.UUID{tag}}); !errors.As(err, &inv) {
		t.Errorf("archived tag accepted: %v", err)
	}
	// The source text can never change under a highlight.
	if _, err := e.db.Super.Exec(ctx, `UPDATE source_item SET raw_text = 'changed' WHERE id=$1`, src); err == nil {
		t.Error("source text was editable")
	}
}

func TestMergeMovesEverythingAndUndoRestoresExactly(t *testing.T) {
	e := setup(t)
	src := e.source(t, e.admin.WorkspaceID, strings.Repeat("a customer said something useful here. ", 400))
	text := strings.Repeat("a customer said something useful here. ", 400)
	mk := func(name string) uuid.UUID {
		id, err := e.svc.CreateTag(ctx, e.admin, research.TagInput{Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	from, into, other := mk("SSO"), mk("Single sign-on"), mk("Other")
	// 200 highlights carry "SSO"; every 5th also already carries "Single sign-on"; 20 have both SSO and Other.
	var all []uuid.UUID
	for i := 0; i < 200; i++ {
		s := i * 38
		q := text[s : s+30]
		tags := []uuid.UUID{from}
		if i%5 == 0 {
			tags = append(tags, into)
		}
		if i%10 == 0 {
			tags = append(tags, other)
		}
		h, err := e.svc.CreateHighlight(ctx, e.member, research.HighlightInput{SourceItemID: src, SpanStart: s, SpanEnd: s + 30, Quote: q, TagIDs: tags})
		if err != nil {
			t.Fatal(i, err)
		}
		all = append(all, h.ID)
	}
	var req uuid.UUID
	if err := e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'SSO') RETURNING id`, e.admin.WorkspaceID).Scan(&req); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Super.Exec(ctx, `INSERT INTO request_tag (workspace_id, request_id, tag_id) VALUES ($1,$2,$3)`, e.admin.WorkspaceID, req, from); err != nil {
		t.Fatal(err)
	}
	snapshot := func() string {
		rows, err := e.db.Super.Query(ctx, `SELECT 'h', highlight_id::text, tag_id::text FROM highlight_tag UNION ALL SELECT 'r', request_id::text, tag_id::text FROM request_tag ORDER BY 1,2,3`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var b strings.Builder
		for rows.Next() {
			var a, c, d string
			_ = rows.Scan(&a, &c, &d)
			fmt.Fprintln(&b, a, c, d)
		}
		return b.String()
	}
	count := func(tag uuid.UUID) (n int) {
		_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM highlight_tag WHERE tag_id=$1`, tag).Scan(&n)
		return
	}
	before := snapshot()

	// Not allowed for members or viewers; not onto itself.
	for _, ten := range []store.Tenant{e.member, e.viewer} {
		if _, err := e.svc.MergeTags(ctx, ten, from, into); !errors.Is(err, store.ErrForbidden) {
			t.Fatalf("%s merged: %v", ten.Role, err)
		}
	}
	var inv research.ErrInvalid
	if _, err := e.svc.MergeTags(ctx, e.admin, from, from); !errors.As(err, &inv) {
		t.Fatalf("self merge: %v", err)
	}

	res, err := e.svc.MergeTags(ctx, e.admin, from, into)
	if err != nil {
		t.Fatal(err)
	}
	if res.Highlights != 200 || res.Requests != 1 {
		t.Fatalf("%+v", res)
	}
	if count(from) != 0 || count(into) != 200 {
		t.Fatalf("after merge: from=%d into=%d", count(from), count(into))
	}
	var onReq int
	_ = e.db.Super.QueryRow(ctx, `SELECT count(*) FROM request_tag WHERE request_id=$1 AND tag_id=$2`, req, into).Scan(&onReq)
	if onReq != 1 {
		t.Fatal("request tag not moved")
	}
	tags, _ := e.svc.ListTags(ctx, e.viewer, false)
	for _, tg := range tags {
		if tg.ID == from {
			t.Fatal("merged tag still listed")
		}
	}
	// A merged tag cannot be merged again until restored.
	if _, err := e.svc.MergeTags(ctx, e.admin, from, other); !errors.As(err, new(research.ErrConflict)) {
		t.Fatalf("merging an archived tag: %v", err)
	}

	id, err := e.svc.LatestMerge(ctx, e.admin, from)
	if err != nil || id != res.MergeID {
		t.Fatalf("%v %v", err, id)
	}
	if err := e.svc.UndoMerge(ctx, e.member, res.MergeID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("member undid: %v", err)
	}
	if err := e.svc.UndoMerge(ctx, e.admin, res.MergeID); err != nil {
		t.Fatal(err)
	}
	if after := snapshot(); after != before {
		t.Fatalf("undo did not restore exactly\nbefore:\n%.400s\nafter:\n%.400s", before, after)
	}
	if err := e.svc.UndoMerge(ctx, e.admin, res.MergeID); !errors.As(err, new(research.ErrConflict)) {
		t.Fatalf("second undo: %v", err)
	}
	_ = all
}

func TestCodebookRulesRolesAndIsolation(t *testing.T) {
	e := setup(t)
	id, err := e.svc.CreateTag(ctx, e.member, research.TagInput{Name: "Pricing"})
	if err != nil {
		t.Fatal(err)
	}
	// Names are unique ignoring case and spacing; archiving frees the name.
	for _, n := range []string{"pricing", " PRICING "} {
		if _, err := e.svc.CreateTag(ctx, e.member, research.TagInput{Name: n}); !errors.As(err, new(research.ErrConflict)) {
			t.Errorf("duplicate %q: %v", n, err)
		}
	}
	for _, in := range []research.TagInput{{Name: ""}, {Name: strings.Repeat("x", 61)}, {Name: "ok", Definition: strings.Repeat("d", 501)}, {Name: "ok", Color: "mauve"}} {
		if _, err := e.svc.CreateTag(ctx, e.member, in); !errors.As(err, new(research.ErrInvalid)) {
			t.Errorf("%+v accepted: %v", in, err)
		}
	}
	if _, err := e.svc.CreateTag(ctx, e.viewer, research.TagInput{Name: "viewer tag"}); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer created a tag: %v", err)
	}
	if err := e.svc.ArchiveTag(ctx, e.member, id); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("member archived: %v", err)
	}
	if err := e.svc.ArchiveTag(ctx, e.admin, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CreateTag(ctx, e.member, research.TagInput{Name: "Pricing"}); err != nil {
		t.Errorf("name not freed: %v", err)
	}
	if err := e.svc.RestoreTag(ctx, e.admin, id); !errors.As(err, new(research.ErrConflict)) {
		t.Errorf("restore over a live name: %v", err)
	}
	// Another workspace sees none of it and cannot touch it.
	otherWS := uuid.New()
	other := store.Tenant{WorkspaceID: otherWS, UserID: uuid.New(), Role: store.RoleAdmin}
	if err := store.WithTenant(ctx, e.db.Backend, other, func(q *dbgen.Queries) error {
		if _, err := q.CreateWorkspace(ctx, dbgen.CreateWorkspaceParams{ID: otherWS, Name: "Other"}); err != nil {
			return err
		}
		return q.AddMember(ctx, dbgen.AddMemberParams{WorkspaceID: otherWS, UserID: other.UserID, Role: "admin"})
	}); err != nil {
		t.Fatal(err)
	}
	if tags, _ := e.svc.ListTags(ctx, other, true); len(tags) != 0 {
		t.Errorf("leak: %+v", tags)
	}
	if err := e.svc.UpdateTag(ctx, other, id, research.TagInput{Name: "stolen"}); !errors.Is(err, research.ErrNotFound) {
		t.Errorf("cross-tenant update: %v", err)
	}
	if err := e.svc.ArchiveTag(ctx, other, id); !errors.Is(err, research.ErrNotFound) {
		t.Errorf("cross-tenant archive: %v", err)
	}
	src := e.source(t, e.admin.WorkspaceID, convo)
	h, err := e.svc.CreateHighlight(ctx, e.member, research.HighlightInput{SourceItemID: src, SpanStart: 0, SpanEnd: 5, Quote: "Priya"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CreateHighlight(ctx, other, research.HighlightInput{SourceItemID: src, SpanStart: 0, SpanEnd: 5, Quote: "Priya"}); !errors.Is(err, research.ErrNotFound) {
		t.Errorf("cross-tenant highlight: %v", err)
	}
	if hs, _ := e.svc.ListHighlights(ctx, other, research.ListFilter{}); len(hs) != 0 {
		t.Errorf("leak: %+v", hs)
	}
	if err := e.svc.DeleteHighlight(ctx, other, h.ID); !errors.Is(err, research.ErrNotFound) {
		t.Errorf("cross-tenant delete: %v", err)
	}
	if err := e.svc.DeleteHighlight(ctx, e.viewer, h.ID); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer deleted: %v", err)
	}
	if err := e.svc.DeleteHighlight(ctx, e.member, h.ID); err != nil {
		t.Error(err)
	}
}
