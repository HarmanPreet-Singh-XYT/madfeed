package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Runs the real program over standard input and output, the way a desktop assistant does.
func TestTheProgramSpeaksMCPOverStdio(t *testing.T) {
	var gotAuth string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"requests":[{"id":"11111111-1111-1111-1111-111111111111","title":"Single sign-on","status":{"name":"New"},"impact":{"evidenceCount":2,"peopleCount":2,"accountCount":1,"totalValue":"100000.00"}}]}`))
	}))
	defer api.Close()

	bin := filepath.Join(t.TempDir(), "mcp")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	key := "fk_" + strings.Repeat("a", 43)

	// without settings it refuses to start, and says what is missing
	bare := exec.Command(bin)
	bare.Env = []string{}
	if out, err := bare.CombinedOutput(); err == nil || !strings.Contains(string(out), "FEEDBACK_API_KEY") {
		t.Errorf("started without settings: %v %s", err, out)
	}

	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(), "FEEDBACK_API_URL="+api.URL, "FEEDBACK_API_KEY="+key)
	in, _ := cmd.StdinPipe()
	outp, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = in.Close(); _ = cmd.Wait() }()
	rd := bufio.NewReader(outp)
	send := func(v any) {
		b, _ := json.Marshal(v)
		_, _ = in.Write(append(b, '\n'))
	}
	read := func() map[string]any {
		done := make(chan map[string]any, 1)
		go func() {
			for {
				line, err := rd.ReadString('\n')
				if err != nil {
					done <- nil
					return
				}
				var m map[string]any
				if json.Unmarshal([]byte(line), &m) == nil && m["id"] != nil {
					done <- m
					return
				}
			}
		}()
		select {
		case m := <-done:
			return m
		case <-time.After(20 * time.Second):
			t.Fatal("no answer from the program")
			return nil
		}
	}
	send(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{
		"protocolVersion": "2025-06-18", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "t", "version": "1"}}})
	if r := read(); r["result"] == nil {
		t.Fatalf("initialize: %v", r)
	}
	send(map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	send(map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
	list := read()
	if !strings.Contains(toJSON(list), "search_requests") || !strings.Contains(toJSON(list), "ask_feedback") {
		t.Fatalf("tools/list: %v", list)
	}
	send(map[string]any{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": map[string]any{"name": "search_requests", "arguments": map[string]any{}}})
	call := read()
	if !strings.Contains(toJSON(call), "Single sign-on") || !strings.Contains(toJSON(call), "100000.00") {
		t.Errorf("tools/call: %v", call)
	}
	if gotAuth != "Bearer "+key {
		t.Errorf("the API saw %q", gotAuth)
	}
}

func toJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
