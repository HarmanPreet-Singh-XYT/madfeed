package inbox_test

import (
	"bytes"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/inbox"
	"product/api/internal/store"
)

var (
	png = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)
	pdf = []byte("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")
)

func (e *env) upload(t *testing.T, v int, name string, data []byte) (inbox.Attachment, error) {
	t.Helper()
	return e.svc.ChatUploadFile(ctx, e.widget, origin, visitor(v), "203.0.113."+strconv.Itoa(v), name, bytes.NewReader(data))
}

func TestFilesGoBothWaysInChatAndStayWithTheirConversation(t *testing.T) {
	e := setup(t)
	a, err := e.upload(t, 1, `..\..\my receipt?.png`, png)
	if err != nil {
		t.Fatal(err)
	}
	if a.Name != "my receipt_.png" || a.ContentType != "image/png" {
		t.Fatalf("name %q type %q: path parts and odd characters must go", a.Name, a.ContentType)
	}
	// sent with a message (no words needed)
	err = e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: origin, Visitor: visitor(1), Addr: "203.0.113.1", Files: []uuid.UUID{a.ID}})
	if err != nil {
		t.Fatal(err)
	}
	// the same file cannot be sent twice, nor another visitor's
	if err := e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: origin, Visitor: visitor(1), Text: "again", Addr: "203.0.113.1", Files: []uuid.UUID{a.ID}}); err == nil {
		t.Error("a file was sent twice")
	}
	other, _ := e.upload(t, 2, "x.pdf", pdf)
	if err := e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: origin, Visitor: visitor(1), Text: "stolen", Addr: "203.0.113.1", Files: []uuid.UUID{other.ID}}); err == nil {
		t.Error("another visitor's file was attached")
	}

	c := e.conversations(t, e.admin)[0]
	d, _ := e.svc.Get(ctx, e.viewer, c.ID)
	if len(d.Thread) != 1 || d.Thread[0].Body != inbox.NoText || len(d.Thread[0].Files) != 1 || d.Thread[0].Files[0].ID != a.ID {
		t.Fatalf("thread %+v", d.Thread)
	}
	f, err := e.svc.OpenFile(ctx, e.viewer, c.ID, a.ID)
	if err != nil || !bytes.Equal(f.Data, png) {
		t.Fatalf("download: %v", err)
	}

	// the team answers with a file; the visitor sees and can open it
	tf, err := e.svc.UploadFile(ctx, e.member, c.ID, "answer.pdf", bytes.NewReader(pdf))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Reply(ctx, e.member2, c.ID, d.LastID, "see attached", tf.ID); err == nil {
		t.Error("a teammate sent a file someone else uploaded")
	}
	if _, err := e.svc.Reply(ctx, e.member, c.ID, d.LastID, "See the attached.", tf.ID); err != nil {
		t.Fatal(err)
	}
	msgs, err := e.svc.ChatPoll(ctx, e.widget, origin, visitor(1), 0)
	if err != nil || len(msgs) != 2 || !msgs[1].FromTeam || len(msgs[1].Files) != 1 || len(msgs[0].Files) != 1 {
		t.Fatalf("poll %+v %v", msgs, err)
	}
	got, err := e.svc.ChatOpenFile(ctx, e.widget, origin, visitor(1), tf.ID)
	if err != nil || !bytes.Equal(got.Data, pdf) {
		t.Fatalf("visitor download: %v", err)
	}
	// but never another conversation's file, from another site, or with the wrong widget
	if _, err := e.svc.ChatOpenFile(ctx, e.widget, origin, visitor(2), tf.ID); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("another visitor opened it: %v", err)
	}
	if _, err := e.svc.ChatOpenFile(ctx, e.widget, "https://evil.example", visitor(1), tf.ID); err == nil {
		t.Error("opened from an unlisted site")
	}
	if _, err := e.svc.OpenFile(ctx, e.other, c.ID, a.ID); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("another workspace opened it: %v", err)
	}
	if _, err := e.svc.OpenFile(ctx, e.member, uuid.New(), a.ID); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("a file opened through the wrong conversation: %v", err)
	}
}

