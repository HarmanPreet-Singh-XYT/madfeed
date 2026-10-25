package outreach

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// Only the send worker may talk to the email provider about customers. This
// test fails the build if any other package starts importing the email package,
// so "nothing is sent without approval" cannot be bypassed by accident.
func TestOnlyTheSendPathImportsTheEmailPackage(t *testing.T) {
	allowed := map[string]bool{
		"internal/outreach":     true, // the approval-checked send worker
		"internal/email/resend": true, // the provider adapter itself
		"internal/email":        true,
		"internal/digest":       true, // the weekly team digest: only to addresses an admin listed and confirmed (see internal/digest/arch_test.go)
		"internal/inbox":        true, // support replies: only what a teammate sent, never to an opted-out address (see internal/inbox/arch_test.go)
		"internal/survey":       true, // survey invitations: same approval, opt-out and claim rules (see internal/survey/arch_test.go)
		"internal/team":         true, // invitations to teammates: only to the one address an admin typed (see internal/team/arch_test.go)
		"cmd/server":            true, // wires the sender into the worker
		"cmd/devmail":           true,
	}
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		f, perr := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if perr != nil {
			return perr
		}
		rel, _ := filepath.Rel(root, filepath.Dir(path))
		rel = filepath.ToSlash(rel)
		for _, imp := range f.Imports {
			p := strings.Trim(imp.Path.Value, `"`)
			if (p == "product/api/internal/email" || p == "product/api/internal/email/resend") && !allowed[rel] {
				t.Errorf("%s imports %s: only the approval-checked send path may send email", path, p)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
