package team

import (
	"go/parser"
	"go/token"
	"os"
	"regexp"
	"strings"
	"testing"
)

// An invitation may be emailed (this package may import the email package) only because it can reach nobody but
// the one address an admin typed for it. This pins that down: it must not read customer addresses or borrow the
// customer-facing code, and a message must be addressed to the invitation's own address.
func TestAnInvitationCanOnlyReachItsOwnAddress(t *testing.T) {
	fset := token.NewFileSet()
	for _, file := range []string{"team.go", "worker.go", "token.go"} {
		f, err := parser.ParseFile(fset, file, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range f.Imports {
			switch p := strings.Trim(imp.Path.Value, `"`); p {
			case "product/api/internal/outreach", "product/api/internal/directory", "product/api/internal/media", "product/api/internal/intake", "product/api/internal/survey", "product/api/internal/inbox":
				t.Errorf("%s imports %s: team must not touch customer data paths", file, p)
			}
		}
	}
	src, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(src), "To: []string{to}") || len(regexp.MustCompile(`\bTo:`).FindAllString(string(src), -1)) != 1 {
		t.Error("an invitation is addressed to something other than the invitation's own address")
	}
	for _, banned := range []string{"FROM person", "JOIN person", "to_email", "submitter_email", "FROM suppression"} {
		for _, file := range []string{"team.go", "worker.go"} {
			b, _ := os.ReadFile(file)
			if strings.Contains(string(b), banned) {
				t.Errorf("%s contains %q: team may only read its own invitations", file, banned)
			}
		}
	}
}
