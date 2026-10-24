package hooks

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Render turns a stored event envelope into the message body of a chat tool. The text is built here from fixed
// wording plus the request title, and the title is customer-derived, so it is made safe for the tool: no
// mentions of everyone, no links or markup smuggled in.
func Render(format, webURL string, ws uuid.UUID, envelope []byte) []byte {
	var ev struct {
		Type string         `json:"type"`
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(envelope, &ev)
	text, link := describe(ev.Type, ev.Data, strings.TrimRight(webURL, "/"), ws)
	switch format {
	case "slack":
		t := slackEscape(text)
		if link != "" {
			t += "\n<" + link + "|Open in the app>"
		}
		return mustJSON(map[string]any{"text": t})
	case "discord":
		t := plainEscape(text)
		if link != "" {
			t += "\n" + link
		}
		// no mention in a title can ping anyone
		return mustJSON(map[string]any{"content": clipRunes(t, 1900), "allowed_mentions": map[string]any{"parse": []string{}}})
	case "teams":
		t := plainEscape(text)
		if link != "" {
			t += "\n\n[Open in the app](" + link + ")"
		}
		return mustJSON(map[string]any{"type": "message", "attachments": []any{map[string]any{
			"contentType": "application/vnd.microsoft.card.adaptive",
			"content": map[string]any{
				"$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4",
				"body": []any{map[string]any{"type": "TextBlock", "text": t, "wrap": true}},
			},
		}}})
	}
	return envelope
}

func describe(typ string, d map[string]any, web string, ws uuid.UUID) (text, link string) {
	str := func(k string) string {
		v, _ := d[k].(string)
		return clipRunes(strings.Join(strings.Fields(v), " "), 200)
	}
	reqLink := func() string {
		if id := str("requestId"); id != "" && web != "" {
			return web + "/w/" + ws.String() + "/requests/" + id
		}
		return ""
	}
	switch typ {
	case RequestCreated:
		return "New request: " + str("title"), reqLink()
	case RequestStatusChanged:
		return fmt.Sprintf("Request “%s” moved to %s", str("title"), str("toStatusName")), reqLink()
	case SuggestionsReady:
		n, _ := d["count"].(float64)
		l := ""
		if web != "" {
			l = web + "/w/" + ws.String() + "/review"
		}
		if n == 1 {
			return "1 new suggestion is ready to review", l
		}
		return fmt.Sprintf("%d new suggestions are ready to review", int(n)), l
	case ReleaseNotePublished:
		l := ""
		if web != "" {
			l = web + "/w/" + ws.String() + "/releases"
		}
		return "Release note published: " + str("title"), l
	case SurveyResponse:
		return "Someone finished a survey", ""
	case Ping:
		return "Test message: this address will receive notifications.", ""
	}
	return "Something happened (" + typ + ")", ""
}

func slackEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

// plainEscape stops markdown in a title from turning into links, emphasis or mentions.
func plainEscape(s string) string {
	return strings.NewReplacer("\\", "\\\\", "*", "\\*", "_", "\\_", "`", "\\`", "[", "\\[", "]", "\\]", "<", "\\<", "@", "@​", "~", "\\~", "|", "\\|", ">", "\\>").Replace(s)
}

func clipRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
