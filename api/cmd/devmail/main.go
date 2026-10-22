// Command devmail is a LOCAL DEVELOPMENT stand-in for the email provider. It
// accepts the same POST /emails requests, honours the Idempotency-Key header
// (a repeated key delivers nothing new), and lets tests read what "arrived":
//
//	go run ./cmd/devmail                       # listens on 127.0.0.1:9998
//	curl localhost:9998/outbox                 # everything delivered
//	curl -X DELETE localhost:9998/outbox       # start fresh
//
// Point the worker at it with RESEND_BASE_URL=http://127.0.0.1:9998 and any
// RESEND_API_KEY. It refuses to run outside development and never sends real
// email.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const addr = "127.0.0.1:9998"

type delivered struct {
	ID             string            `json:"id"`
	IdempotencyKey string            `json:"idempotencyKey"`
	At             time.Time         `json:"at"`
	From           string            `json:"from"`
	To             []string          `json:"to"`
	Subject        string            `json:"subject"`
	Text           string            `json:"text"`
	Headers        map[string]string `json:"headers"`
}

func main() {
	if env := os.Getenv("APP_ENV"); env != "" && env != "development" {
		log.Fatal("devmail is for local development only")
	}
	var mu sync.Mutex
	var box []delivered
	byKey := map[string]string{}

	mux := http.NewServeMux()
	mux.HandleFunc("/emails", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			http.Error(w, `{"message":"missing api key"}`, http.StatusUnauthorized)
			return
		}
		var in struct {
			From    string            `json:"from"`
			To      []string          `json:"to"`
			Subject string            `json:"subject"`
			Text    string            `json:"text"`
			Headers map[string]string `json:"headers"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil || len(in.To) == 0 || in.From == "" || in.Subject == "" {
			http.Error(w, `{"message":"invalid email"}`, http.StatusUnprocessableEntity)
			return
		}
		key := r.Header.Get("Idempotency-Key")
		mu.Lock()
		defer mu.Unlock()
		id, seen := byKey[key]
		if !seen || key == "" {
			id = fmt.Sprintf("dev_%d", len(box)+1)
			box = append(box, delivered{ID: id, IdempotencyKey: key, At: time.Now(), From: in.From, To: in.To, Subject: in.Subject, Text: in.Text, Headers: in.Headers})
			if key != "" {
				byKey[key] = id
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
	})
	mux.HandleFunc("/outbox", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodDelete {
			box, byKey = nil, map[string]string{}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(box)
	})
	fmt.Printf("devmail on http://%s  (POST /emails, GET /outbox)\n", addr)
	log.Fatal((&http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
