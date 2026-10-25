// Command devsalesforce is a local stand-in for Salesforce, for development and the browser tests only. It knows
// one contact, dana@sf-e2e.test, who works at "SF E2E Corp".
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
	addr := "127.0.0.1:9987"
	if v := os.Getenv("DEV_ADDR"); v != "" {
		addr = v
	}
	f := devfakes.NewSalesforce()
	f.Contacts["dana@sf-e2e.test"] = "0010000000000E2EAA"
	f.Accounts["0010000000000E2EAA"] = devfakes.SFAccount{ID: "0010000000000E2EAA", Name: "SF E2E Corp", Website: "https://sf-e2e-corp.test", AnnualRevenue: 640000}
	fmt.Printf("devsalesforce on http://%s (local development only)\n", addr)
	h := f.Handler().(*http.ServeMux)
	h.HandleFunc("/_dev/ping", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	log.Fatal((&http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
