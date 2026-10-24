package devfakes

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// The stand-ins hold fake credentials and skip real checks. They must never be linked into the server or the
// worker: only the programs under cmd/dev*, and tests, may use them.
func TestOnlyDevelopmentProgramsAndTestsImportTheStandIns(t *testing.T) {
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		rel, _ := filepath.Rel(root, filepath.Dir(path))
		rel = filepath.ToSlash(rel)
		if rel == "internal/devfakes" || strings.HasPrefix(rel, "cmd/dev") {
			return nil
		}
		f, perr := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if perr != nil {
			return perr
		}
		for _, imp := range f.Imports {
			if strings.Trim(imp.Path.Value, `"`) == "product/api/internal/devfakes" {
				t.Errorf("%s imports the development stand-ins; they must not reach the real server", path)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
