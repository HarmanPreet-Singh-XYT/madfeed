package api

import (
	"testing"
	"time"

	"product/api/internal/integrations"
)

func TestAServiceThatIsSwitchedOffIsHiddenAndKeepsWhatWasStored(t *testing.T) {
	e := newLinEnv(t, true) // Linear connected
	h := e.h
	on := func(v string) {
		m, err := integrations.ParseEnabled(v)
		if err != nil {
			t.Fatal(err)
		}
		h.srv.Integrations.Enabled = m
	}
	listed := func() []any {
		_, b, _ := h.do(h.alice, "GET", "/v1/workspaces/"+e.ws+"/integrations", nil)
		return b["enabledKinds"].([]any)
	}
	if len(listed()) != len(integrations.Kinds) {
		t.Fatalf("everything should start on: %v", listed())
	}

	on("slack,github")
	if l := listed(); len(l) != 2 {
		t.Errorf("enabled kinds %v", l)
	}
	base := "/v1/workspaces/" + e.ws + "/integrations"
	for _, c := range []struct {
		method, path string
		body         map[string]any
	}{
		{"GET", "/linear/details", nil}, {"POST", "/linear/connect", map[string]any{"token": "lin_api_whatever_value", "teamKey": "ENG"}},
		{"PUT", "/linear/secret", map[string]any{"secret": "long-enough-secret"}}, {"PUT", "/linear/mapping", map[string]any{}}, {"POST", "/linear/check", nil},
		{"GET", "/jira/details", nil}, {"POST", "/jira/connect", map[string]any{"site": "acme", "email": "a@b.co", "token": "jira_api_token_xxx", "project": "PROJ"}},
		{"PUT", "/jira/mapping", map[string]any{}}, {"POST", "/jira/check", nil},
		{"GET", "/hubspot/details", nil}, {"POST", "/hubspot/connect", map[string]any{"token": "pat-na1-whatever-1", "valueFrom": "revenue"}}, {"POST", "/hubspot/sync", nil},
	} {
		if code, _, _ := h.do(h.alice, c.method, base+c.path, c.body); code != 404 {
			t.Errorf("%s %s while off: %d", c.method, c.path, code)
		}
	}
	// its notifications are not accepted either, even with a good signature
	now := time.Now()
	if code, _ := e.deliver(e.secret, "off1", now, linIssue("ENG", 1, "update", "completed", now)); code != 404 {
		t.Errorf("a notification while off: %d", code)
	}
	// a stored connection cannot open issues while off
	if code, _, _ := h.do(h.alice, "POST", e.issueURL(), nil); code != 404 {
		t.Errorf("an issue while off: %d", code)
	}

	// switched back on: what was stored is still there
	on("slack,github,linear")
	if code, d, _ := h.do(h.alice, "GET", base+"/linear/details", nil); code != 200 || d["teamKey"] != "ENG" {
		t.Errorf("after switching on: %d %v", code, d)
	}
	if code, _, _ := h.do(h.alice, "POST", e.issueURL(), nil); code != 201 {
		t.Errorf("an issue after switching on: %d", code)
	}
}
