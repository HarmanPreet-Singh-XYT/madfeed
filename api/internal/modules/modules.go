// Package modules is the list of tools the platform is made of. A workspace has one set of people, accounts,
// evidence and settings (the core, which belongs to no module) and switches tools on and off by plan.
//
// Adding a tool means: add it here, give its API paths a prefix in PathPrefix, and list its pages in the web
// manifest (web/lib/modules.ts). Tools do not import each other; they meet through the core and through events.
package modules

import "slices"

// ID names a tool. The value is stored in plan files and sent to clients, so never rename one.
type ID string

const (
	// Feedback: adding and reviewing feedback, requests, the roadmap, messages to requesters, release notes.
	Feedback ID = "feedback"
	// Research: recordings, highlights, quotes, findings, asking questions of the evidence.
	Research ID = "research"
	// Surveys: building, targeting and reading surveys.
	Surveys ID = "surveys"
	// Support: the shared inbox for chat and email.
	Support ID = "support"
)

// All lists every tool in the order they are shown.
func All() []ID { return []ID{Feedback, Research, Surveys, Support} }

// Valid reports whether id names a tool.
func Valid(id ID) bool { return slices.Contains(All(), id) }

// PathPrefix maps the first path segment after /v1/workspaces/{id}/ to the tool that owns it. A segment that is
// not listed belongs to the core (people, settings, billing, team, export...) and is never switched off.
//
// Only prefixes that belong to exactly one tool are listed. Requests, statuses, tags, quotes and proposals are
// shared by several tools, so they stay in the core until they are split on purpose.
var PathPrefix = map[string]ID{
	"inbox":                 Support,
	"surveys":               Surveys,
	"media":                 Research,
	"highlights":            Research,
	"highlight-suggestions": Research,
	"findings":              Research,
	"qa":                    Research,
}

// OwnerOf returns the tool that owns a path segment, or false for the core.
func OwnerOf(segment string) (ID, bool) {
	id, ok := PathPrefix[segment]
	return id, ok
}

// Set is a set of tools. A nil Set means "all of them".
type Set map[ID]bool

// NewSet builds a Set from plan-file strings. An empty list means all tools.
func NewSet(ids []string) Set {
	if len(ids) == 0 {
		return nil
	}
	s := Set{}
	for _, id := range ids {
		s[ID(id)] = true
	}
	return s
}

// Has reports whether the set includes the tool.
func (s Set) Has(id ID) bool { return s == nil || s[id] }

// List returns the tools in the set, in display order.
func (s Set) List() []ID {
	var out []ID
	for _, id := range All() {
		if s.Has(id) {
			out = append(out, id)
		}
	}
	return out
}

// Strings is List as plain strings, sorted by display order.
func (s Set) Strings() []string {
	l := s.List()
	out := make([]string, len(l))
	for i, id := range l {
		out[i] = string(id)
	}
	return out
}
