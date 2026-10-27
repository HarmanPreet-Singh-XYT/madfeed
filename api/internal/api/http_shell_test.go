package api

import (
	"reflect"
	"testing"
)

func TestTheShellAnswersWhatTheNavigationNeedsInOneCallAndStrangersLearnNothing(t *testing.T) {
	e := newBillEnv(t)
	h := e.h
	ws := "/v1/workspaces/" + e.ws

	code, shell, _ := h.do(h.alice, "GET", ws+"/shell", nil)
	if code != 200 {
		t.Fatalf("shell: %d %v", code, shell)
	}
	if w, _ := shell["workspace"].(map[string]any); w["id"] != e.ws || w["name"] == "" {
		t.Errorf("workspace = %v", shell["workspace"])
	}
	for _, k := range []string{"waitingProposals", "openOutreach"} {
		if n, ok := shell[k].(float64); !ok || n != 0 {
			t.Errorf("%s = %v, want 0 on an empty workspace", k, shell[k])
		}
	}
	if n, ok := shell["notices"].([]any); !ok || len(n) != 0 {
		t.Errorf("notices = %v, want an empty list (not null)", shell["notices"])
	}

	// What it says about the caller is exactly what /access says.
	_, access, _ := h.do(h.alice, "GET", ws+"/access", nil)
	for _, k := range []string{"role", "permissions", "modules"} {
		if !reflect.DeepEqual(shell[k], access[k]) {
			t.Errorf("%s: shell %v, access %v", k, shell[k], access[k])
		}
	}

	if code, _, _ := h.do(h.bob, "GET", ws+"/shell", nil); code != 404 {
		t.Errorf("a stranger got %d, want 404", code)
	}
}
