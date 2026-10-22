package resend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"product/api/internal/email"
)

func msg() email.Message {
	return email.Message{From: "Team <hi@example.test>", To: []string{"a@example.test"}, Subject: "s", Text: "t", IdempotencyKey: "msg-1",
		Tags: map[string]string{"outreach_message_id": "m1"}}
}

func TestSendsExpectedRequest(t *testing.T) {
	var got struct {
		auth, idem, path string
		body             map[string]any
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.auth, got.idem, got.path = r.Header.Get("Authorization"), r.Header.Get("Idempotency-Key"), r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&got.body)
		_, _ = w.Write([]byte(`{"id":"re_123"}`))
	}))
	defer srv.Close()
	c, _ := New("key", srv.URL)
	id, err := c.Send(context.Background(), msg())
	if err != nil || id != "re_123" {
		t.Fatalf("id=%q err=%v", id, err)
	}
	if got.auth != "Bearer key" || got.idem != "msg-1" || got.path != "/emails" || got.body["subject"] != "s" {
		t.Fatalf("bad request: %+v", got)
	}
}

func TestErrorClassification(t *testing.T) {
	for status, want := range map[int]error{429: email.ErrTransient, 500: email.ErrTransient, 503: email.ErrTransient,
		400: email.ErrPermanent, 401: email.ErrPermanent, 403: email.ErrPermanent, 422: email.ErrPermanent} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"message":"to a@example.test failed"}`))
		}))
		c, _ := New("k", srv.URL)
		_, err := c.Send(context.Background(), msg())
		srv.Close()
		if !errors.Is(err, want) {
			t.Errorf("status %d: got %v want %v", status, err, want)
		}
		if err != nil && strings.Contains(err.Error(), "a@example.test") {
			t.Errorf("status %d: error leaks recipient: %v", status, err)
		}
	}
}

func TestNetworkFailureIsTransient(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	c, _ := New("k", url)
	if _, err := c.Send(context.Background(), msg()); !errors.Is(err, email.ErrTransient) {
		t.Fatalf("got %v", err)
	}
}

func TestRejectsIncompleteMessagesBeforeAnyRequest(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer srv.Close()
	c, _ := New("k", srv.URL)
	for name, mut := range map[string]func(*email.Message){
		"no recipient": func(m *email.Message) { m.To = nil },
		"no body":      func(m *email.Message) { m.Text = "" },
		"no idem key":  func(m *email.Message) { m.IdempotencyKey = "" },
	} {
		m := msg()
		mut(&m)
		if _, err := c.Send(context.Background(), m); !errors.Is(err, email.ErrPermanent) {
			t.Errorf("%s: got %v", name, err)
		}
	}
	if called {
		t.Fatal("request sent for invalid message")
	}
	if _, err := New("", ""); err == nil {
		t.Fatal("empty key accepted")
	}
}
