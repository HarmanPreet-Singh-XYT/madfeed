package api

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Drives personal data through many routes (successes and failures) and then
// reads the server's logs: they may hold ids, methods, paths and statuses, but
// never what people wrote, their addresses, names, secrets or tokens.
func TestTheLogsNeverHoldPersonalDataSecretsOrTokens(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Secret Corp Workspace")
	base := "/v1/workspaces/" + ws
	secretText := "Zelda Quimby of Initech-Zeta said: our card 4111 1111 1111 1111 failed and key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 leaked, mail zelda.quimby@initech-zeta.example"

	h.do(h.alice, "POST", base+"/people/import", map[string]any{"csv": "Name,Email,Company,ARR\nZelda Quimby,zelda.quimby@initech-zeta.example,Initech-Zeta,\"$987,654\"\n"})
	h.do(h.alice, "POST", base+"/sources/paste", map[string]any{"text": secretText + " " + uuid.NewString()})
	h.do(h.alice, "POST", base+"/tags", map[string]any{"name": "Quimby-private-tag", "definition": "Zelda only"})
	h.do(h.alice, "POST", base+"/qa", map[string]any{"question": "What did Zelda Quimby say about initech-zeta?"})
	h.do(h.alice, "POST", base+"/views", map[string]any{"name": "Zelda view", "q": "quimby"})
	h.do(h.alice, "PUT", base+"/settings", map[string]any{"publicSlug": "zeta-public", "senderName": "Zelda from Initech"})
	// failures and attacks
	h.do(h.alice, "POST", base+"/sources/paste", map[string]any{"text": ""})
	h.do(h.alice, "POST", base+"/tags", `{"name": "bad json`)
	h.do("Bearer-secret-token-abc123", "GET", base+"/tags", nil)
	h.do("t:"+uuid.NewString(), "GET", base+"/tags", nil)
	// the public paths with a (forged and a real) unsubscribe token
	forged := h.unsub.Token(uuid.MustParse(ws), uuid.New())
	h.do("", "GET", "/v1/public/unsubscribe/"+forged, nil)
	h.do("", "POST", "/v1/public/unsubscribe/"+forged, nil)
	h.do("", "GET", "/v1/public/releases/zeta-public", nil)

	logs := h.logs.String()
	if len(logs) < 200 {
		t.Fatalf("the access log is suspiciously empty (%d bytes); the test would prove nothing", len(logs))
	}
	for _, leak := range []string{
		"Zelda", "Quimby", "quimby", "Initech", "initech", "zelda.quimby", "@initech", "987,654", "Secret Corp",
		"4111", "sk-proj", "AbCdEf", "Bearer-secret", "Bearer ",
		forged, "Authorization", "eyJ", "tag-private", "Zelda from",
	} {
		if strings.Contains(logs, leak) {
			i := strings.Index(logs, leak)
			t.Errorf("the logs contain %q: ...%s...", leak, logs[max(0, i-60):min(len(logs), i+80)])
		}
	}
	if !strings.Contains(logs, "/v1/public/unsubscribe/{token}") {
		t.Errorf("the unsubscribe path should be logged with its token hidden")
	}
}
