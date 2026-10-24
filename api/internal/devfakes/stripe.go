package devfakes

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Stripe stands in for Stripe's API (customers, checkout, the billing portal, subscriptions). In the browser
// tests its checkout page "pays" by sending the real server the same signed notifications Stripe would, then
// sends the person back.
type Stripe struct {
	Mu sync.Mutex

	Key       string
	Customers map[string]map[string]string // id -> metadata
	Sessions  []map[string]string          // what checkout sessions were asked for
	Portals   int
	Subs      map[string]string // subscription id -> JSON as Stripe now has it

	// When set, visiting a checkout page sends these notifications to the server.
	WebhookURL, WebhookSecret string

	prefix string
	next   int
	paid   map[string]bool
}

func NewStripe() *Stripe {
	return &Stripe{Key: "sk_test_fake_key_0001", Customers: map[string]map[string]string{}, Subs: map[string]string{}, prefix: uuid.NewString()[:8], paid: map[string]bool{}}
}

func (f *Stripe) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/c/pay/", f.pay)
	mux.HandleFunc("/p/session/", f.portal)
	mux.HandleFunc("/", f.api)
	return mux
}

func (f *Stripe) api(w http.ResponseWriter, r *http.Request) {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") != f.Key {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"Invalid API Key provided"}}`))
		return
	}
	_ = r.ParseForm()
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/customers":
		f.next++
		id := fmt.Sprintf("cus_%s%04d", f.prefix, f.next)
		f.Customers[id] = map[string]string{"workspace_id": r.Form.Get("metadata[workspace_id]")}
		_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%q,"object":"customer"}`, id)))
	case r.Method == http.MethodPost && r.URL.Path == "/v1/checkout/sessions":
		f.next++
		id := fmt.Sprintf("cs_test_%s%d", f.prefix, f.next)
		f.Sessions = append(f.Sessions, map[string]string{
			"id": id, "mode": r.Form.Get("mode"), "price": r.Form.Get("line_items[0][price]"), "customer": r.Form.Get("customer"),
			"client_reference_id": r.Form.Get("client_reference_id"), "success_url": r.Form.Get("success_url"), "cancel_url": r.Form.Get("cancel_url"),
		})
		_, _ = w.Write([]byte(fmt.Sprintf(`{"id":%q,"object":"checkout.session","url":"http://%s/c/pay/%s"}`, id, hostOf(r), id)))
	case r.Method == http.MethodPost && r.URL.Path == "/v1/billing_portal/sessions":
		f.Portals++
		f.next++
		_, _ = w.Write([]byte(fmt.Sprintf(`{"id":"bps_%d","object":"billing_portal.session","url":"http://%s/p/session/%s?return=%s"}`, f.next, hostOf(r), uuid.NewString()[:8], url.QueryEscape(r.Form.Get("return_url")))))
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
		id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
		if body, ok := f.Subs[id]; ok {
			_, _ = w.Write([]byte(body))
			return
		}
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription"}}`))
	default:
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"unknown"}}`))
	}
}

// hostOf is the address the caller used, so the pages we hand out can be reached the same way.
func hostOf(r *http.Request) string {
	return r.Host
}

// pay is Stripe's checkout page. The stand-in pays at once.
func (f *Stripe) pay(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/c/pay/")
	f.Mu.Lock()
	var sess map[string]string
	for _, s := range f.Sessions {
		if s["id"] == id {
			sess = s
		}
	}
	already := f.paid[id]
	f.paid[id] = true
	f.Mu.Unlock()
	if sess == nil {
		http.NotFound(w, r)
		return
	}
	if !already && f.WebhookURL != "" {
		subID := "sub_" + uuid.NewString()[:8]
		end := time.Now().Add(30 * 24 * time.Hour)
		sub := f.SubJSON(subID, sess["customer"], "active", sess["price"], false, end)
		f.Mu.Lock()
		f.Subs[subID] = sub
		f.Mu.Unlock()
		f.Send("evt_cs_"+uuid.NewString(), "checkout.session.completed", time.Now(), fmt.Sprintf(`{"id":%q,"customer":%q,"subscription":%q,"client_reference_id":%q,"mode":"subscription"}`, id, sess["customer"], subID, sess["client_reference_id"]))
		f.Send("evt_sub_"+uuid.NewString(), "customer.subscription.created", time.Now().Add(time.Second), sub)
	}
	http.Redirect(w, r, sess["success_url"], http.StatusFound)
}

func (f *Stripe) portal(w http.ResponseWriter, r *http.Request) {
	back := r.URL.Query().Get("return")
	w.Header().Set("Content-Type", "text/html")
	_, _ = w.Write([]byte(`<!doctype html><title>Billing portal (stand-in)</title><h1>Billing portal (stand-in)</h1><a href="` + back + `">Return to the app</a>`))
}

// SubJSON is a subscription as Stripe describes it.
func (f *Stripe) SubJSON(id, customer, status, price string, cancelAtEnd bool, periodEnd time.Time) string {
	return fmt.Sprintf(`{"id":%q,"object":"subscription","customer":%q,"status":%q,"cancel_at_period_end":%v,"current_period_end":%d,"items":{"object":"list","data":[{"id":"si_1","price":{"id":%q},"current_period_end":%d}]}}`,
		id, customer, status, cancelAtEnd, periodEnd.Unix(), price, periodEnd.Unix())
}

// SignedEvent builds a notification the way Stripe signs it.
func SignedEvent(secret, id, typ string, created time.Time, object string) (payload []byte, header string) {
	payload = []byte(fmt.Sprintf(`{"id":%q,"object":"event","api_version":"2024-06-20","created":%d,"type":%q,"livemode":false,"data":{"object":%s}}`, id, created.Unix(), typ, object))
	return payload, SignatureHeader(secret, payload, time.Now())
}

func SignatureHeader(secret string, payload []byte, at time.Time) string {
	ts := strconv.FormatInt(at.Unix(), 10)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(ts + "." + string(payload)))
	return "t=" + ts + ",v1=" + hex.EncodeToString(m.Sum(nil))
}

// Send posts a signed notification to the configured address.
func (f *Stripe) Send(id, typ string, created time.Time, object string) {
	payload, hdr := SignedEvent(f.WebhookSecret, id, typ, created, object)
	req, err := http.NewRequest(http.MethodPost, f.WebhookURL, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Stripe-Signature", hdr)
	if res, err := http.DefaultClient.Do(req); err == nil {
		_ = res.Body.Close()
	}
}

func (f *Stripe) SetSub(id, body string) { f.Mu.Lock(); f.Subs[id] = body; f.Mu.Unlock() }
func (f *Stripe) CustomerCount() int     { f.Mu.Lock(); defer f.Mu.Unlock(); return len(f.Customers) }
func (f *Stripe) LastSession() map[string]string {
	f.Mu.Lock()
	defer f.Mu.Unlock()
	if len(f.Sessions) == 0 {
		return nil
	}
	return f.Sessions[len(f.Sessions)-1]
}
