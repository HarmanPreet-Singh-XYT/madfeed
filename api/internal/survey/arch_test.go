package survey

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Survey invitations are mail to customers. Only worker.go may talk to the email provider, and the SQL that
// lets an invitation go out must insist on a person's approval and an open survey. If either changes, this
// fails and a person has to look.
func TestOnlyTheApprovalCheckedWorkerSendsInvitations(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fset, f, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range parsed.Imports {
			p := strings.Trim(imp.Path.Value, `"`)
			if (p == "product/api/internal/email" || p == "product/api/internal/email/resend") && f != "worker.go" {
				t.Errorf("%s imports %s: only worker.go may send", f, p)
			}
			if p == "product/api/internal/media" || p == "product/api/internal/review" {
				t.Errorf("%s imports %s: surveys must not reach into unrelated customer data paths", f, p)
			}
		}
	}
	q, err := os.ReadFile("../store/queries/survey.sql")
	if err != nil {
		t.Fatal(err)
	}
	src := string(q)
	i := strings.Index(src, "-- name: ClaimSurveyInviteForSend")
	if i < 0 {
		t.Fatal("the claim query is missing")
	}
	claim := src[i:]
	if j := strings.Index(claim[5:], "-- name:"); j > 0 {
		claim = claim[:j+5]
	}
	for _, must := range []string{"i.state = 'approved'", "i.approved_by IS NOT NULL", "s.state = 'open'"} {
		if !strings.Contains(claim, must) {
			t.Errorf("the claim query no longer requires %q", must)
		}
	}
	w, _ := os.ReadFile("worker.go")
	if !strings.Contains(string(w), "outreach.Suppressed(") {
		t.Error("the send step no longer checks the opt-out list")
	}
}
