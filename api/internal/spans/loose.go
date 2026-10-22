package spans

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// MinLooseBytes is the shortest normalised quote that may be matched loosely.
// Shorter strings ("the", "need sso") match too many places by accident.
const MinLooseBytes = 12

// LocateLoose finds quote in text allowing trivial differences: letter case,
// runs of whitespace, curly vs straight quotes and dashes, zero-width
// characters, and punctuation or quote marks at the edges. It returns the span
// in the ORIGINAL text, so callers store text[start:end] (the source's own
// words), never the model's string. exact reports whether the match was
// byte-for-byte.
//
// Loose matches are refused when they could change meaning or be a guess:
// the quote joins fragments with an ellipsis, is shorter than MinLooseBytes
// once normalised, or occurs more than once in the text.
func LocateLoose(text, quote string) (start, end int, exact bool, err error) {
	if s, e, err := Locate(text, quote); err == nil {
		return s, e, true, nil
	}
	if strings.TrimSpace(quote) == "" {
		return 0, 0, false, ErrEmptyQuote
	}
	if strings.Contains(quote, "...") || strings.Contains(quote, "…") {
		return 0, 0, false, ErrNotFound // fragments joined by the model are not a quote
	}
	nt, tStart, tEnd := normalise(text)
	nq, _, _ := normalise(quote)
	for _, cand := range edgeVariants(nq) {
		if len(cand) < MinLooseBytes {
			continue
		}
		i := strings.Index(nt, cand)
		if i < 0 {
			continue
		}
		if strings.Contains(nt[i+1:], cand) { // second occurrence (overlapping counts)
			return 0, 0, false, ErrNotFound // ambiguous: refuse rather than guess
		}
		first := utf8.RuneCountInString(nt[:i])
		last := first + utf8.RuneCountInString(cand) - 1
		s, e := tStart[first], tEnd[last]
		if err := Validate(text, s, e, text[s:e]); err != nil {
			return 0, 0, false, err
		}
		return s, e, false, nil
	}
	return 0, 0, false, ErrNotFound
}

// edgeVariants yields the quote as given, then without surrounding quote marks
// and sentence punctuation, which models often add or drop.
func edgeVariants(nq string) []string {
	trimmed := strings.Trim(nq, " \"'`.,;:!?()[]")
	if trimmed == nq || trimmed == "" {
		return []string{nq}
	}
	return []string{nq, trimmed}
}

// normalise lowercases, maps look-alike punctuation to ASCII, drops invisible
// characters and collapses whitespace runs to one space. For every rune of the
// result it records the byte range of the original text it came from.
func normalise(s string) (norm string, origStart, origEnd []int) {
	var b strings.Builder
	prevSpace := true // also trims leading whitespace
	for i, r := range s {
		size := utf8.RuneLen(r)
		if r == utf8.RuneError {
			size = 1
		}
		switch {
		case isInvisible(r):
			continue
		case unicode.IsSpace(r) || r == ' ':
			if prevSpace {
				// extend the previous space's range over this whitespace run
				if n := len(origEnd); n > 0 && b.Len() > 0 && strings.HasSuffix(b.String(), " ") {
					origEnd[n-1] = i + size
				}
				continue
			}
			b.WriteByte(' ')
			origStart, origEnd = append(origStart, i), append(origEnd, i+size)
			prevSpace = true
		default:
			b.WriteRune(fold(r))
			origStart, origEnd = append(origStart, i), append(origEnd, i+size)
			prevSpace = false
		}
	}
	out := b.String()
	// Drop one trailing space (and its mapping) so " word " matches "word".
	if strings.HasSuffix(out, " ") {
		out = out[:len(out)-1]
		origStart, origEnd = origStart[:len(origStart)-1], origEnd[:len(origEnd)-1]
	}
	return out, origStart, origEnd
}

func fold(r rune) rune {
	switch r {
	case '‘', '’', '‛', 'ʼ':
		return '\''
	case '“', '”', '‟':
		return '"'
	case '‐', '‑', '‒', '–', '—', '―', '−':
		return '-'
	}
	return unicode.ToLower(r)
}

func isInvisible(r rune) bool {
	switch r {
	case '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad':
		return true
	}
	return false
}
