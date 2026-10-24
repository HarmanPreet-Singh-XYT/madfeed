package inbox_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/inbox"
	"product/api/internal/store"
)

func TestHandingAConversationToATeammate(t *testing.T) {
	e := setup(t)
	e.chat(t, 1, "Where is my order?")
	c := e.conversations(t, e.admin)[0]

	if err := e.svc.AssignTo(ctx, e.member, c.ID, e.member2.UserID, nil); err != nil {
		t.Fatal(err)
	}
	if got := e.conversations(t, e.admin)[0].Assignee; got == nil || *got != e.member2.UserID {
		t.Fatalf("assignee %v", got)
	}
	// the caller saw it unassigned, but it now has an owner: nothing changes
	if err := e.svc.AssignTo(ctx, e.member, c.ID, e.member.UserID, nil); !errors.Is(err, inbox.ErrStale) {
		t.Errorf("stale hand-over: %v", err)
	}
	// handing over again with the right view works
	cur := e.member2.UserID
	if err := e.svc.AssignTo(ctx, e.member, c.ID, e.admin.UserID, &cur); err != nil {
		t.Fatal(err)
	}
	// not to a viewer, not to a stranger, not to someone from another workspace
	for name, to := range map[string]uuid.UUID{"viewer": e.viewer.UserID, "stranger": uuid.New(), "other workspace": e.other.UserID} {
		cur := e.admin.UserID
		var ie inbox.ErrInvalid
		if err := e.svc.AssignTo(ctx, e.member, c.ID, to, &cur); !errors.As(err, &ie) {
			t.Errorf("%s: %v", name, err)
		}
	}
	// a viewer cannot hand anything over; another workspace's person finds nothing
	cur = e.admin.UserID
	if err := e.svc.AssignTo(ctx, e.viewer, c.ID, e.member.UserID, &cur); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer: %v", err)
	}
	if err := e.svc.AssignTo(ctx, e.other, c.ID, e.other.UserID, &cur); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("other workspace: %v", err)
	}
}

func TestNamesAreSetByTheirOwnerAndListedForTeammates(t *testing.T) {
	e := setup(t)
	if err := e.svc.SetMyName(ctx, e.member, "  Priya  "); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SetMyName(ctx, e.member, strings.Repeat("x", 81)); err == nil {
		t.Error("an 81-character name was accepted")
	}
	if err := e.svc.SetMyName(ctx, e.member, "two\nlines"); err == nil {
		t.Error("a name with a line break was accepted")
	}
	if err := e.svc.SetMyName(ctx, e.viewer, "Vi"); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer: %v", err)
	}
	ms, err := e.svc.Teammates(ctx, e.viewer)
	if err != nil || len(ms) != 4 {
		t.Fatalf("%v %v", ms, err)
	}
	named := 0
	for _, m := range ms {
		if m.UserID == e.member.UserID && m.Name == "Priya" {
			named++
		}
	}
	if named != 1 {
		t.Errorf("the name is not listed: %+v", ms)
	}
	if other, _ := e.svc.Teammates(ctx, e.other); len(other) != 1 {
		t.Errorf("another workspace sees %d people", len(other))
	}
}

func TestCannedReplies(t *testing.T) {
	e := setup(t)
	id, err := e.svc.CreateCanned(ctx, e.member, "Shipping time", "Orders arrive in 3 to 5 days.")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CreateCanned(ctx, e.member2, "  shipping TIME ", "x"); err == nil {
		t.Error("the same name (any case) was accepted twice")
	}
	if _, err := e.svc.CreateCanned(ctx, e.viewer, "v", "x"); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer create: %v", err)
	}
	if _, err := e.svc.CreateCanned(ctx, e.member, "", "x"); err == nil {
		t.Error("an empty name was accepted")
	}
	if _, err := e.svc.CreateCanned(ctx, e.member, "Long", strings.Repeat("x", 5001)); err == nil {
		t.Error("an over-long body was accepted")
	}
	if err := e.svc.UpdateCanned(ctx, e.member2, id, "Shipping", "Arrives in 2 days."); err != nil {
		t.Fatal(err)
	}
	list, _ := e.svc.CannedReplies(ctx, e.viewer) // viewers may read
	if len(list) != 1 || list[0].Name != "Shipping" || list[0].Body != "Arrives in 2 days." {
		t.Fatalf("%+v", list)
	}
	if l, _ := e.svc.CannedReplies(ctx, e.other); len(l) != 0 {
		t.Error("another workspace sees saved replies")
	}
	if err := e.svc.UpdateCanned(ctx, e.other, id, "x", "y"); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("update from another workspace: %v", err)
	}
	if err := e.svc.DeleteCanned(ctx, e.viewer, id); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("viewer delete: %v", err)
	}
	if err := e.svc.DeleteCanned(ctx, e.member, id); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteCanned(ctx, e.member, id); !errors.Is(err, inbox.ErrNotFound) {
		t.Errorf("delete twice: %v", err)
	}
	for i := 0; i < inbox.MaxCannedReplies; i++ {
		if _, err := e.svc.CreateCanned(ctx, e.member, "r"+strings.Repeat("a", i%30)+string(rune('A'+i/30)), "b"); err != nil {
			t.Fatalf("%d: %v", i, err)
		}
	}
	if _, err := e.svc.CreateCanned(ctx, e.member, "one too many", "b"); err == nil {
		t.Error("a 101st saved reply was accepted")
	}
}

