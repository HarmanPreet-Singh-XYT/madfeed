package modules

import (
	"slices"
	"testing"
)

func TestASetWithNoListMeansEveryTool(t *testing.T) {
	if got := NewSet(nil).List(); !slices.Equal(got, All()) {
		t.Errorf("empty plan list = %v, want all %v", got, All())
	}
	s := NewSet([]string{"support", "feedback"})
	if !s.Has(Support) || !s.Has(Feedback) || s.Has(Surveys) {
		t.Errorf("set = %v", s)
	}
	if got := s.Strings(); !slices.Equal(got, []string{"feedback", "support"}) {
		t.Errorf("shown in display order, got %v", got)
	}
}

func TestEveryOwnedPathBelongsToAKnownTool(t *testing.T) {
	for seg, id := range PathPrefix {
		if !Valid(id) {
			t.Errorf("%q is owned by unknown tool %q", seg, id)
		}
	}
}
