package api

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func asUser(id uuid.UUID, email string, verified bool) string {
	v := "u"
	if verified {
		v = "v"
	}
	return fmt.Sprintf("t:%s|%s|%s", id, email, v)
}

func TestInvitingATeammateAndTheirFirstDay(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Team Co")
	base := "/v1/workspaces/" + ws
	newbie := uuid.New()
	good := asUser(newbie, "Newbie@Acme.com", true)

	// invalid input
	for name, body := range map[string]map[string]any{
		"no email": {"email": "", "role": "member"}, "odd email": {"email": "a b@c.com", "role": "member"},
		"a list of emails": {"email": "a@b.co,c@d.co", "role": "member"}, "unknown role": {"email": "x@acme.com", "role": "owner"},
	} {
		if c, _, _ := h.do(h.alice, "POST", base+"/invitations", body); c != 400 {
			t.Errorf("%s: %d", name, c)
		}
	}
	// a stranger to the workspace cannot invite into it
	if c, _, _ := h.do(h.bob, "POST", base+"/invitations", map[string]any{"email": "x@acme.com", "role": "member"}); c != 403 && c != 404 {
		t.Errorf("a stranger invited: %d", c)
	}

	c, inv, body := h.do(h.alice, "POST", base+"/invitations", map[string]any{"email": " Newbie@Acme.com ", "role": "member"})
	if c != 201 {
		t.Fatalf("invite: %d %v", c, body)
	}
	i := inv["invitation"].(map[string]any)
	link := i["link"].(string)
	if i["email"] != "newbie@acme.com" || i["role"] != "member" || inv["emailQueued"] != false || !strings.HasPrefix(link, "https://app.example/invite/m.") {
		t.Fatalf("invitation %v", inv)
	}
	token := strings.TrimPrefix(link, "https://app.example/invite/")
	// inviting the same address again updates the one invitation
	_, again, _ := h.do(h.alice, "POST", base+"/invitations", map[string]any{"email": "newbie@acme.com", "role": "viewer"})
	if again["invitation"].(map[string]any)["id"] != i["id"] || again["invitation"].(map[string]any)["role"] != "viewer" {
		t.Errorf("a second invitation was made: %v", again)
	}
	h.do(h.alice, "POST", base+"/invitations", map[string]any{"email": "newbie@acme.com", "role": "member"})
	_, list, _ := h.do(h.alice, "GET", base+"/invitations", nil)
	if l := list["invitations"].([]any); len(l) != 1 || list["emailEnabled"] != false {
		t.Errorf("pending %v", list)
	}

	// the link is signed: altered or foreign links look like nothing
	for name, tk := range map[string]string{"altered": token[:len(token)-3] + "AAA", "invented": "m." + strings.Repeat("0", 32) + "." + strings.Repeat("1", 32) + ".xxxxxxxxxxxxxxxxxxxxxx", "empty-ish": strings.Repeat("a", 30)} {
		if c, _, _ := h.do(good, "GET", "/v1/invitations/"+tk, nil); c != 404 {
			t.Errorf("%s link: %d", name, c)
		}
		if c, _, _ := h.do(good, "POST", "/v1/invitations/"+tk+"/accept", nil); c != 404 {
			t.Errorf("%s accept: %d", name, c)
		}
	}
	if c, _, _ := h.do("", "GET", "/v1/invitations/"+token, nil); c != 401 {
		t.Errorf("not signed in: %d", c)
	}

	// someone else, or the right address not yet confirmed, can look but not join
	for name, tok := range map[string]string{
		"another person":         asUser(uuid.New(), "carol@acme.com", true),
		"an unconfirmed address": asUser(uuid.New(), "newbie@acme.com", false),
		"no address at all":      "t:" + uuid.NewString(),
	} {
		_, p, _ := h.do(tok, "GET", "/v1/invitations/"+token, nil)
		if p["workspaceName"] != "Team Co" || p["canAccept"] != false || p["state"] != "open" {
			t.Errorf("%s preview %v", name, p)
		}
		if c, b, _ := h.do(tok, "POST", "/v1/invitations/"+token+"/accept", nil); c != 403 || !strings.Contains(fmt.Sprint(b), "different email address") {
			t.Errorf("%s accept: %d %v", name, c, b)
		}
	}
	if _, w, _ := h.do(asUser(uuid.New(), "carol@acme.com", true), "GET", "/v1/workspaces", nil); len(w["workspaces"].([]any)) != 0 {
		t.Error("a refused person was added")
	}

	// the invited person joins
	_, p, _ := h.do(good, "GET", "/v1/invitations/"+token, nil)
	if p["canAccept"] != true || p["email"] != "newbie@acme.com" || p["role"] != "member" {
		t.Fatalf("preview %v", p)
	}
	c, joined, b := h.do(good, "POST", "/v1/invitations/"+token+"/accept", nil)
	if c != 200 || joined["workspaceId"] != ws {
		t.Fatalf("accept: %d %v", c, b)
	}
	if _, w, _ := h.do(good, "GET", "/v1/workspaces", nil); len(w["workspaces"].([]any)) != 1 || w["workspaces"].([]any)[0].(map[string]any)["role"] != "member" {
		t.Errorf("workspaces %v", w)
	}
	if c, b, _ := h.do(good, "POST", "/v1/invitations/"+token+"/accept", nil); c != 400 || !strings.Contains(fmt.Sprint(b), "already been used") {
		t.Errorf("second use: %d %v", c, b)
	}
	if _, l, _ := h.do(h.alice, "GET", base+"/invitations", nil); len(l["invitations"].([]any)) != 0 {
		t.Errorf("a used invitation is still waiting: %v", l)
	}

	// a member can read and write but not manage the team
	if c, _, _ := h.do(good, "GET", base+"/requests", nil); c != 200 {
		t.Errorf("a member reading: %d", c)
	}
	for _, call := range [][3]any{{"POST", "/invitations", map[string]any{"email": "z@acme.com", "role": "member"}}, {"GET", "/invitations", nil}} {
		if c, _, _ := h.do(good, call[0].(string), base+call[1].(string), call[2]); c != 403 {
			t.Errorf("a member did %v: %d", call[:2], c)
		}
	}
	if c, _, _ := h.do(good, "PUT", base+"/members/"+h.aliceID.String(), map[string]any{"role": "viewer"}); c != 403 {
		t.Errorf("a member changed a role: %d", c)
	}
	if c, _, _ := h.do(good, "DELETE", base+"/members/"+h.aliceID.String(), nil); c != 403 {
		t.Errorf("a member removed the admin: %d", c)
	}
}

