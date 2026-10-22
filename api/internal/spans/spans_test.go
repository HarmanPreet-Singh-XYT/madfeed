package spans

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestValidate(t *testing.T) {
	text := "We need SSO. Café ☕ is nice."
	cafe := strings.Index(text, "Café ☕")
	cafeEnd := cafe + len("Café ☕")
	cases := []struct {
		name       string
		start, end int
		quote      string
		want       error
	}{
		{"exact", 3, 11, "need SSO", nil},
		{"unicode", cafe, cafeEnd, "Café ☕", nil},
		{"mismatch", 3, 11, "need sso", ErrMismatch},
		{"empty", 3, 3, "", ErrEmptyQuote},
		{"blank", 3, 4, " ", ErrEmptyQuote},
		{"negative", -1, 4, "We n", ErrOutOfRange},
		{"past end", 20, 999, "x", ErrOutOfRange},
		{"reversed", 11, 3, "need SSO", ErrOutOfRange},
		{"splits a rune", cafe, cafe + 4, text[cafe : cafe+4], ErrNotRuneAlign}, // byte 4 is inside the 2-byte é
	}
	for _, c := range cases {
		if err := Validate(text, c.start, c.end, c.quote); !errors.Is(err, c.want) {
			t.Errorf("%s: got %v want %v", c.name, err, c.want)
		}
	}
}

func TestLocateIsVerbatimOnly(t *testing.T) {
	text := "Customer: \"We really need single sign-on\" said Dana."
	s, e, err := Locate(text, "We really need single sign-on")
	if err != nil || text[s:e] != "We really need single sign-on" {
		t.Fatalf("%d %d %v", s, e, err)
	}
	for _, near := range []string{
		"we really need single sign-on",  // case
		"We really need  single sign-on", // whitespace
		"We really need single sign on",  // punctuation
		"They need SSO",                  // paraphrase
		"",                               // empty
	} {
		if _, _, err := Locate(text, near); err == nil {
			t.Errorf("near-match accepted: %q", near)
		}
	}
}

func checkTiling(t *testing.T, text string, max int) {
	t.Helper()
	chunks := Split(text, max)
	var b strings.Builder
	pos := 0
	for i, c := range chunks {
		if c.Ordinal != i || c.Start != pos || c.End <= c.Start || c.Text != text[c.Start:c.End] {
			t.Fatalf("bad chunk %d: %+v (pos %d)", i, c, pos)
		}
		if len(c.Text) > max && max >= utf8.UTFMax {
			t.Fatalf("chunk %d is %d bytes > max %d", i, len(c.Text), max)
		}
		if utf8.ValidString(text) && !utf8.ValidString(c.Text) {
			t.Fatalf("chunk %d splits a character", i)
		}
		b.WriteString(c.Text)
		pos = c.End
	}
	if b.String() != text {
		t.Fatalf("chunks do not reproduce the source")
	}
}

func TestSplitTilesTheSourceExactly(t *testing.T) {
	texts := []string{
		"", "a", "hello world",
		strings.Repeat("word ", 500),
		strings.Repeat("日本語のテキスト。", 200),
		strings.Repeat("😀", 300),
		"para one.\n\npara two is here.\nline three. Sentence four? Yes! " + strings.Repeat("x", 600),
		strings.Repeat("a", 5000),
	}
	for _, text := range texts {
		for _, max := range []int{4, 5, 16, 100, 1000} {
			checkTiling(t, text, max)
		}
	}
}

func TestSplitPrefersParagraphBreaks(t *testing.T) {
	text := "First paragraph here.\n\nSecond paragraph here, which is longer than the first."
	cs := Split(text, 40)
	if len(cs) < 2 || !strings.HasSuffix(cs[0].Text, "\n\n") {
		t.Fatalf("got %+v", cs)
	}
}

