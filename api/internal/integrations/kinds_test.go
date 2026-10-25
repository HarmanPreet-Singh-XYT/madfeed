package integrations

import (
	"slices"
	"testing"
)

func TestTheEnabledListIsReadStrictly(t *testing.T) {
	got, err := ParseEnabled(" Slack, github ,,")
	if err != nil || !got["slack"] || !got["github"] || len(got) != 2 {
		t.Fatalf("%v %v", got, err)
	}
	for _, bad := range []string{"slack,githb", "everything", "linear;jira"} {
		if _, err := ParseEnabled(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	empty, err := ParseEnabled("")
	if err != nil || len(empty) != 0 {
		t.Errorf("empty: %v %v", empty, err)
	}
}

func TestWhatIsOnFollowsTheList(t *testing.T) {
	all := &Service{}
	if !all.On("jira") || len(all.EnabledKinds()) != len(Kinds) {
		t.Error("a server without a list should have everything on")
	}
	on, _ := ParseEnabled("slack,hubspot")
	s := &Service{Enabled: on}
	if s.On("github") || !s.On("hubspot") || s.On("nonsense") {
		t.Error("wrong kinds are on")
	}
	if !slices.Equal(s.EnabledKinds(), []string{"slack", "hubspot"}) {
		t.Errorf("%v", s.EnabledKinds())
	}
	for _, k := range DefaultEnabled {
		if !slices.Contains(Kinds, k) {
			t.Errorf("default %s is not a kind", k)
		}
	}
}
