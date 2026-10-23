// Package promptguard spots customer text that looks like instructions aimed at an AI assistant.
// It is a best-effort filter, not a guarantee: no pattern list can recognise every phrasing, and a
// determined writer can get around any list. It exists to take the obvious attempts out of an
// assistant's view by default, as one layer on top of the real protections (read-only tools,
// quotes delivered as labelled data, nothing acting without a person).
package promptguard

import (
	"regexp"
	"strings"
	"unicode"
)

type rule struct {
	reason string
	re     *regexp.Regexp
}

func r(reason, pattern string) rule { return rule{reason, regexp.MustCompile(`(?i)` + pattern)} }

var rules = []rule{
	r("asks the reader to ignore its instructions", `\b(ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the|these|those|system|safety)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|directions?|constraints?|restrictions?)\b`),
	r("tries to set the reader's role", `\b(you are now|from now on,? you|act as (an? )?(?:ai|assistant|admin|developer|root)|pretend (to be|you are)|new (instructions|role|persona))\b`),
	r("refers to the system prompt or hidden instructions", `\b(system|developer|hidden|secret) (prompt|message|instructions?)\b|\breveal (your|the) (prompt|instructions)\b`),
	r("looks like a chat or tool control marker", `(<\|[a-z_]+\|>|\[/?(inst|system|assistant|user)\]|^\s*(system|assistant|developer)\s*:|</?(system|instructions?|tool_?call|function_?call)>|\bBEGIN (SYSTEM|INSTRUCTIONS)\b)`),
	r("asks the reader to use a tool or take an action", `\b(call|invoke|run|execute|use) (the |a |an )?(tool|function|command|api|mcp|search_requests|get_request|ask_feedback|submit_feedback)\b`),
	r("asks the reader to send or leak something", `\b(send|email|forward|post|upload|exfiltrate|leak|reveal|share)\b[^.\n]{0,50}\b(api[ _-]?key|secret|token|password|credentials?|customer (data|list|emails?)|all (requests|quotes|data))\b`),
	r("asks the reader to delete or change data", `\b(delete|drop|wipe|erase|remove|truncate)\b[^.\n]{0,30}\b(all|every|the)\b[^.\n]{0,30}\b(requests?|quotes?|data|records?|workspace|accounts?|database)\b`),
	r("tells the reader what to answer", `\b(always|only|must|should)\b[^.\n]{0,20}\b(answer|respond|reply|say|output|write)\b[^.\n]{0,30}\b(that|with|"|only)\b[^.\n]*\b(regardless|no matter|ignore|instead)\b`),
}

// normalize removes tricks that hide a phrase from a pattern: invisible characters, odd spacing, case.
func normalize(s string) string {
	var b strings.Builder
	for _, c := range s {
		switch {
		case unicode.Is(unicode.Cf, c) || c == '­': // zero-width and other format characters
			continue
		case unicode.IsSpace(c):
			b.WriteRune(' ')
		default:
			b.WriteRune(unicode.ToLower(c))
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// Suspicious reports whether the text looks like instructions for an AI, and why.
func Suspicious(text string) (bool, string) {
	if len(text) > 20_000 {
		text = text[:20_000]
	}
	n := normalize(text)
	for _, rl := range rules {
		if rl.re.MatchString(n) {
			return true, rl.reason
		}
	}
	return false, ""
}
