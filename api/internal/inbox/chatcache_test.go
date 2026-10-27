package inbox_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"

	"product/api/internal/cache"
	"product/api/internal/inbox"
)

func withCache(t *testing.T, e *env) *miniredis.Miniredis {
	t.Helper()
	mr := miniredis.RunT(t)
	rc, err := cache.NewRedis("redis://"+mr.Addr(), "t")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rc.Close() })
	e.svc.Cache = rc
	return mr
}

func TestAQuietChatIsAnsweredWithoutTheDatabaseButNewsStillGetsThrough(t *testing.T) {
	e := setup(t)
	withCache(t, e)
	poll := func(after int) []inbox.ChatMessage {
		t.Helper()
		m, err := e.svc.ChatPoll(ctx, e.widget, origin, visitor(1), after)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}

	if len(poll(0)) != 0 { // remembered as quiet
		t.Fatal("a visitor with no conversation saw messages")
	}
	// A message appears behind the cache's back: the quiet answer is still served, proving the database was skipped.
	if err := e.chatDirect(t, 1, "hello"); err != nil {
		t.Fatal(err)
	}
	if len(poll(0)) != 0 {
		t.Fatal("the quiet answer did not come from the cache")
	}
	// The same message sent the proper way tells the poll to look again.
	if err := e.chat(t, 1, "is anyone there?"); err != nil {
		t.Fatal(err)
	}
	got := poll(0)
	if len(got) == 0 || got[len(got)-1].Text != "is anyone there?" {
		t.Fatalf("a new visitor message was not seen: %+v", got)
	}
	last := got[len(got)-1].Seq

	// Quiet again, then a team reply must come through at once.
	if len(poll(last)) != 0 {
		t.Fatal("expected nothing newer")
	}
	c := e.conversations(t, e.member)[0]
	d, err := e.svc.Get(ctx, e.member, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Reply(ctx, e.member, c.ID, d.LastID, "We are here."); err != nil {
		t.Fatal(err)
	}
	if got := poll(last); len(got) != 1 || !got[0].FromTeam || got[0].Text != "We are here." {
		t.Fatalf("the team's reply was held back: %+v", got)
	}
}

func TestAQuietAnswerIsOnlyForTheOriginAndVisitorItWasGivenTo(t *testing.T) {
	e := setup(t)
	withCache(t, e)
	if _, err := e.svc.ChatPoll(ctx, e.widget, origin, visitor(1), 0); err != nil {
		t.Fatal(err)
	}
	// Another site must still be refused, not handed the cached "nothing".
	if _, err := e.svc.ChatPoll(ctx, e.widget, "https://evil.example", visitor(1), 0); !errors.Is(err, inbox.ErrOrigin) {
		t.Fatalf("a different origin got %v", err)
	}
	// Another visitor's messages are theirs alone.
	if err := e.chatDirect(t, 2, "mine"); err != nil {
		t.Fatal(err)
	}
	if m, err := e.svc.ChatPoll(ctx, e.widget, origin, visitor(2), 0); err != nil || len(m) != 1 {
		t.Fatalf("visitor 2: %v %v", m, err)
	}
}

// chatDirect adds a visitor message without telling the cache, as if another process had done it a moment ago.
func (e *env) chatDirect(t *testing.T, v int, text string) error {
	t.Helper()
	saved := e.svc.Cache
	e.svc.Cache = nil
	defer func() { e.svc.Cache = saved }()
	return e.chat(t, v, text)
}

func TestOnePublicWidgetCannotFillTheCacheWithQuietMarkers(t *testing.T) {
	e := setup(t)
	mr := withCache(t, e)
	// The widget's token is public and a visitor id is whatever the browser sends: a script can poll with endless new ones.
	for i := 0; i < 700; i++ {
		if _, err := e.svc.ChatPoll(ctx, e.widget, origin, visitor(10_000+i), 0); err != nil {
			t.Fatal(err)
		}
	}
	markers := 0
	for _, k := range mr.Keys() {
		if strings.Contains(k, "chatidle:") {
			markers++
		}
	}
	if markers == 0 || markers > 600 {
		t.Fatalf("%d quiet markers for one workspace in a minute, want between 1 and 600", markers)
	}
	// Past the cap a poll still works; it just asks the database.
	if err := e.chat(t, 10_699, "still gets through"); err != nil {
		t.Fatal(err)
	}
	if m, err := e.svc.ChatPoll(ctx, e.widget, origin, visitor(10_699), 0); err != nil || len(m) != 1 {
		t.Fatalf("a visitor past the cap: %v %v", m, err)
	}
}