func FuzzSplitAndLocate(f *testing.F) {
	for _, s := range []string{"", "hello. world\n\nfoo", "日本 語", "😀😀😀", "\xff\xfe broken"} {
		f.Add(s, 7)
	}
	f.Fuzz(func(t *testing.T, text string, max int) {
		if max < 4 || max > 4096 || len(text) > 1<<16 {
			t.Skip()
		}
		checkTiling(t, text, max)
		// Anything Locate returns must validate.
		if utf8.ValidString(text) && len(text) > 3 {
			q := text[len(text)/4 : len(text)/2]
			if s, e, err := Locate(text, q); err == nil {
				if err := Validate(text, s, e, q); err != nil {
					t.Fatalf("Locate returned a span that does not validate: %v", err)
				}
			}
		}
	})
}

func TestLocateLooseSnapsToTheSourcesOwnWords(t *testing.T) {
	text := "Dana said: “We really   need\nSSO — for our team” and left.\u200b Then Dana wrote: it's urgent for compliance reasons."
	cases := map[string]string{
		"we really need sso - for our team":      "We really   need\nSSO — for our team", // case, dash, whitespace
		"\"We really need SSO — for our team.\"": "We really   need\nSSO — for our team", // added quote marks and period
		"It’s urgent for compliance reasons":     "it's urgent for compliance reasons",   // curly apostrophe, case, missing period
	}
	for model, want := range cases {
		s, e, exact, err := LocateLoose(text, model)
		if err != nil {
			t.Errorf("%q: %v", model, err)
			continue
		}
		if exact {
			t.Errorf("%q: should have been a loose match", model)
		}
		if got := text[s:e]; !strings.EqualFold(strings.Join(strings.Fields(got), " "), strings.Join(strings.Fields(want), " ")) {
			t.Errorf("%q: snapped to %q", model, got)
		}
		if err := Validate(text, s, e, text[s:e]); err != nil {
			t.Errorf("%q: snapped span does not validate: %v", model, err)
		}
	}
	// An exact match is reported as exact.
	if _, _, exact, err := LocateLoose(text, "for our team"); err != nil || !exact {
		t.Errorf("exact: %v %v", exact, err)
	}
}

func TestLocateLooseRefusesGuesses(t *testing.T) {
	text := "We need SSO. Later, we need SSO. Customers want better reporting for their finance teams."
	for name, q := range map[string]string{
		"paraphrase":       "customers desire improved reporting for finance",
		"too short":        "WE NEED",
		"ambiguous":        "we need sso.", // twice in the text
		"joined fragments": "We need SSO ... better reporting for their finance teams",
		"ellipsis char":    "We need SSO … finance teams",
		"empty":            "   ",
	} {
		if _, _, _, err := LocateLoose(text, q); err == nil {
			t.Errorf("%s: accepted %q", name, q)
		}
	}
}

func TestWindowKeepsRuneBoundaries(t *testing.T) {
	text := strings.Repeat("日本語", 100)
	for _, c := range Split(text, 30) {
		s, e := Window(text, c, 7)
		if s > c.Start || e < c.End || !utf8.ValidString(text[s:e]) {
			t.Fatalf("bad window %d..%d for chunk %+v", s, e, c)
		}
	}
}

func FuzzLocateLoose(f *testing.F) {
	f.Add("Hello World — we need SSO today, please.", "WE NEED SSO TODAY")
	f.Add("日本語 text “quoted” here", "日本語 TEXT \"quoted\" here")
	f.Fuzz(func(t *testing.T, text, quote string) {
		if len(text) > 1<<14 || len(quote) > 1<<10 || !utf8.ValidString(text) {
			t.Skip()
		}
		s, e, _, err := LocateLoose(text, quote)
		if err != nil {
			return
		}
		// Whatever is returned must be a valid, rune-aligned, non-empty slice of the source.
		if err := Validate(text, s, e, text[s:e]); err != nil {
			t.Fatalf("returned span fails validation: %v (span %d..%d)", err, s, e)
		}
	})
}