func TestRolesAndTheLastAdmin(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Roles Co")
	base := "/v1/workspaces/" + ws
	mate := uuid.New()
	h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'member')`, ws, mate)
	mateTok := "t:" + mate.String()
	alice := h.aliceID.String()

	// the only admin cannot be demoted or removed, not even by themselves
	for name, call := range map[string][2]string{"demote": {"PUT", "viewer"}, "leave": {"DELETE", ""}} {
		var body any
		if call[1] != "" {
			body = map[string]any{"role": call[1]}
		}
		if c, b, _ := h.do(h.alice, call[0], base+"/members/"+alice, body); c != 409 || !strings.Contains(fmt.Sprint(b), "at least one admin") {
			t.Errorf("the last admin %s: %d %v", name, c, b)
		}
	}
	// promote a teammate; now the first admin may step down
	if c, _, _ := h.do(h.alice, "PUT", base+"/members/"+mate.String(), map[string]any{"role": "admin"}); c != 204 {
		t.Fatalf("promote: %d", c)
	}
	if c, _, _ := h.do(h.alice, "PUT", base+"/members/"+alice, map[string]any{"role": "viewer"}); c != 204 {
		t.Errorf("demote with another admin: %d", c)
	}
	// alice is a viewer now: she cannot manage the team, but the new admin can
	if c, _, _ := h.do(h.alice, "PUT", base+"/members/"+mate.String(), map[string]any{"role": "member"}); c != 403 {
		t.Errorf("a viewer changed a role: %d", c)
	}
	if c, _, _ := h.do(mateTok, "PUT", base+"/members/"+alice, map[string]any{"role": "member"}); c != 204 {
		t.Errorf("the new admin: %d", c)
	}
	_, ms, _ := h.do(mateTok, "GET", base+"/members", nil)
	roles := map[string]string{}
	for _, m := range ms["members"].([]any) {
		roles[m.(map[string]any)["userId"].(string)] = m.(map[string]any)["role"].(string)
	}
	if roles[alice] != "member" || roles[mate.String()] != "admin" {
		t.Errorf("roles %v", roles)
	}
	// bad input and unknown people
	if c, _, _ := h.do(mateTok, "PUT", base+"/members/"+alice, map[string]any{"role": "owner"}); c != 400 {
		t.Errorf("an unknown role: %d", c)
	}
	if c, _, _ := h.do(mateTok, "PUT", base+"/members/"+uuid.NewString(), map[string]any{"role": "member"}); c != 404 {
		t.Errorf("an unknown person: %d", c)
	}
	// a member can leave; the admin cannot remove the workspace's last admin; another workspace's admin finds nothing
	if c, _, _ := h.do(h.alice, "DELETE", base+"/members/"+alice, nil); c != 204 {
		t.Errorf("leaving: %d", c)
	}
	if _, w, _ := h.do(h.alice, "GET", "/v1/workspaces", nil); len(w["workspaces"].([]any)) != 0 {
		t.Errorf("still a member: %v", w)
	}
	if c, _, _ := h.do(mateTok, "DELETE", base+"/members/"+mate.String(), nil); c != 409 {
		t.Errorf("the last admin leaving: %d", c)
	}
	if c, _, _ := h.do(h.bob, "DELETE", base+"/members/"+mate.String(), nil); c != 403 && c != 404 {
		t.Errorf("a stranger removed someone: %d", c)
	}
}

func TestInvitationsCanBeRevokedResentAndExpire(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Lifecycle Co")
	base := "/v1/workspaces/" + ws
	person := uuid.New()
	tok := asUser(person, "late@acme.com", true)

	invite := func() (string, string) {
		_, r, _ := h.do(h.alice, "POST", base+"/invitations", map[string]any{"email": "late@acme.com", "role": "viewer"})
		i := r["invitation"].(map[string]any)
		return i["id"].(string), strings.TrimPrefix(i["link"].(string), "https://app.example/invite/")
	}
	id, token := invite()
	// revoked: the link stops working
	if c, _, _ := h.do(h.alice, "DELETE", base+"/invitations/"+id, nil); c != 204 {
		t.Fatalf("revoke: %d", c)
	}
	if c, _, _ := h.do(h.alice, "DELETE", base+"/invitations/"+id, nil); c != 404 {
		t.Errorf("revoke twice: %d", c)
	}
	if _, p, _ := h.do(tok, "GET", "/v1/invitations/"+token, nil); p["state"] != "revoked" || p["canAccept"] != false {
		t.Errorf("revoked preview %v", p)
	}
	if c, _, _ := h.do(tok, "POST", "/v1/invitations/"+token+"/accept", nil); c != 404 {
		t.Errorf("revoked accept: %d", c)
	}
	// invited again: a fresh invitation, the old link stays dead
	id2, token2 := invite()
	if id2 == id || token2 == token {
		t.Error("a revoked invitation was revived")
	}
	// another workspace's admin cannot touch it
	if c, _, _ := h.do(h.bob, "DELETE", base+"/invitations/"+id2, nil); c != 403 && c != 404 {
		t.Errorf("a stranger revoked: %d", c)
	}
	if c, _, _ := h.do(h.alice, "POST", base+"/invitations/"+uuid.NewString()+"/resend", nil); c != 404 {
		t.Errorf("resend unknown: %d", c)
	}
	// expired: cannot be used, can be resent and then works
	h.db.Super.Exec(context.Background(), `UPDATE invitation SET expires_at = now() - interval '1 minute' WHERE id = $1`, id2)
	if _, p, _ := h.do(tok, "GET", "/v1/invitations/"+token2, nil); p["state"] != "expired" || p["canAccept"] != false {
		t.Errorf("expired preview %v", p)
	}
	if c, b, _ := h.do(tok, "POST", "/v1/invitations/"+token2+"/accept", nil); c != 400 || !strings.Contains(fmt.Sprint(b), "expired") {
		t.Errorf("expired accept: %d %v", c, b)
	}
	if c, _, _ := h.do(h.alice, "POST", base+"/invitations/"+id2+"/resend", nil); c != 200 {
		t.Fatalf("resend: %d", c)
	}
	if c, _, _ := h.do(tok, "POST", "/v1/invitations/"+token2+"/accept", nil); c != 200 {
		t.Errorf("accept after resend: %d", c)
	}
	_, w, _ := h.do(tok, "GET", "/v1/workspaces", nil)
	if l := w["workspaces"].([]any); len(l) != 1 || l[0].(map[string]any)["role"] != "viewer" {
		t.Errorf("workspaces %v", w)
	}
	// a viewer can read but not change
	if c, _, _ := h.do(tok, "POST", base+"/sources/paste", map[string]any{"text": "hello there"}); c != 403 {
		t.Errorf("a viewer pasted: %d", c)
	}
}
