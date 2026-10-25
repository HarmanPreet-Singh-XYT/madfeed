package modules

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Which package belongs to which tool. A package listed nowhere is core: shared machinery (people and accounts,
// intake, sending, storage, AI, billing, team...) that every tool may use and that no tool owns.
//
// A tool package must not import another tool's package. Tools meet through the core and through events
// (hooks), so that one tool can be switched off, sold, or rewritten without touching the others. When a tool
// needs something from another, move the shared part into the core or send an event.
var toolPackages = map[string]ID{
	"review": Feedback, "release": Feedback, "publicsite": Feedback, "workflow": Feedback, "brief": Feedback,
	"research": Research, "media": Research, "findings": Research, "insights": Research, "transcribe": Research,
	"survey": Surveys, "audience": Surveys,
	"inbox": Support,
}

// Packages allowed to see every tool: they assemble the server, speak a public protocol over all of it, or
// report across it.
var composition = map[string]bool{"api": true, "mcpserver": true, "portability": true, "ops": true, "retention": true, "digest": true}

// Core packages that still reach into a tool. These are debt: each should end up using an event or a core
// interface instead. The test fails if one is added here without being needed, so the list can only shrink.
var knownCoreToTool = map[string][]string{
	"audit":        {"research", "brief"},
	"integrations": {"workflow"},
}

func internalImports(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		f, err := parser.ParseFile(token.NewFileSet(), filepath.Join(dir, e.Name()), nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range f.Imports {
			p := strings.Trim(imp.Path.Value, `"`)
			if rest, ok := strings.CutPrefix(p, "product/api/internal/"); ok {
				seen[strings.SplitN(rest, "/", 2)[0]] = true
			}
		}
	}
	var out []string
	for p := range seen {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

func TestToolsDoNotImportEachOther(t *testing.T) {
	for pkg, tool := range toolPackages {
		if _, err := os.Stat(filepath.Join("..", pkg)); err != nil {
			t.Errorf("toolPackages lists %q, which does not exist: %v", pkg, err)
			continue
		}
		if !Valid(tool) {
			t.Errorf("%s is assigned to unknown tool %q", pkg, tool)
		}
		for _, imp := range internalImports(t, filepath.Join("..", pkg)) {
			if other, isTool := toolPackages[imp]; isTool && other != tool {
				t.Errorf("%s (%s tool) imports %s (%s tool): move what they share into the core, or use an event", pkg, tool, imp, other)
			}
		}
	}
}

func TestOnlyCompositionAndKnownDebtReachIntoTools(t *testing.T) {
	entries, err := os.ReadDir("..")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		pkg := e.Name()
		if !e.IsDir() || composition[pkg] {
			continue
		}
		if _, isTool := toolPackages[pkg]; isTool {
			continue
		}
		var found []string
		for _, imp := range internalImports(t, filepath.Join("..", pkg)) {
			if _, isTool := toolPackages[imp]; isTool {
				found = append(found, imp)
			}
		}
		want := knownCoreToTool[pkg]
		sort.Strings(want)
		if strings.Join(found, ",") != strings.Join(want, ",") {
			t.Errorf("core package %s imports tools %v, but the allowed list is %v (shrink the list when you fix one; do not grow it)", pkg, found, want)
		}
	}
}
