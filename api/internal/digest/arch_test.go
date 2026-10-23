package digest

import (
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// The digest may send mail (it is allowed to import the email package) only because it can reach
// nobody but the people an admin listed for it. This pins that down: it must not read customer
// addresses, and must not borrow the customer-facing code.
func TestTheDigestCanOnlyReachItsOwnRecipientList(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "digest.go", nil, parser.ImportsOnly)
	if err != nil {
		t.Fatal(err)
	}
	for _, imp := range f.Imports {
		switch p := strings.Trim(imp.Path.Value, `"`); p {
		case "product/api/internal/outreach", "product/api/internal/directory", "product/api/internal/media", "product/api/internal/intake":
			t.Errorf("digest imports %s: it must not touch customer data paths", p)
		}
	}
	q, err := os.ReadFile("../store/queries/digest.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"to_email", "FROM person", "JOIN person", "submitter_email", " email FROM", "FROM suppression"} {
		// digest_recipient.email is the one address column it may read
		if strings.Contains(strings.ReplaceAll(string(q), "digest_recipient", ""), banned) {
			t.Errorf("digest.sql contains %q: the digest may only read its own recipient list", banned)
		}
	}
	src, _ := os.ReadFile("digest.go")
	if strings.Contains(string(src), "To: ") && !strings.Contains(string(src), "To: []string{r.Email}") {
		t.Error("a digest message is addressed to something other than a listed recipient")
	}
}
