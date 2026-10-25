package integrations

import (
	"fmt"
	"slices"
	"strings"
)

// Kinds are the services a workspace can connect. Each can be switched on or off for the whole server with
// INTEGRATIONS_ENABLED; a kind that is off hides its screens, refuses its calls and notifications, and runs no
// background work, while anything already stored stays untouched so it can be switched on again later.
var Kinds = []string{"slack", "github", "linear", "jira", "clickup", "asana", "azuredevops", "hubspot"}

// DefaultEnabled is what a server offers when INTEGRATIONS_ENABLED is not set: only the services that have been
// approved for use. The others are built and tested, and wait for the owner to turn them on.
var DefaultEnabled = []string{"slack", "github"}

// ParseEnabled reads a comma-separated list of kinds. An unknown name is an error, so a typo does not silently
// leave something off (or on).
func ParseEnabled(csv string) (map[string]bool, error) {
	out := map[string]bool{}
	for _, k := range strings.Split(csv, ",") {
		k = strings.ToLower(strings.TrimSpace(k))
		if k == "" {
			continue
		}
		if !slices.Contains(Kinds, k) {
			return nil, fmt.Errorf("INTEGRATIONS_ENABLED names %q, which is not one of: %s", k, strings.Join(Kinds, ", "))
		}
		out[k] = true
	}
	return out, nil
}

// On says whether a kind is switched on. A server built without a list (tests, tools) has everything on.
func (s *Service) On(kind string) bool {
	if s.Enabled == nil {
		return true
	}
	return s.Enabled[kind]
}

// EnabledKinds lists the kinds that are on, in the order of Kinds.
func (s *Service) EnabledKinds() []string {
	out := []string{}
	for _, k := range Kinds {
		if s.On(k) {
			out = append(out, k)
		}
	}
	return out
}
