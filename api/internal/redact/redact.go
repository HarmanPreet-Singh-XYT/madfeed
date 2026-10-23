// Package redact hides things that should never be stored or sent to a model
// from pasted text: payment card numbers, API keys and tokens, private keys,
// passwords written as "password: ...", and credentials inside connection
// strings. It runs when text enters the system, so what is stored (and so
// every quote and everything shown or sent later) is already clean.
//
// It is deliberately a net, not a guarantee: it catches the common shapes. It
// leaves email addresses and phone numbers alone because the product needs
// them. Every pattern is a Go regular expression, which runs in linear time,
// so hostile input cannot make it slow.
package redact

import (
	"regexp"
	"strings"
)

type Result struct {
	Text   string
	Counts map[string]int // by kind: "card", "secret", "private key", "password"
	Total  int
}

const (
	cardMark   = "[card number removed]"
	secretMark = "[secret removed]"
	keyMark    = "[private key removed]"
	passMark   = "[password removed]"
)

var (
	// 13 to 19 digits, optionally separated by single spaces or dashes.
	cardRe = regexp.MustCompile(`\b\d(?:[ -]?\d){12,18}\b`)

	// Credentials whose shape is unmistakable.
	secretRes = []*regexp.Regexp{
		regexp.MustCompile(`\bsk-[A-Za-z0-9_\-]{20,}`),                                        // OpenAI, DeepSeek and similar
		regexp.MustCompile(`\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}`),                   // Stripe
		regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`),                                   // AWS access key ids
		regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{30,}`),                                    // GitHub tokens
		regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{30,}`),                                  // GitHub fine-grained tokens
		regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}`),                                  // Slack tokens
		regexp.MustCompile(`\bsb_secret_[A-Za-z0-9_\-]{16,}`),                                 // Supabase secret keys
		regexp.MustCompile(`\bAIza[0-9A-Za-z_\-]{35}\b`),                                      // Google API keys
		regexp.MustCompile(`\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}`), // JSON web tokens
		regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/\-]{20,}=*`),                        // Authorization headers
	}

	pemBegin = regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`)
	pemEnd   = regexp.MustCompile(`-----END [A-Z ]*PRIVATE KEY-----`)

	// password: hunter2   api_key = "abc123"   token=xyz  (the label stays, the value goes)
	assignRe = regexp.MustCompile(`(?i)\b(password|passwd|pwd|passphrase|secret|client[_-]?secret|api[_-]?key|access[_-]?token|auth[_-]?token|token)(\s*[:=]\s*|\s+is\s+)("[^"\r\n]{4,200}"|'[^'\r\n]{4,200}'|[^\s"',;]{4,200})`)

	// scheme://user:password@host
	urlCredRe = regexp.MustCompile(`\b([a-zA-Z][a-zA-Z0-9+.\-]*://[^\s:/@]+:)[^\s@/]+(@)`)
)

// Text returns the input with sensitive values replaced, and what was found.
func Text(in string) Result {
	r := Result{Text: in, Counts: map[string]int{}}
	if in == "" {
		return r
	}
	count := func(kind string, n int) {
		if n > 0 {
			r.Counts[kind] += n
			r.Total += n
		}
	}
	// Order matters: whole private keys first (they contain base64 that other patterns would mangle).
	var n int
	r.Text, n = removeKeys(r.Text)
	count("private key", n)

	n = 0
	r.Text = urlCredRe.ReplaceAllStringFunc(r.Text, func(m string) string {
		n++
		sub := urlCredRe.FindStringSubmatch(m)
		return sub[1] + passMark + sub[2]
	})
	count("password", n)

	n = 0
	for _, re := range secretRes {
		r.Text = re.ReplaceAllStringFunc(r.Text, func(string) string { n++; return secretMark })
	}
	count("secret", n)

	n = 0
	r.Text = assignRe.ReplaceAllStringFunc(r.Text, func(m string) string {
		sub := assignRe.FindStringSubmatch(m)
		// Leave placeholders we already wrote, and obvious non-values, alone.
		v := strings.Trim(sub[3], `"'`)
		if isPlaceholder(v) || isWordy(sub[1], v) {
			return m
		}
		n++
		return sub[1] + sub[2] + passMark
	})
	count("password", n)

	n = 0
	r.Text = cardRe.ReplaceAllStringFunc(r.Text, func(m string) string {
		if isCard(m) {
			n++
			return cardMark
		}
		return m
	})
	count("card", n)
	return r
}