func TestOnlyPlainFilesOfAllowedKindsAndSizesAreAccepted(t *testing.T) {
	e := setup(t)
	bad := map[string][]byte{
		"page.html":   []byte("<html><script>alert(1)</script></html>"),
		"image.svg":   []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>`),
		"run.exe":     append([]byte("MZ"), bytes.Repeat([]byte{0}, 100)...),
		"archive.zip": append([]byte("PK\x03\x04"), bytes.Repeat([]byte{0}, 100)...),
		"empty.txt":   {},
	}
	for name, data := range bad {
		if _, err := e.upload(t, 1, name, data); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// a program renamed to look like a picture is still a program
	if _, err := e.upload(t, 1, "cute.png", []byte("MZ\x90\x00\x03")); err == nil {
		t.Error("a renamed program was accepted")
	}
	if _, err := e.upload(t, 1, "ok.txt", []byte("just some words")); err != nil {
		t.Errorf("plain text refused: %v", err)
	}
	big := append(append([]byte{}, pdf...), bytes.Repeat([]byte("a"), inbox.MaxAttachmentBytes)...)
	if _, err := e.upload(t, 3, "big.pdf", big); err == nil {
		t.Error("a file over 5 MB was accepted")
	}
	exact := append(append([]byte{}, pdf...), bytes.Repeat([]byte("a"), inbox.MaxAttachmentBytes-len(pdf))...)
	if _, err := e.upload(t, 4, "exact.pdf", exact); err != nil {
		t.Errorf("a file of exactly 5 MB was refused: %v", err)
	}
}

func TestFileCountsAndWhoMayUpload(t *testing.T) {
	e := setup(t)
	// more than 5 waiting uploads from one visitor
	for i := 0; i < inbox.MaxPendingPerSender; i++ {
		if _, err := e.upload(t, 1, "a.png", png); err != nil {
			t.Fatalf("%d: %v", i, err)
		}
	}
	if _, err := e.upload(t, 1, "a.png", png); err == nil {
		t.Error("a sixth waiting upload was accepted")
	}
	// at most 3 per message
	var ids []uuid.UUID
	for i := 0; i < 4; i++ {
		a, err := e.upload(t, 2, "a.png", png)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, a.ID)
	}
	err := e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: origin, Visitor: visitor(2), Text: "four", Addr: "203.0.113.2", Files: ids})
	if err == nil || !strings.Contains(err.Error(), "3") {
		t.Errorf("four files in one message: %v", err)
	}
	// nothing sent: the failed message left no half-saved message behind
	for _, c := range e.conversations(t, e.admin) {
		if c.Messages != 0 && c.Preview == "four" {
			t.Error("a refused message was stored")
		}
	}
	// uploads need a real widget and a listed site
	if _, err := e.svc.ChatUploadFile(ctx, e.widget, "https://evil.example", visitor(5), "203.0.113.5", "a.png", bytes.NewReader(png)); err == nil {
		t.Error("upload from an unlisted site")
	}
	if _, err := e.svc.ChatUploadFile(ctx, "c.not-real", origin, visitor(5), "203.0.113.5", "a.png", bytes.NewReader(png)); err == nil {
		t.Error("upload with a made-up widget address")
	}
	// teammates: writers only, chat only
	e.chat(t, 6, "hello")
	e.sendEmail(t, inbox.InboundEmail{From: "dana@acme.test", Subject: "Hi", Text: "hello", MessageID: "<f1@mail>"})
	var chatID, mailID uuid.UUID
	for _, c := range e.conversations(t, e.admin) {
		if c.Channel == "chat" && c.Preview == "hello" {
			chatID = c.ID
		}
		if c.Channel == "email" {
			mailID = c.ID
		}
	}
	if _, err := e.svc.UploadFile(ctx, e.viewer, chatID, "a.png", bytes.NewReader(png)); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer upload: %v", err)
	}
	if _, err := e.svc.UploadFile(ctx, e.member, mailID, "a.png", bytes.NewReader(png)); err == nil {
		t.Error("a file was accepted for an email conversation")
	}
	if _, err := e.svc.UploadFile(ctx, e.other, chatID, "a.png", bytes.NewReader(png)); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("upload into another workspace's conversation: %v", err)
	}
}

func TestDeletingAConversationDeletesItsFiles(t *testing.T) {
	e := setup(t)
	a, _ := e.upload(t, 1, "a.png", png)
	e.svc.ChatSend(ctx, inbox.ChatInput{Token: e.widget, Origin: origin, Visitor: visitor(1), Text: "hi", Addr: "203.0.113.1", Files: []uuid.UUID{a.ID}})
	c := e.conversations(t, e.admin)[0]
	if err := e.svc.Delete(ctx, e.admin, c.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	e.db.Super.QueryRow(ctx, `SELECT count(*) FROM conversation_attachment WHERE workspace_id=$1`, e.ws).Scan(&n)
	if n != 0 {
		t.Errorf("%d files survived the deletion", n)
	}
}
