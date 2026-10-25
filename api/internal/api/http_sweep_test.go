package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/google/uuid"
)

// operation is one method on one path of the contract.
type operation struct{ method, path string }

func (o operation) String() string { return o.method + " " + o.path }

// operations lists everything the API promises, straight from the contract, so
// a route added tomorrow is covered tomorrow without anyone remembering to.
func operations(t *testing.T) []operation {
	t.Helper()
	spec, err := GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	var out []operation
	for path, item := range spec.Paths.Map() {
		for method := range item.Operations() {
			out = append(out, operation{method, path})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out
}

func isPublic(o operation) bool {
	return o.path == "/healthz" || o.path == "/readyz" || strings.HasPrefix(o.path, "/v1/public/")
}

func workspaceScoped(o operation) bool { return strings.Contains(o.path, "{workspaceId}") }

// fill puts a real workspace id and fresh random ids into a path template.
func fill(path, ws string) string {
	var b strings.Builder
	for i := 0; i < len(path); {
		if path[i] != '{' {
			b.WriteByte(path[i])
			i++
			continue
		}
		j := strings.IndexByte(path[i:], '}') + i
		if path[i+1:j] == "workspaceId" {
			b.WriteString(ws)
		} else if path[i+1:j] == "kind" { // a connection kind, a fixed list
			b.WriteString("slack")
		} else if path[i+1:j] == "trackerKind" {
			b.WriteString("clickup")
		} else if path[i+1:j] == "quoteKind" {
			b.WriteString("evidence")
		} else {
			b.WriteString(uuid.NewString())
		}
		i = j + 1
	}
	return b.String()
}

// sample builds the smallest value the contract accepts for a schema, so a
// request reaches the handler's own checks (role, tenant) instead of being
// turned away for its shape.
func sample(ref *openapi3.SchemaRef, depth int) any {
	if ref == nil || ref.Value == nil || depth > 6 {
		return nil
	}
	s := ref.Value
	if len(s.Enum) > 0 {
		return s.Enum[0]
	}
	if len(s.AllOf) > 0 {
		return sample(s.AllOf[0], depth+1)
	}
	switch {
	case s.Type.Is("object"):
		out := map[string]any{}
		for _, name := range s.Required {
			out[name] = sample(s.Properties[name], depth+1)
		}
		return out
	case s.Type.Is("array"):
		return []any{}
	case s.Type.Is("integer"):
		n := int64(1)
		if s.Min != nil && *s.Min > 1 {
			n = int64(*s.Min)
		}
		return n
	case s.Type.Is("number"):
		return 1.0
	case s.Type.Is("boolean"):
		return false
	}
	switch s.Format {
	case "uuid":
		return uuid.NewString()
	case "date-time":
		return time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	case "date":
		return "2026-12-31"
	case "uri":
		return "https://example.com"
	}
	n := int(s.MinLength)
	if n < 1 {
		n = 1
	}
	if s.MaxLength != nil && n > int(*s.MaxLength) {
		n = int(*s.MaxLength)
	}
	return strings.Repeat("a", n)
}

// request describes how to call an operation with a valid-looking request.
func request(t *testing.T, o operation, ws string) (path string, body any, binary bool) {
	t.Helper()
	spec, err := GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	op := spec.Paths.Find(o.path).GetOperation(o.method)
	path = fill(o.path, ws)
	var query []string
	for _, p := range op.Parameters {
		if p.Value != nil && p.Value.In == "query" && p.Value.Required {
			v := sample(p.Value.Schema, 0)
			if p.Value.Name == "offset" {
				v = 0
			}
			query = append(query, fmt.Sprintf("%s=%v", p.Value.Name, v))
		}
	}
	if len(query) > 0 {
		path += "?" + strings.Join(query, "&")
	}
	if op.RequestBody != nil && op.RequestBody.Value != nil {
		if mt := op.RequestBody.Value.Content.Get("application/json"); mt != nil {
			body = sample(mt.Schema, 0)
		} else if op.RequestBody.Value.Content.Get("application/octet-stream") != nil {
			binary = true
		}
	}
	return
}

func (hn *harness) call(token string, o operation, ws string) int {
	hn.t.Helper()
	path, body, binary := request(hn.t, o, ws)
	if binary {
		code, _, _ := hn.raw(token, o.method, path, []byte("ID3x"), map[string]string{"Content-Type": "application/octet-stream"})
		return code
	}
	code, _, _ := hn.do(token, o.method, path, body)
	return code
}

func TestEveryWorkspaceRouteRefusesAnonymousCallersAndStrangers(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Sweep")
	ops := operations(t)
	covered := 0
	for _, o := range ops {
		if isPublic(o) || !workspaceScoped(o) {
			continue
		}
		covered++
		// Not signed in: always 401, whatever the route.
		if code := h.call("", o, ws); code != 401 {
			t.Errorf("%s without sign-in: %d, want 401", o, code)
		}
		// Signed in but not a member: the workspace must look like it does not exist. 404 (or 400 when the
		// contract rejects the request shape first); never 2xx, never 403 (which would confirm it exists), never 5xx.
		if code := h.call(h.bob, o, ws); code != 404 && code != 400 {
			t.Errorf("%s as a stranger: %d, want 404 or 400", o, code)
		}
	}
	if covered < 60 {
		t.Fatalf("the sweep only saw %d workspace routes; the contract reader is broken", covered)
	}
	t.Logf("swept %d workspace routes", covered)
}

func TestViewersCannotChangeAnythingOnAnyRoute(t *testing.T) {
	h := newHarness(t)
	ws := h.workspace(h.alice, "Roles")
	bobID := uuid.MustParse(strings.TrimPrefix(h.bob, "t:"))
	if _, err := h.db.Super.Exec(context.Background(), `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'viewer')`, ws, bobID); err != nil {
		t.Fatal(err)
	}
	// Reading routes a viewer may use even though they POST (they search or ask; nothing is changed for others).
	allowedPOST := map[string]bool{
		"POST /v1/workspaces/{workspaceId}/qa":                                  true, // asking a question
		"POST /v1/workspaces/{workspaceId}/people/import/preview":               true, // previews write nothing
		"POST /v1/workspaces/{workspaceId}/surveys/{surveyId}/audience/preview": true, // a preview picks people and writes nothing
		"PUT /v1/workspaces/{workspaceId}/qa/{answerId}/rating":                 true, // rating your own answer; covered in internal/research
	}
	checked := 0
	tally := map[int]int{}
	var unproven []string
	for _, o := range operations(t) {
		if isPublic(o) || !workspaceScoped(o) || o.method == http.MethodGet {
			continue
		}
		if allowedPOST[o.String()] {
			continue
		}
		checked++
		code := h.call(h.bob, o, ws)
		tally[code]++
		if code != 403 {
			unproven = append(unproven, fmt.Sprintf("%d %s", code, o))
		}
		// 403 (not allowed) is right; 400 means the contract refused the shape first; 404 means the target
		// does not exist. 2xx would mean a viewer changed something; 5xx would mean we crashed.
		if code >= 200 && code < 300 || code >= 500 {
			t.Errorf("%s as a viewer: %d", o, code)
		}
	}
	if checked < 30 {
		t.Fatalf("only %d mutating routes were checked", checked)
	}
	t.Logf("checked %d mutating routes as a viewer: %v", checked, tally)
	// With a valid-looking request the role check is what answers; anything else needs a human reason.
	for _, u := range unproven {
		t.Errorf("a viewer was not refused with 403: %s", u)
	}
}

func TestEveryRouteIsEitherSignedInOrDeliberatelyPublic(t *testing.T) {
	spec, err := GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	var open []string
	for _, o := range operations(t) {
		if isPublic(o) {
			open = append(open, o.String())
			continue
		}
		op := spec.Paths.Find(o.path).GetOperation(o.method)
		secured := op.Security != nil && len(*op.Security) > 0
		if !secured && len(spec.Security) == 0 {
			t.Errorf("%s has no security requirement", o)
		}
	}
	// Deliberately open routes, reviewed one by one. Adding a public route means editing this list.
	want := []string{
		"GET /healthz", "GET /readyz",
		"GET /v1/public/releases/{slug}", "GET /v1/public/releases/{slug}/{noteId}",
		"GET /v1/public/unsubscribe/{token}", "POST /v1/public/unsubscribe/{token}",
		"GET /v1/public/sites/{slug}/roadmap", "POST /v1/public/sites/{slug}/feedback",
		"POST /v1/public/sites/{slug}/signed/votes", "POST /v1/public/sites/{slug}/requests/{requestId}/signed-vote",
		"GET /v1/public/digest/unsubscribe/{token}", "POST /v1/public/digest/unsubscribe/{token}",
		"GET /v1/public/surveys/{token}", "POST /v1/public/surveys/{token}/answers",
		"GET /v1/public/findings/{token}",
		"GET /v1/public/chat/{token}/config", "GET /v1/public/chat/{token}/messages", "POST /v1/public/chat/{token}/messages",
		"POST /v1/public/chat/{token}/attachments", "GET /v1/public/chat/{token}/attachments/{attachmentId}",
	}
	sort.Strings(open)
	sort.Strings(want)
	if fmt.Sprint(open) != fmt.Sprint(want) {
		t.Errorf("the set of public routes changed:\n got %v\nwant %v", open, want)
	}
}