// isPlaceholder recognises a mark we wrote ourselves (the value stops at its first space, so only the start is seen).
func isPlaceholder(v string) bool {
	for _, m := range []string{"[password", "[secret", "[card", "[private"} {
		if strings.HasPrefix(v, m) {
			return true
		}
	}
	return false
}

// maxKeyBytes bounds how much text follows a "BEGIN PRIVATE KEY" line when the END line is missing (a cut-off paste).
const maxKeyBytes = 4000

// removeKeys replaces each private key block, from its BEGIN line to its END
// line (or, if the END is missing, to the next maxKeyBytes characters).
func removeKeys(s string) (string, int) {
	var b strings.Builder
	n, pos := 0, 0
	for {
		loc := pemBegin.FindStringIndex(s[pos:])
		if loc == nil {
			b.WriteString(s[pos:])
			return b.String(), n
		}
		start := pos + loc[0]
		b.WriteString(s[pos:start])
		rest := s[start+loc[1]-loc[0]:]
		end := len(rest)
		if len(rest) > maxKeyBytes {
			end = maxKeyBytes
		}
		if e := pemEnd.FindStringIndex(rest[:end]); e != nil {
			pos = start + (loc[1] - loc[0]) + e[1]
		} else {
			pos = start + (loc[1] - loc[0]) + end
		}
		b.WriteString(keyMark)
		n++
	}
}

// isWordy spares sentences like "token is expired" or "password reset": the value
// looks like an ordinary word rather than a credential.
func isWordy(label, v string) bool {
	if len(v) < 4 {
		return true
	}
	hasDigit, hasUpperOrSymbol := false, false
	for _, c := range v {
		switch {
		case c >= '0' && c <= '9':
			hasDigit = true
		case c >= 'A' && c <= 'Z', strings.ContainsRune("!@#$%^&*()_+-=[]{}|\\:;<>?,./~`", c):
			hasUpperOrSymbol = true
		}
	}
	explicit := strings.ContainsAny(label, "_-") || strings.EqualFold(label, "password") || strings.EqualFold(label, "passwd") || strings.EqualFold(label, "pwd")
	// With a clear label ("password: hunter2") any value goes; with a vague one ("token is ...") it must look like a credential.
	if explicit {
		return false
	}
	return !(hasDigit && (hasUpperOrSymbol || len(v) >= 12))
}

// isCard checks the digits against known card number prefixes and the Luhn checksum.
func isCard(s string) bool {
	var d []int
	for _, c := range s {
		if c >= '0' && c <= '9' {
			d = append(d, int(c-'0'))
		}
	}
	if len(d) < 13 || len(d) > 19 {
		return false
	}
	// A mix of separators ("1234-5678 9012...") or irregular grouping is more likely an id than a card.
	if strings.Contains(s, " ") && strings.Contains(s, "-") {
		return false
	}
	if !knownPrefix(d) {
		return false
	}
	sum, alt := 0, false
	for i := len(d) - 1; i >= 0; i-- {
		n := d[i]
		if alt {
			n *= 2
			if n > 9 {
				n -= 9
			}
		}
		sum += n
		alt = !alt
	}
	return sum%10 == 0
}

func knownPrefix(d []int) bool {
	p2 := d[0]*10 + d[1]
	p4 := p2*100 + d[2]*10 + d[3]
	switch {
	case d[0] == 4: // Visa
		return true
	case p2 >= 51 && p2 <= 55, p4 >= 2221 && p4 <= 2720: // Mastercard
		return true
	case p2 == 34 || p2 == 37: // American Express
		return true
	case p4 == 6011, p2 == 65, p2 >= 64 && p2 <= 65: // Discover
		return true
	case p2 == 35: // JCB
		return true
	case p2 == 30 || p2 == 36 || p2 == 38 || p2 == 39: // Diners
		return true
	case p2 == 62: // UnionPay
		return true
	}
	return false
}

// CardSpans finds card numbers in text and returns their [start, end) byte
// ranges. Callers that must keep their own structure (a transcript's timed
// segments) use it to mask the matching parts themselves.
func CardSpans(text string) [][2]int {
	var out [][2]int
	for _, loc := range cardRe.FindAllStringIndex(text, -1) {
		if isCard(text[loc[0]:loc[1]]) {
			out = append(out, [2]int{loc[0], loc[1]})
		}
	}
	return out
}

// CardMark is what replaces a card number.
const CardMark = cardMark
