// Command devgithub is a local stand-in for GitHub, for development and the browser tests only.
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
	addr := "127.0.0.1:9995"
	if v := os.Getenv("DEV_ADDR"); v != "" {
		addr = v
	}
	fmt.Printf("devgithub on http://%s (local development only)\n", addr)
	log.Fatal((&http.Server{Addr: addr, Handler: devfakes.NewGitHub().Handler(), ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
