package findings_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"product/api/internal/findings"
	"product/api/internal/store"
	"product/api/internal/testdb"
)

var ctx = context.Background()

type env struct {
	db     *testdb.DB
	svc    *findings.Service
	ws     uuid.UUID
	admin  store.Tenant
	member store.Tenant
	viewer store.Tenant
	other  store.Tenant
	src    uuid.UUID
	chunk  uuid.UUID
	req    uuid.UUID
}

const sourceText = "Dana Lee said: we really need single sign-on today. Also exports keep dropping rows, and I love the new search."

func setup(t *testing.T) *env {
	t.Helper()
	db := testdb.New(t)
	e := &env{db: db, ws: uuid.New(), svc: &findings.Service{Pool: db.Backend, Secret: []byte("findings-test-secret-with-enough-length"), BaseURL: "https://app.example"}}
	mk := func(ws uuid.UUID, role store.Role) store.Tenant {
		return store.Tenant{WorkspaceID: ws, UserID: uuid.New(), Role: role}
	}
	e.admin, e.member, e.viewer = mk(e.ws, store.RoleAdmin), mk(e.ws, store.RoleMember), mk(e.ws, store.RoleViewer)
	e.other = mk(uuid.New(), store.RoleAdmin)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, ten := range []store.Tenant{e.admin, e.member, e.viewer, e.other} {
		if ten.WorkspaceID != e.ws || ten.UserID == e.admin.UserID {
			if ten.WorkspaceID != e.ws {
				_, err := db.Super.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1,'Elsewhere') ON CONFLICT DO NOTHING`, ten.WorkspaceID)
				must(err)
			} else {
				_, err := db.Super.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1,'Acme') ON CONFLICT DO NOTHING`, ten.WorkspaceID)
				must(err)
			}
		} else {
			_, err := db.Super.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1,'Acme') ON CONFLICT DO NOTHING`, ten.WorkspaceID)
			must(err)
		}
		_, err := db.Super.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,$3)`, ten.WorkspaceID, ten.UserID, string(ten.Role))
		must(err)
	}
	must(db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, created_by) VALUES ($1,'paste','Interview with Dana Lee',$2,$3,$4) RETURNING id`, e.ws, sourceText, uuid.NewString(), e.admin.UserID).Scan(&e.src))
	must(db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, e.ws, e.src, len(sourceText), sourceText).Scan(&e.chunk))
	must(db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'Single sign-on') RETURNING id`, e.ws).Scan(&e.req))
	return e
}

// fresh makes a source of its own (the same words and title), so quotes never collide on position.
func (e *env) fresh(t *testing.T) (src, chunk uuid.UUID) {
	t.Helper()
	if err := e.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, created_by) VALUES ($1,'paste','Interview with Dana Lee',$2,$3,$4) RETURNING id`, e.ws, sourceText, uuid.NewString(), e.admin.UserID).Scan(&src); err != nil {
		t.Fatal(err)
	}
	if err := e.db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,$3,$4) RETURNING id`, e.ws, src, len(sourceText), sourceText).Scan(&chunk); err != nil {
		t.Fatal(err)
	}
	return
}

