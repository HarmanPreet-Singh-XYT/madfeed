// Command devslack is a local stand-in for Slack, for development and the browser tests only.
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
	addr := "127.0.0.1:9994"
	if v := os.Getenv("DEV_ADDR"); v != "" {
		addr = v
	}
	fmt.Printf("devslack on http://%s (local development only)\n", addr)
	log.Fatal((&http.Server{Addr: addr, Handler: devfakes.NewSlack().Handler(), ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
