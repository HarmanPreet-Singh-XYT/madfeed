package api

import (
	"fmt"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

// Rules for what the API accepts, enforced on the contract itself so a new
// endpoint cannot quietly break them:
//   - a JSON request body is a closed object (unknown fields are refused);
//   - every string in it has a maximum length, every array a maximum count.
func TestEveryRequestBodyIsClosedAndBounded(t *testing.T) {
	spec, err := GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	var problems []string
	var walk func(where string, ref *openapi3.SchemaRef, depth int)
	walk = func(where string, ref *openapi3.SchemaRef, depth int) {
		if ref == nil || ref.Value == nil || depth > 6 {
			return
		}
		s := ref.Value
		switch {
		case s.Type.Is("object"):
			if s.AdditionalProperties.Has == nil || *s.AdditionalProperties.Has {
				problems = append(problems, where+": object accepts unknown fields (set additionalProperties: false)")
			}
			for name, p := range s.Properties {
				walk(where+"."+name, p, depth+1)
			}
		case s.Type.Is("array"):
			if s.MaxItems == nil {
				problems = append(problems, where+": array has no maxItems")
			}
			walk(where+"[]", s.Items, depth+1)
		case s.Type.Is("string"):
			bounded := s.MaxLength != nil || len(s.Enum) > 0 || s.Format == "uuid" || s.Format == "date-time" || s.Format == "date"
			if !bounded {
				problems = append(problems, where+": string has no maxLength")
			}
		}
	}
	checked := 0
	for path, item := range spec.Paths.Map() {
		for method, op := range item.Operations() {
			if op.RequestBody == nil || op.RequestBody.Value == nil {
				continue
			}
			mt := op.RequestBody.Value.Content.Get("application/json")
			if mt == nil {
				continue
			}
			checked++
			walk(fmt.Sprintf("%s %s", method, path), mt.Schema, 0)
		}
	}
	if checked < 25 {
		t.Fatalf("only %d JSON request bodies found; the reader is broken", checked)
	}
	if len(problems) > 0 {
		t.Errorf("%d problem(s) in the contract:\n  %s", len(problems), strings.Join(problems, "\n  "))
	}
}
