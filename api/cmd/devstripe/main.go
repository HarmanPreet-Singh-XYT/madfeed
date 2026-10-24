// Command devstripe is a local stand-in for Stripe, for development and the browser tests only. Its checkout
// page "pays" at once by sending the server the signed notifications Stripe would send
// (WEBHOOK_URL and WEBHOOK_SECRET), then returns the person to the app.
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"product/api/internal/devfakes"
)

func main() {
	addr := "127.0.0.1:9996"
	if v := os.Getenv("DEV_ADDR"); v != "" {
		addr = v
	}
	f := devfakes.NewStripe()
	f.WebhookURL, f.WebhookSecret = os.Getenv("WEBHOOK_URL"), os.Getenv("WEBHOOK_SECRET")
	if k := os.Getenv("STRIPE_KEY"); k != "" {
		f.Key = k
	}
	fmt.Printf("devstripe on http://%s (local development only)\n", addr)
	log.Fatal((&http.Server{Addr: addr, Handler: f.Handler(), ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
