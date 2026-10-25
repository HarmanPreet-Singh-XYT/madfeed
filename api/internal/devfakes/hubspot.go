package devfakes

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// HubSpot stands in for the parts of HubSpot's CRM API that the account-value sync reads: contacts by email,
// their companies, and deals. It holds a tiny world that tests set up through its fields.
type HubSpot struct {
	Mu sync.Mutex

	Token     string
	NoDeals   bool                 // the token lacks permission to read deals
	Contacts  map[string]HSContact // by lower-case email
	Companies map[string]HSCompany // by id
	Deals     []HSDeal
	Calls     []string
	Throttle  bool // answer 429
}

type HSContact struct {
	ID        string
	CompanyID string // primary company; empty for none
}

type HSCompany struct {
	ID, Name, Domain, AnnualRevenue string
}

type HSDeal struct {
	ID, CompanyID, Amount string
	Won                   bool
}

func NewHubSpot() *HubSpot {
	return &HubSpot{Token: "pat-na1-fake-token-0001", Contacts: map[string]HSContact{}, Companies: map[string]HSCompany{}}
}

func (f *HubSpot) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_dev/revoke", func(w http.ResponseWriter, r *http.Request) {
		f.Set(func() { f.Token += "-rotated" })
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/crm/", f.handle)
	return mux
}

func (f *HubSpot) Set(fn func()) { f.Mu.Lock(); fn(); f.Mu.Unlock() }

func (f *HubSpot) handle(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get("Authorization") != "Bearer "+f.Token {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"status":"error","category":"INVALID_AUTHENTICATION"}`))
		return
	}
	if f.Throttle {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	f.Calls = append(f.Calls, r.Method+" "+r.URL.Path)
	path := strings.TrimPrefix(r.URL.Path, "/crm/")
	raw, _ := io.ReadAll(r.Body)
	var body struct {
		IDProperty string `json:"idProperty"`
		Inputs     []struct {
			ID string `json:"id"`
		} `json:"inputs"`
	}
	_ = json.Unmarshal(raw, &body)
	enc := json.NewEncoder(w)
	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(path, "v3/objects/"):
		if f.NoDeals && strings.HasPrefix(path, "v3/objects/deals") {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"status":"error","category":"MISSING_SCOPES"}`))
			return
		}
		_ = enc.Encode(map[string]any{"results": []any{}})
	case path == "v3/objects/contacts/batch/read":
		res := []any{}
		for _, in := range body.Inputs {
			if c, ok := f.Contacts[strings.ToLower(in.ID)]; ok && body.IDProperty == "email" {
				res = append(res, map[string]any{"id": c.ID, "properties": map[string]string{"email": strings.ToLower(in.ID)}})
			}
		}
		_ = enc.Encode(map[string]any{"status": "COMPLETE", "results": res})
	case path == "v3/objects/companies/batch/read":
		res := []any{}
		for _, in := range body.Inputs {
			if c, ok := f.Companies[in.ID]; ok {
				res = append(res, map[string]any{"id": c.ID, "properties": map[string]string{"name": c.Name, "domain": c.Domain, "annualrevenue": c.AnnualRevenue}})
			}
		}
		_ = enc.Encode(map[string]any{"status": "COMPLETE", "results": res})
	case path == "v3/objects/deals/batch/read":
		res := []any{}
		for _, in := range body.Inputs {
			for _, d := range f.Deals {
				if d.ID == in.ID {
					res = append(res, map[string]any{"id": d.ID, "properties": map[string]string{"amount": d.Amount, "hs_is_closed_won": strconv.FormatBool(d.Won)}})
				}
			}
		}
		_ = enc.Encode(map[string]any{"status": "COMPLETE", "results": res})
	case path == "v4/associations/contacts/companies/batch/read":
		res := []any{}
		for _, in := range body.Inputs {
			for _, c := range f.Contacts {
				if c.ID == in.ID && c.CompanyID != "" {
					id, _ := strconv.ParseInt(c.CompanyID, 10, 64)
					res = append(res, map[string]any{"from": map[string]string{"id": in.ID}, "to": []any{map[string]any{
						"toObjectId": id, "associationTypes": []any{map[string]any{"category": "HUBSPOT_DEFINED", "typeId": 1, "label": "Primary"}}}}})
				}
			}
		}
		_ = enc.Encode(map[string]any{"status": "COMPLETE", "results": res})
	case path == "v4/associations/companies/deals/batch/read":
		res := []any{}
		for _, in := range body.Inputs {
			var to []any
			for _, d := range f.Deals {
				if d.CompanyID == in.ID {
					id, _ := strconv.ParseInt(d.ID, 10, 64)
					to = append(to, map[string]any{"toObjectId": id, "associationTypes": []any{map[string]any{"category": "HUBSPOT_DEFINED", "typeId": 342, "label": ""}}})
				}
			}
			if to != nil {
				res = append(res, map[string]any{"from": map[string]string{"id": in.ID}, "to": to})
			}
		}
		_ = enc.Encode(map[string]any{"status": "COMPLETE", "results": res})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// Writes counts calls that could have changed something in HubSpot: there must never be any.
func (f *HubSpot) Writes() int {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	n := 0
	for _, c := range f.Calls {
		if strings.HasPrefix(c, "PUT ") || strings.HasPrefix(c, "DELETE ") || strings.HasPrefix(c, "PATCH ") || (strings.HasPrefix(c, "POST ") && !strings.HasSuffix(c, "/batch/read")) {
			n++
		}
	}
	return n
}
