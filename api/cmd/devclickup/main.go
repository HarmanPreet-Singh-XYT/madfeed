// Command devclickup is a local stand-in for ClickUp, for development and the browser tests only.
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
	addr := "127.0.0.1:9990"
	if v := os.Getenv("DEV_ADDR"); v != "" {
		addr = v
	}
	fmt.Printf("devclickup on http://%s (local development only)\n", addr)
	h := devfakes.NewClickUp().Handler().(*http.ServeMux)
	h.HandleFunc("/_dev/ping", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	log.Fatal((&http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
