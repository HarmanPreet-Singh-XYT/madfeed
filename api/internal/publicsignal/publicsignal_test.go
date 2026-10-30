package publicsignal

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"product/api/internal/ai"
)

func results() []Result {
	return []Result{
		{Title: "Docs: scheduled exports", URL: "https://example.com/docs/exports", Snippet: "You can schedule exports weekly."},
		{Title: "Forum: export fails", URL: "https://example.com/forum/123", Snippet: "Export returns an error."},
	}
}

func TestValidateAcceptsASourceItWasGiven(t *testing.T) {
	raw := json.RawMessage(`{"verdict":"already_supported","summary":"The docs show scheduled exports already exist.","source_urls":["https://example.com/docs/exports"]}`)
	verdict, summary, sources, _, err := validate(raw, results())
	if err != nil {
		t.Fatal(err)
	}
	if verdict != VerdictAlreadySupported || len(sources) != 1 || sources[0].URL != "https://example.com/docs/exports" || !strings.Contains(summary, "scheduled exports") {
		t.Fatalf("%q %q %+v", verdict, summary, sources)
	}
}

func TestValidateRefusesInventedOrMangledURLs(t *testing.T) {
	for name, body := range map[string]string{
		"invented": `{"verdict":"known_issue","summary":"Reported publicly.","source_urls":["https://evil.example/invented"]}`,
		"mangled":  `{"verdict":"known_issue","summary":"Reported publicly.","source_urls":["https://example.com/forum/123?utm=1"]}`,
		"bare":     `{"verdict":"known_issue","summary":"Reported publicly.","source_urls":["example.com/forum/123"]}`,
	} {
		if _, _, _, _, err := validate(json.RawMessage(body), results()); !errors.Is(err, ai.ErrInvalidOutput) {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestValidateRefusesNoSignalWithSourcesAndSignalWithNone(t *testing.T) {
	cases := []string{
		`{"verdict":"no_signal","summary":"Nothing relevant.","source_urls":["https://example.com/docs/exports"]}`,
		`{"verdict":"known_issue","summary":"Reported publicly.","source_urls":[]}`,
		`{"verdict":"maybe","summary":"Unclear.","source_urls":["https://example.com/docs/exports"]}`,
		`{"verdict":"known_issue","summary":"","source_urls":["https://example.com/docs/exports"]}`,
	}
	for _, c := range cases {
		if _, _, _, _, err := validate(json.RawMessage(c), results()); !errors.Is(err, ai.ErrInvalidOutput) {
			t.Errorf("%s: got %v", c, err)
		}
	}
}

func TestValidateNoSignalNeedsNoSources(t *testing.T) {
	v, summary, sources, _, err := validate(json.RawMessage(`{"verdict":"no_signal","summary":"Nothing relevant was found.","source_urls":[]}`), results())
	if err != nil || v != VerdictNoSignal || len(sources) != 0 || summary == "" {
		t.Fatalf("%q %v %v", v, sources, err)
	}
}

func TestValidateAcceptsDemandSignal(t *testing.T) {
	raw := json.RawMessage(`{"verdict":"demand_signal","summary":"People on other products are asking for the same thing.","source_urls":["https://example.com/forum/123"],"patterns":[]}`)
	v, _, sources, patterns, err := validate(raw, results())
	if err != nil || v != VerdictDemandSignal || len(sources) != 1 || len(patterns) != 0 {
		t.Fatalf("%q %v %v %v", v, sources, patterns, err)
	}
}

func TestValidateDropsAPatternThatCitesAnUnknownURL(t *testing.T) {
	raw := json.RawMessage(`{"verdict":"already_supported","summary":"The docs show it exists.","source_urls":["https://example.com/docs/exports"],
		"patterns":[{"approach":"A weekly schedule picker.","url":"https://example.com/docs/exports"},{"approach":"Invented.","url":"https://evil.example/x"}]}`)
	_, _, _, patterns, err := validate(raw, results())
	if err != nil {
		t.Fatal(err)
	}
	if len(patterns) != 1 || patterns[0].URL != "https://example.com/docs/exports" {
		t.Fatalf("%+v", patterns)
	}
}

func TestValidateReadsAPatternWrittenAsASentence(t *testing.T) {
	raw := json.RawMessage(`{"verdict":"already_supported","summary":"The docs show it exists.","source_urls":["https://example.com/docs/exports"],
		"patterns":["Exports are scheduled from a weekly picker. (https://example.com/docs/exports)"]}`)
	_, _, _, patterns, err := validate(raw, results())
	if err != nil {
		t.Fatal(err)
	}
	if len(patterns) != 1 || patterns[0].URL != "https://example.com/docs/exports" || strings.HasSuffix(patterns[0].Approach, "(") {
		t.Fatalf("%+v", patterns)
	}
}