// evidence makes an evidence row for a phrase of the source text.
func (e *env) evidence(t *testing.T, phrase string) uuid.UUID {
	t.Helper()
	start := strings.Index(sourceText, phrase)
	if start < 0 {
		t.Fatalf("%q is not in the source", phrase)
	}
	src, chunk := e.fresh(t)
	var id uuid.UUID
	if err := e.db.Super.QueryRow(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		e.ws, e.req, src, chunk, phrase, start, start+len(phrase), e.admin.UserID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func (e *env) highlight(t *testing.T, phrase string) uuid.UUID {
	t.Helper()
	start := strings.Index(sourceText, phrase)
	src, chunk := e.fresh(t)
	var id uuid.UUID
	if err := e.db.Super.QueryRow(ctx, `INSERT INTO highlight (workspace_id, source_item_id, chunk_id, span_start, span_end, quote_text, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		e.ws, src, chunk, start, start+len(phrase), phrase, e.admin.UserID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func idp(id uuid.UUID) *uuid.UUID { return &id }

func (e *env) doc(t *testing.T, title string, in []findings.BlockInput) uuid.UUID {
	t.Helper()
	id, err := e.svc.Create(ctx, e.member, title)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetBlocks(ctx, e.member, id, in); err != nil {
		t.Fatal(err)
	}
	return id
}

const (
	sso     = "we really need single sign-on today"
	exports = "exports keep dropping rows"
	search  = "I love the new search"
)

func TestCardsShowTheStoredQuoteAndSayWhenItWasRemoved(t *testing.T) {
	e := setup(t)
	// 30 documents, every card resolves to a stored quote word for word; then some quotes are deleted
	type card struct {
		doc  uuid.UUID
		kind string
		id   uuid.UUID
		text string
	}
	var cards []card
	phrases := []string{sso, exports, search}
	for d := 0; d < 30; d++ {
		var in []findings.BlockInput
		in = append(in, findings.BlockInput{Kind: "text", Body: fmt.Sprintf("Finding %d", d)})
		var local []card
		for i := 0; i < 5; i++ {
			ph := phrases[(d+i)%3]
			if i%2 == 0 {
				id := e.evidence(t, ph)
				in = append(in, findings.BlockInput{Kind: "quote", QuoteKind: "evidence", QuoteID: idp(id), Body: "note"})
				local = append(local, card{kind: "evidence", id: id, text: ph})
			} else {
				id := e.highlight(t, ph)
				in = append(in, findings.BlockInput{Kind: "quote", QuoteKind: "highlight", QuoteID: idp(id)})
				local = append(local, card{kind: "highlight", id: id, text: ph})
			}
		}
		doc := e.doc(t, fmt.Sprintf("Document %d", d), in)
		for i := range local {
			local[i].doc = doc
		}
		cards = append(cards, local...)
	}
	check := func(removed map[uuid.UUID]bool) {
		t.Helper()
		byDoc := map[uuid.UUID][]card{}
		for _, c := range cards {
			byDoc[c.doc] = append(byDoc[c.doc], c)
		}
		resolved, gone := 0, 0
		for doc, cs := range byDoc {
			d, err := e.svc.Get(ctx, e.member, doc)
			if err != nil {
				t.Fatal(err)
			}
			var quotes []findings.Block
			for _, b := range d.Blocks {
				if b.Kind == "quote" {
					quotes = append(quotes, b)
				}
			}
			if len(quotes) != len(cs) {
				t.Fatalf("doc has %d cards, want %d", len(quotes), len(cs))
			}
			for i, b := range quotes {
				if removed[cs[i].id] {
					if !b.Removed || b.Quote != "" || b.QuoteID != nil {
						t.Errorf("a deleted quote is not shown as removed: %+v", b)
					}
					gone++
					continue
				}
				if b.Removed || b.Quote != cs[i].text || b.QuoteID == nil || *b.QuoteID != cs[i].id || b.SourceTitle != "Interview with Dana Lee" {
					t.Errorf("card does not show its stored quote: %+v (want %q)", b, cs[i].text)
				}
				resolved++
			}
		}
		if resolved+gone != 150 {
			t.Errorf("%d cards checked, want 150", resolved+gone)
		}
	}
	check(map[uuid.UUID]bool{})
	// delete a third of the quotes at the source
	removed := map[uuid.UUID]bool{}
	for i, c := range cards {
		if i%3 == 0 {
			tbl := "evidence"
			if c.kind == "highlight" {
				tbl = "highlight"
			}
			if _, err := e.db.Super.Exec(ctx, `DELETE FROM `+tbl+` WHERE id=$1`, c.id); err != nil {
				t.Fatal(err)
			}
			removed[c.id] = true
		}
	}
	check(removed)
}

func TestWhatMayBePutInADocument(t *testing.T) {
	e := setup(t)
	id, _ := e.svc.Create(ctx, e.member, "Draft")
	ev := e.evidence(t, sso)
	if _, err := e.svc.Create(ctx, e.viewer, "x"); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer made a document: %v", err)
	}
	if err := e.svc.SetBlocks(ctx, e.viewer, id, nil); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a viewer edited: %v", err)
	}
	bad := map[string][]findings.BlockInput{
		"empty text":           {{Kind: "text", Body: "  "}},
		"long text":            {{Kind: "text", Body: strings.Repeat("x", 5001)}},
		"empty heading":        {{Kind: "heading", Body: "  "}},
		"long heading":         {{Kind: "heading", Body: strings.Repeat("h", 201)}},
		"unknown type":         {{Kind: "image"}},
		"a card with no quote": {{Kind: "quote"}},
		"an invented quote":    {{Kind: "quote", QuoteKind: "evidence", QuoteID: idp(uuid.New())}},
		"a long note":          {{Kind: "quote", QuoteKind: "evidence", QuoteID: idp(ev), Body: strings.Repeat("n", 1001)}},
		"a card from an id that is not in this document": {{Kind: "quote", ID: idp(uuid.New())}},
	}
	for name, in := range bad {
		if err := e.svc.SetBlocks(ctx, e.member, id, in); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	tooMany := make([]findings.BlockInput, 201)
	for i := range tooMany {
		tooMany[i] = findings.BlockInput{Kind: "text", Body: "x"}
	}
	if err := e.svc.SetBlocks(ctx, e.member, id, tooMany); err == nil {
		t.Error("201 blocks were accepted")
	}
	// another workspace's quote cannot be cited
	otherEvidence := uuid.New()
	_ = otherEvidence
	var theirs uuid.UUID
	e.db.Super.QueryRow(ctx, `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ($1,'paste','single sign-on please',$2,$3) RETURNING id`, e.other.WorkspaceID, uuid.NewString(), e.other.UserID).Scan(&theirs)
	var theirChunk, theirReq uuid.UUID
	e.db.Super.QueryRow(ctx, `INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) VALUES ($1,$2,0,0,21,'single sign-on please') RETURNING id`, e.other.WorkspaceID, theirs).Scan(&theirChunk)
	e.db.Super.QueryRow(ctx, `INSERT INTO request (workspace_id, title) VALUES ($1,'x') RETURNING id`, e.other.WorkspaceID).Scan(&theirReq)
	var theirEv uuid.UUID
	e.db.Super.QueryRow(ctx, `INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) VALUES ($1,$2,$3,$4,'single sign-on',0,14,$5) RETURNING id`, e.other.WorkspaceID, theirReq, theirs, theirChunk, e.other.UserID).Scan(&theirEv)
	if err := e.svc.SetBlocks(ctx, e.member, id, []findings.BlockInput{{Kind: "quote", QuoteKind: "evidence", QuoteID: idp(theirEv)}}); err == nil {
		t.Error("a quote from another workspace was cited")
	}
	// nothing was kept from the refused attempts
	if d, _ := e.svc.Get(ctx, e.member, id); len(d.Blocks) != 0 {
		t.Errorf("%d blocks survived refused edits", len(d.Blocks))
	}
	if err := e.svc.SetBlocks(ctx, e.member, id, []findings.BlockInput{
		{Kind: "heading", Body: "What we heard"},
		{Kind: "text", Body: "Sign-in comes up most."},
	}); err != nil {
		t.Errorf("a heading was refused: %v", err)
	}
	// a workspace cannot see or change another's documents
	if _, err := e.svc.Get(ctx, e.other, id); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("another workspace read the document: %v", err)
	}
	if err := e.svc.SetBlocks(ctx, e.other, id, nil); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("another workspace edited: %v", err)
	}
	if rows, _ := e.svc.List(ctx, e.other, "", false); len(rows) != 0 {
		t.Errorf("another workspace lists %d documents", len(rows))
	}
	// keeping a card whose quote was removed (by id) is allowed; the edit does not resurrect or lose it
	hl := e.highlight(t, exports)
	doc := e.doc(t, "Keep", []findings.BlockInput{{Kind: "quote", QuoteKind: "highlight", QuoteID: idp(hl)}})
	d, _ := e.svc.Get(ctx, e.member, doc)
	cardID := d.Blocks[0].ID
	e.db.Super.Exec(ctx, `DELETE FROM highlight WHERE id=$1`, hl)
	if err := e.svc.SetBlocks(ctx, e.member, doc, []findings.BlockInput{{Kind: "text", Body: "Intro"}, {Kind: "quote", ID: &cardID, Body: "still here"}}); err != nil {
		t.Fatal(err)
	}
	d, _ = e.svc.Get(ctx, e.member, doc)
	if len(d.Blocks) != 2 || !d.Blocks[1].Removed || d.Blocks[1].Body != "still here" {
		t.Errorf("blocks %+v", d.Blocks)
	}
}

func TestAPublishedDocumentShowsWordsOnlyAndEndsTheMomentItIsTakenDown(t *testing.T) {
	e := setup(t)
	ev := e.evidence(t, sso)
	hl := e.highlight(t, exports)
	doc := e.doc(t, "What customers told us", []findings.BlockInput{
		{Kind: "heading", Body: "What we heard"},
		{Kind: "text", Body: "Sign-in and exports come up most."},
		{Kind: "quote", QuoteKind: "evidence", QuoteID: idp(ev), Body: "Several teams said this."},
		{Kind: "quote", QuoteKind: "highlight", QuoteID: idp(hl)},
	})
	if _, _, err := e.svc.Publish(ctx, e.member, doc, true, nil, ""); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member published: %v", err)
	}
	if _, _, err := e.svc.Publish(ctx, e.admin, doc, false, nil, ""); !errors.Is(err, findings.ErrNotSure) {
		t.Errorf("published without confirming: %v", err)
	}
	empty, _ := e.svc.Create(ctx, e.admin, "Empty")
	if _, _, err := e.svc.Publish(ctx, e.admin, empty, true, nil, ""); err == nil {
		t.Error("an empty document was published")
	}
	if _, _, err := e.svc.Publish(ctx, e.other, doc, true, nil, ""); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("another workspace published: %v", err)
	}
	link, _, err := e.svc.Publish(ctx, e.admin, doc, true, nil, "")
	if err != nil || !strings.HasPrefix(link, "https://app.example/f/f.") {
		t.Fatalf("publish: %q %v", link, err)
	}
	token := strings.TrimPrefix(link, "https://app.example/f/")
	again, _, _ := e.svc.Publish(ctx, e.admin, doc, true, nil, "")
	if again != link {
		t.Error("publishing twice changed the link")
	}
	// the public view: the words, and nothing that identifies a person, a source or a workspace
	pub, err := e.svc.Public(ctx, token, "")
	if err != nil || pub.Title != "What customers told us" || len(pub.Blocks) != 4 {
		t.Fatalf("public: %+v %v", pub, err)
	}
	if pub.Blocks[0].Kind != "heading" || pub.Blocks[0].Text != "What we heard" {
		t.Fatalf("public heading: %+v", pub.Blocks[0])
	}
	raw, _ := json.Marshal(pub)
	for _, secret := range []string{"Dana", "Interview", "Acme", e.ws.String(), e.src.String(), ev.String(), hl.String(), e.admin.UserID.String(), "Single sign-on"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("the public view leaks %q: %s", secret, raw)
		}
	}
	if pub.Blocks[2].Text != sso || pub.Blocks[2].Note != "Several teams said this." || pub.Blocks[3].Text != exports {
		t.Errorf("blocks %+v", pub.Blocks)
	}
	// a published document cannot be edited behind the link's back
	if err := e.svc.SetBlocks(ctx, e.member, doc, nil); !errors.Is(err, findings.ErrConflict) {
		t.Errorf("edited a published document: %v", err)
	}
	// a quote deleted at the source disappears from the public page at once
	e.db.Super.Exec(ctx, `DELETE FROM highlight WHERE id=$1`, hl)
	if pub, _ = e.svc.Public(ctx, token, ""); len(pub.Blocks) != 3 {
		t.Errorf("a deleted quote is still public: %+v", pub.Blocks)
	}
	// forged, edited and borrowed links
	parts := strings.Split(token, ".")
	for name, bad := range map[string]string{
		"empty":            "",
		"garbage":          "hello",
		"a bad signature":  strings.Join([]string{parts[0], parts[1], parts[2], parts[3], "AAAAAAAAAAAAAAAAAAAAAA"}, "."),
		"another document": strings.Join([]string{parts[0], parts[1], strings.Repeat("0", 32), parts[3], parts[4]}, "."),
		"too long":         token + strings.Repeat("a", 300),
	} {
		if _, err := e.svc.Public(ctx, bad, ""); !errors.Is(err, findings.ErrNotFound) {
			t.Errorf("%s: %v", name, err)
		}
	}
	other := &findings.Service{Pool: e.db.Backend, Secret: []byte("another-secret-with-enough-length-1234567890"), BaseURL: "x"}
	if _, err := other.Public(ctx, token, ""); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("a link signed with another secret: %v", err)
	}
	// taking it down ends the link at once; publishing again makes a new link and the old one stays dead
	if err := e.svc.Unpublish(ctx, e.member, doc); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member took it down: %v", err)
	}
	if err := e.svc.Unpublish(ctx, e.admin, doc); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Public(ctx, token, ""); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("the link works after take-down: %v", err)
	}
	if err := e.svc.Unpublish(ctx, e.admin, doc); !errors.Is(err, findings.ErrConflict) {
		t.Errorf("taking down a draft: %v", err)
	}
	// the card whose quote was deleted blocks publishing until it is removed
	if _, _, err := e.svc.Publish(ctx, e.admin, doc, true, nil, ""); err == nil {
		t.Error("published with a card whose quote was removed")
	}
	d, _ := e.svc.Get(ctx, e.member, doc)
	var keep []findings.BlockInput
	for _, b := range d.Blocks {
		if !b.Removed {
			id := b.ID
			keep = append(keep, findings.BlockInput{ID: &id, Kind: b.Kind, Body: b.Body, QuoteKind: b.QuoteKind})
		}
	}
	keep[0].ID = nil // the paragraph has no card id
	if err := e.svc.SetBlocks(ctx, e.member, doc, keep); err != nil {
		t.Fatal(err)
	}
	newLink, _, err := e.svc.Publish(ctx, e.admin, doc, true, nil, "")
	if err != nil || newLink == link {
		t.Fatalf("republish: %q %v", newLink, err)
	}
	if _, err := e.svc.Public(ctx, token, ""); !errors.Is(err, findings.ErrNotFound) {
		t.Error("the first link came back to life")
	}
	if _, err := e.svc.Public(ctx, strings.TrimPrefix(newLink, "https://app.example/f/"), ""); err != nil {
		t.Errorf("the new link: %v", err)
	}
	// deleting a document ends its link too
	if err := e.svc.Delete(ctx, e.member, doc); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member deleted: %v", err)
	}
	if err := e.svc.Delete(ctx, e.admin, doc); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Public(ctx, strings.TrimPrefix(newLink, "https://app.example/f/"), ""); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("a deleted document's link: %v", err)
	}
}

func TestAQuoteCanBeAppendedWithoutTouchingTheRest(t *testing.T) {
	e := setup(t)
	// One quote card already has a note on it; appending must not lose that note.
	first := e.evidence(t, sso)
	extra := e.highlight(t, search)
	id := e.doc(t, "Append", []findings.BlockInput{
		{Kind: "text", Body: "What we heard"},
		{Kind: "quote", QuoteKind: "evidence", QuoteID: idp(first), Body: "the blocker"},
	})

	if err := e.svc.AddQuote(ctx, e.member, id, "highlight", extra); err != nil {
		t.Fatal(err)
	}
	d, err := e.svc.Get(ctx, e.member, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Blocks) != 3 || d.Blocks[0].Kind != "text" || d.Blocks[1].Body != "the blocker" || d.Blocks[2].QuoteID == nil || *d.Blocks[2].QuoteID != extra {
		t.Fatalf("blocks = %+v; want the note kept and the highlight appended", d.Blocks)
	}

	if err := e.svc.AddQuote(ctx, e.viewer, id, "highlight", extra); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer = %v, want forbidden", err)
	}
	if err := e.svc.AddQuote(ctx, e.member, id, "highlight", uuid.New()); err == nil {
		t.Fatal("a quote that does not exist must be refused")
	}
	if err := e.svc.AddQuote(ctx, e.member, id, "banana", extra); err == nil {
		t.Fatal("an unknown quote type must be refused")
	}

	if _, _, err := e.svc.Publish(ctx, e.admin, id, true, nil, ""); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.AddQuote(ctx, e.member, id, "highlight", extra); !errors.Is(err, findings.ErrConflict) {
		t.Fatalf("published = %v, want conflict", err)
	}
}

func TestSearchDuplicateAndRecentlyDeleted(t *testing.T) {
	e := setup(t)
	id := e.doc(t, "Sign-in notes", []findings.BlockInput{
		{Kind: "heading", Body: "What we heard"},
		{Kind: "text", Body: "The identity provider keeps coming up."},
	})

	rows, err := e.svc.List(ctx, e.member, "identity provider", false)
	if err != nil || len(rows) != 1 || rows[0].ID != id {
		t.Fatalf("search: %+v %v", rows, err)
	}
	if rows, _ := e.svc.List(ctx, e.member, "nothing like this", false); len(rows) != 0 {
		t.Fatalf("search matched nothing unexpectedly: %+v", rows)
	}

	copyID, err := e.svc.Duplicate(ctx, e.member, id)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	copyDoc, err := e.svc.Get(ctx, e.member, copyID)
	if err != nil || copyDoc.Title != "Sign-in notes (copy)" || len(copyDoc.Blocks) != 2 {
		t.Fatalf("copy: %+v %v", copyDoc, err)
	}
	original, _ := e.svc.Get(ctx, e.member, id)
	if len(original.Blocks) != 2 {
		t.Fatalf("duplicate changed the original: %+v", original)
	}

	if err := e.svc.Delete(ctx, e.member, id); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member deleted a document: %v", err)
	}
	if err := e.svc.Delete(ctx, e.admin, id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := e.svc.Get(ctx, e.member, id); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("a deleted document is still readable: %v", err)
	}
	if err := e.svc.Delete(ctx, e.admin, id); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("deleted twice: %v", err)
	}
	if rows, _ := e.svc.List(ctx, e.admin, "", false); len(rows) != 1 || rows[0].ID != copyID {
		t.Fatalf("live list: %+v", rows)
	}
	trash, err := e.svc.List(ctx, e.admin, "", true)
	if err != nil || len(trash) != 1 || trash[0].ID != id || trash[0].DeletedAt == nil {
		t.Fatalf("trash: %+v %v", trash, err)
	}
	if _, err := e.svc.List(ctx, e.member, "", true); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member listed the trash: %v", err)
	}
	if err := e.svc.Restore(ctx, e.member, id); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member restored a document: %v", err)
	}
	if err := e.svc.Restore(ctx, e.admin, id); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if _, err := e.svc.Get(ctx, e.member, id); err != nil {
		t.Fatalf("restored document unreadable: %v", err)
	}
}

func TestVersionsCanBeRestored(t *testing.T) {
	e := setup(t)
	id := e.doc(t, "Draft", []findings.BlockInput{{Kind: "text", Body: "First version"}})
	first, err := e.svc.Versions(ctx, e.member, id)
	if err != nil || len(first) != 1 {
		t.Fatalf("versions: %+v %v", first, err)
	}
	if err := e.svc.SetBlocks(ctx, e.member, id, []findings.BlockInput{{Kind: "text", Body: "Second version"}}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RestoreVersion(ctx, e.member, id, first[0].ID); err != nil {
		t.Fatalf("restore version: %v", err)
	}
	d, _ := e.svc.Get(ctx, e.member, id)
	if len(d.Blocks) != 1 || d.Blocks[0].Body != "First version" {
		t.Fatalf("restored content: %+v", d.Blocks)
	}
	after, _ := e.svc.Versions(ctx, e.member, id)
	if len(after) < 2 {
		t.Fatalf("restoring did not record the change: %+v", after)
	}
}

func TestPasswordAndExpiryProtectALink(t *testing.T) {
	e := setup(t)
	id := e.doc(t, "Protected", []findings.BlockInput{{Kind: "text", Body: "Customers said this."}})
	link, _, err := e.svc.Publish(ctx, e.admin, id, true, nil, "correct horse battery")
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	token := strings.TrimPrefix(link, "https://app.example/f/")

	if _, err := e.svc.Public(ctx, token, ""); !errors.Is(err, findings.ErrPasswordRequired) {
		t.Fatalf("public without a password: %v", err)
	}
	if _, _, err := e.svc.Unlock(ctx, token, "wrong password"); !errors.Is(err, findings.ErrBadPassword) {
		t.Fatalf("wrong password: %v", err)
	}
	grant, until, err := e.svc.Unlock(ctx, token, "correct horse battery")
	if err != nil || grant == "" || !until.After(time.Now()) {
		t.Fatalf("unlock: %q %v %v", grant, until, err)
	}
	if p, err := e.svc.Public(ctx, token, grant); err != nil || len(p.Blocks) != 1 {
		t.Fatalf("public with grant: %+v %v", p, err)
	}
	if _, _, err := e.svc.Publish(ctx, e.admin, id, true, nil, "short"); err == nil {
		t.Error("a short password was accepted")
	}
	past := time.Now().Add(-time.Minute)
	if _, _, err := e.svc.Publish(ctx, e.admin, id, true, &past, ""); err == nil {
		t.Error("an expiry in the past was accepted")
	}
	if _, err := e.db.Super.Exec(ctx, `UPDATE finding_doc SET share_expires_at = now() - interval '1 minute' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Public(ctx, token, grant); !errors.Is(err, findings.ErrNotFound) {
		t.Errorf("an expired link still opened: %v", err)
	}
}