func TestReplyTimesAndWhoIsWaiting(t *testing.T) {
	e := setup(t)
	for i := 1; i <= 3; i++ {
		e.chat(t, i, "Question number "+strings.Repeat("a", i))
	}
	cs := e.conversations(t, e.admin)
	// two were created 2 hours and 6 hours ago and are answered 30 minutes and 90 minutes after; one is still waiting
	e.q(t, `UPDATE conversation SET created_at = now() - interval '2 hours' WHERE id = $1`, cs[0].ID)
	e.q(t, `UPDATE conversation SET created_at = now() - interval '6 hours' WHERE id = $1`, cs[1].ID)
	e.q(t, `UPDATE conversation_message SET created_at = now() - interval '30 hours' WHERE conversation_id = $1`, cs[2].ID)
	for i, c := range cs[:2] {
		d, _ := e.svc.Get(ctx, e.member, c.ID)
		if _, err := e.svc.Reply(ctx, e.member, c.ID, d.LastID, "Hello"); err != nil {
			t.Fatal(err)
		}
		mins := []int{30, 90}[i]
		e.q(t, `UPDATE conversation SET first_reply_at = created_at + make_interval(mins => $2) WHERE id = $1`, c.ID, mins)
	}
	// a second reply must not move the first-reply time
	d, _ := e.svc.Get(ctx, e.member, cs[0].ID)
	before := d
	if _, err := e.svc.Reply(ctx, e.member, cs[0].ID, before.LastID, "Anything else?"); err != nil {
		t.Fatal(err)
	}
	var kept int
	e.db.Super.QueryRow(ctx, `SELECT extract(epoch FROM first_reply_at - created_at)::int / 60 FROM conversation WHERE id=$1`, cs[0].ID).Scan(&kept)
	if kept != 30 {
		t.Errorf("a later reply changed the first-reply time to %d minutes", kept)
	}
	st, err := e.svc.Stats(ctx, e.viewer)
	if err != nil {
		t.Fatal(err)
	}
	if st.Answered != 2 || st.MedianMinutes < 59 || st.MedianMinutes > 61 || st.P90Minutes < 83 || st.P90Minutes > 85 {
		t.Errorf("stats %+v", st)
	}
	if st.Waiting != 1 || st.OldestWaitingMin < 29*60 || st.OverTarget != 0 || st.TargetHours != 0 {
		t.Errorf("waiting %+v", st)
	}
	if err := e.svc.SetReplyTarget(ctx, e.member, 24); !errors.Is(err, store.ErrForbidden) {
		t.Errorf("a member set the target: %v", err)
	}
	if err := e.svc.SetReplyTarget(ctx, e.admin, 721); err == nil {
		t.Error("a 721-hour target was accepted")
	}
	if err := e.svc.SetReplyTarget(ctx, e.admin, 24); err != nil {
		t.Fatal(err)
	}
	if st, _ = e.svc.Stats(ctx, e.member); st.TargetHours != 24 || st.OverTarget != 1 {
		t.Errorf("with a 24 h target %+v", st)
	}
	// the channel settings (and their keys) survive the target being set
	if got, _ := e.svc.GetSettings(ctx, e.admin); !got.ChatEnabled || got.WidgetToken != e.widget {
		t.Errorf("settings changed: %+v", got)
	}
	if st, _ := e.svc.Stats(ctx, e.other); st.Answered != 0 || st.Waiting != 0 {
		t.Errorf("another workspace's stats %+v", st)
	}
}
