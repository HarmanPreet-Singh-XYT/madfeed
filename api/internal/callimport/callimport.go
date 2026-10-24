// Package callimport turns a call transcript from another tool into the plain "Speaker: words" text this
// product reads. It understands WebVTT and SRT subtitle files, JSON with speaker turns (several common
// shapes), and plain text (kept as written). Timing is dropped: the words are what get read and quoted.
package callimport

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Turn is one stretch of speech by one speaker. Speaker may be empty.
type Turn struct {
	Speaker string
	Text    string
}

const (
	FormatAuto = "auto"
	FormatText = "text"
	FormatVTT  = "vtt"
	FormatSRT  = "srt"
	FormatJSON = "json"
)

var (
	tagRe     = regexp.MustCompile(`<[^>]*>`)
	voiceRe   = regexp.MustCompile(`^<v(?:\.[^\s>]+)*\s+([^>]+)>`)
	speakerRe = regexp.MustCompile(`^(\p{L}[\p{L}\p{N}.'’\-]*(?: [\p{L}\p{N}.'’\-]+){0,3}):\s+(\S.*)$`)
	timingRe  = regexp.MustCompile(`(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}`)
	spaceRe   = regexp.MustCompile(`\s+`)
)

// ErrEmpty means no speech was found.
var ErrEmpty = errors.New("no speech was found in that transcript")

// Parse reads a transcript in the given format ("auto" guesses) and returns clean text, one paragraph per turn, plus
// the number of turns and the format used.
func Parse(raw, format string) (text string, turns int, used string, err error) {
	raw = strings.TrimPrefix(strings.ReplaceAll(strings.ReplaceAll(raw, "\r\n", "\n"), "\r", "\n"), "\ufeff")
	if strings.TrimSpace(raw) == "" {
		return "", 0, "", ErrEmpty
	}
	if format == "" || format == FormatAuto {
		format = detect(raw)
	}
	var ts []Turn
	switch format {
	case FormatText:
		clean := strings.TrimSpace(raw)
		return clean, strings.Count(clean, "\n\n") + 1, FormatText, nil
	case FormatVTT, FormatSRT:
		ts = parseCues(raw)
	case FormatJSON:
		ts, err = parseJSON(raw)
		if err != nil {
			return "", 0, FormatJSON, err
		}
	default:
		return "", 0, "", fmt.Errorf("unknown format %q: use auto, text, vtt, srt or json", format)
	}
	text, turns = Render(ts)
	if turns == 0 {
		return "", 0, format, ErrEmpty
	}
	return text, turns, format, nil
}

func detect(raw string) string {
	t := strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(t, "WEBVTT"):
		return FormatVTT
	case (strings.HasPrefix(t, "{") || strings.HasPrefix(t, "[")) && json.Valid([]byte(t)):
		return FormatJSON
	case timingRe.MatchString(firstLines(t, 4)):
		if strings.Contains(firstLines(t, 4), ",") {
			return FormatSRT
		}
		return FormatVTT
	}
	return FormatText
}

func firstLines(s string, n int) string {
	lines := strings.SplitN(s, "\n", n+1)
	if len(lines) > n {
		lines = lines[:n]
	}
	return strings.Join(lines, "\n")
}

func clean(s string) string { return strings.TrimSpace(spaceRe.ReplaceAllString(s, " ")) }

// Render merges neighbouring turns by the same speaker and writes one paragraph per turn.
func Render(in []Turn) (string, int) {
	var merged []Turn
	for _, t := range in {
		t.Speaker, t.Text = clean(t.Speaker), clean(t.Text)
		if t.Text == "" {
			continue
		}
		if n := len(merged); n > 0 && merged[n-1].Speaker == t.Speaker {
			merged[n-1].Text += " " + t.Text
			continue
		}
		merged = append(merged, t)
	}
	var b strings.Builder
	for i, t := range merged {
		if i > 0 {
			b.WriteString("\n\n")
		}
		if t.Speaker != "" {
			b.WriteString(t.Speaker + ": ")
		}
		b.WriteString(t.Text)
	}
	return b.String(), len(merged)
}

// parseCues reads WebVTT and SRT. A cue that names its speaker (a <v Name> tag, or "Name: words") starts that
// speaker's turn; a cue that does not carries on the previous turn.
func parseCues(raw string) []Turn {
	var out []Turn
	last := ""
	for _, block := range strings.Split(raw, "\n\n") {
		lines := strings.Split(strings.TrimSpace(block), "\n")
		at := -1
		for i, l := range lines {
			if timingRe.MatchString(l) {
				at = i
				break
			}
		}
		if at < 0 {
			continue // header, note, style or region block
		}
		for _, l := range lines[at+1:] {
			l = strings.TrimSpace(l)
			speaker := ""
			if m := voiceRe.FindStringSubmatch(l); m != nil {
				speaker = clean(m[1])
			}
			l = clean(tagRe.ReplaceAllString(l, ""))
			if l == "" {
				continue
			}
			if speaker == "" {
				if m := speakerRe.FindStringSubmatch(l); m != nil {
					speaker, l = m[1], m[2]
				}
			}
			if speaker == "" {
				speaker = last
			}
			last = speaker
			out = append(out, Turn{Speaker: speaker, Text: l})
		}
	}
	return out
}

var (
	listKeys    = []string{"turns", "segments", "utterances", "transcript", "monologues", "sentences", "entries", "results", "paragraphs"}
	speakerKeys = []string{"speaker", "speaker_name", "speakerName", "name", "participant", "user", "speaker_id", "speakerId"}
	textKeys    = []string{"text", "content", "sentence", "utterance", "words", "transcript", "message"}
)

func parseJSON(raw string) ([]Turn, error) {
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return nil, errors.New("that is not valid JSON")
	}
	list := findList(v, 0)
	if list == nil {
		return nil, errors.New("could not find a list of speaker turns in that JSON; send a list of {speaker, text} objects")
	}
	out := turnsOf(list, 0)
	return out, nil
}

func findList(v any, depth int) []any {
	switch x := v.(type) {
	case []any:
		return x
	case map[string]any:
		if depth > 2 {
			return nil
		}
		for _, k := range listKeys {
			if sub, ok := x[k]; ok {
				if l := findList(sub, depth+1); l != nil {
					return l
				}
			}
		}
	}
	return nil
}

func turnsOf(list []any, depth int) []Turn {
	var out []Turn
	for _, it := range list {
		switch x := it.(type) {
		case string:
			out = append(out, Turn{Text: x})
		case map[string]any:
			sp := ""
			for _, k := range speakerKeys {
				if s := stringOf(x[k]); s != "" {
					sp = s
					break
				}
			}
			txt := ""
			for _, k := range textKeys {
				if s, ok := x[k].(string); ok && strings.TrimSpace(s) != "" {
					txt = s
					break
				}
			}
			if txt == "" && depth < 2 {
				// a monologue made of sentences: {speakerId, sentences: [{text}, ...]}
				for _, k := range []string{"sentences", "utterances", "segments", "turns", "words"} {
					if sub, ok := x[k].([]any); ok {
						var parts []string
						for _, s := range turnsOf(sub, depth+1) {
							parts = append(parts, s.Text)
						}
						txt = strings.Join(parts, " ")
						break
					}
				}
			}
			out = append(out, Turn{Speaker: sp, Text: txt})
		}
	}
	return out
}

func stringOf(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return fmt.Sprintf("Speaker %d", int(x))
	case map[string]any:
		for _, k := range []string{"name", "display_name", "displayName"} {
			if s, ok := x[k].(string); ok {
				return s
			}
		}
	}
	return ""
}
