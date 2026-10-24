package callimport_test

import (
	"strings"
	"testing"

	"product/api/internal/callimport"
)

func parse(t *testing.T, raw, format string) (string, int, string) {
	t.Helper()
	text, n, used, err := callimport.Parse(raw, format)
	if err != nil {
		t.Fatalf("%v", err)
	}
	return text, n, used
}

func TestWebVTTWithVoiceTagsAndNamePrefixes(t *testing.T) {
	vtt := "WEBVTT\n\nNOTE a comment\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Dana>We keep asking for SSO.</v>\n\n00:00:04.500 --> 00:00:06.000\n<v Dana>It blocks the rollout.</v>\n\n00:00:06.500 --> 00:00:08.000\n<v Sam Lee>Understood, we will look.</v>\n\n00:00:09.000 --> 00:00:10.000\nRaj: And exports too.\n"
	text, n, used := parse(t, vtt, "auto")
	want := "Dana: We keep asking for SSO. It blocks the rollout.\n\nSam Lee: Understood, we will look.\n\nRaj: And exports too."
	if used != "vtt" || n != 3 || text != want {
		t.Fatalf("%s %d\n%s", used, n, text)
	}
}

func TestSRTAndCuesWithoutSpeakersCarryOn(t *testing.T) {
	srt := "1\n00:00:01,000 --> 00:00:03,000\nDana: Hello there\nand welcome.\n\n2\n00:00:03,500 --> 00:00:05,000\nI need single sign-on.\n\n3\n00:00:06,000 --> 00:00:07,000\nSam: Noted.\n"
	text, n, used := parse(t, srt, "auto")
	if used != "srt" || n != 2 || text != "Dana: Hello there and welcome. I need single sign-on.\n\nSam: Noted." {
		t.Fatalf("%s %d %q", used, n, text)
	}
}

func TestJSONShapes(t *testing.T) {
	for name, raw := range map[string]string{
		"list":       `[{"speaker":"Dana","text":"We need SSO."},{"speaker":"Dana","text":"Soon."},{"speaker":"Sam","text":"Ok."}]`,
		"wrapped":    `{"transcript":{"utterances":[{"speaker_name":"Dana","content":"We need SSO. Soon."},{"name":"Sam","sentence":"Ok."}]}}`,
		"monologues": `{"monologues":[{"speaker":{"name":"Dana"},"sentences":[{"text":"We need SSO."},{"text":"Soon."}]},{"speaker":"Sam","sentences":[{"text":"Ok."}]}]}`,
	} {
		text, n, used := parse(t, raw, "auto")
		if used != "json" || n != 2 || text != "Dana: We need SSO. Soon.\n\nSam: Ok." {
			t.Errorf("%s: %s %d %q", name, used, n, text)
		}
	}
	// numeric speaker ids get a readable label
	text, _, _ := parse(t, `[{"speaker":0,"text":"Hi"},{"speaker":1,"text":"Hello"}]`, "json")
	if text != "Speaker 0: Hi\n\nSpeaker 1: Hello" {
		t.Errorf("%q", text)
	}
}

func TestPlainTextIsKeptAsWritten(t *testing.T) {
	in := "Dana: hello\n\nSam: hi there"
	text, n, used := parse(t, "\ufeff"+in+"\r\n", "auto")
	if used != "text" || text != in || n != 2 {
		t.Errorf("%s %d %q", used, n, text)
	}
}

func TestMarkupIsStrippedAndBadInputIsRefused(t *testing.T) {
	text, _, _ := parse(t, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<c.yellow><i>We need</i> <b>SSO</b></c>\n", "vtt")
	if text != "We need SSO" || strings.ContainsAny(text, "<>") {
		t.Errorf("%q", text)
	}
	for name, c := range map[string][2]string{
		"empty":        {"  \n", "auto"},
		"no cues":      {"WEBVTT\n\nNOTE only a note\n", "vtt"},
		"bad json":     {`{"a":`, "json"},
		"no list":      {`{"a":1}`, "json"},
		"empty turns":  {`[{"speaker":"A","text":" "}]`, "json"},
		"unknown kind": {"x", "docx"},
	} {
		if _, _, _, err := callimport.Parse(c[0], c[1]); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
