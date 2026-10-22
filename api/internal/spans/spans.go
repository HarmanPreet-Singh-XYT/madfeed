// Package spans is the one place that knows how quotes map to source text.
// All offsets are BYTE offsets into the UTF-8 source, always on rune
// boundaries. A quote is only ever stored if it equals source[start:end].
package spans

import (
	"errors"
	"strings"
	"unicode/utf8"
)

var (
	ErrEmptyQuote   = errors.New("spans: empty quote")
	ErrOutOfRange   = errors.New("spans: span out of range")
	ErrNotRuneAlign = errors.New("spans: span splits a character")
	ErrMismatch     = errors.New("spans: quote does not match source at span")
	ErrNotFound     = errors.New("spans: quote not found verbatim in source")
)

// Validate reports nil only if quote is exactly text[start:end] on rune boundaries.
func Validate(text string, start, end int, quote string) error {
	if quote == "" || strings.TrimSpace(quote) == "" {
		return ErrEmptyQuote
	}
	if start < 0 || end <= start || end > len(text) {
		return ErrOutOfRange
	}
	if !runeBoundary(text, start) || !runeBoundary(text, end) {
		return ErrNotRuneAlign
	}
	if text[start:end] != quote {
		return ErrMismatch
	}
	return nil
}

// Locate finds quote verbatim in text and returns its byte span. It uses the
// first occurrence. Near-matches (changed whitespace, smart quotes, case) are
// rejected on purpose: a paraphrase must never be stored as a quote.
func Locate(text, quote string) (start, end int, err error) {
	if strings.TrimSpace(quote) == "" {
		return 0, 0, ErrEmptyQuote
	}
	i := strings.Index(text, quote)
	if i < 0 {
		return 0, 0, ErrNotFound
	}
	// strings.Index on valid UTF-8 returns rune-aligned matches; check anyway
	// so invalid UTF-8 input cannot slip through.
	if err := Validate(text, i, i+len(quote), quote); err != nil {
		return 0, 0, err
	}
	return i, i + len(quote), nil
}

func runeBoundary(s string, i int) bool {
	return i == 0 || i == len(s) || utf8.RuneStart(s[i])
}

// Chunk is a contiguous slice of the source. Chunks tile the text exactly:
// concatenating them in order reproduces it byte for byte.
type Chunk struct {
	Ordinal    int
	Start, End int
	Text       string
}

// Split cuts text into chunks of at most maxBytes, preferring paragraph, then
// line, then sentence, then word boundaries, and never splitting a character.
// maxBytes must be at least utf8.UTFMax.
func Split(text string, maxBytes int) []Chunk {
	if maxBytes < utf8.UTFMax {
		maxBytes = utf8.UTFMax
	}
	var out []Chunk
	pos := 0
	for pos < len(text) {
		end := pos + maxBytes
		if end >= len(text) {
			end = len(text)
		} else {
			end = bestBreak(text, pos, end)
		}
		out = append(out, Chunk{Ordinal: len(out), Start: pos, End: end, Text: text[pos:end]})
		pos = end
	}
	return out
}

func bestBreak(text string, pos, limit int) int {
	window := text[pos:limit]
	// Candidate break points, best first. Each returns an index just past the separator.
	for _, sep := range []string{"\n\n", "\n", ". ", "? ", "! ", " "} {
		if i := strings.LastIndex(window, sep); i > 0 {
			return pos + i + len(sep)
		}
	}
	// No separator: cut at the last rune boundary at or before the limit.
	end := limit
	for end > pos && !utf8.RuneStart(text[end]) {
		end--
	}
	if end == pos { // cannot happen when maxBytes >= UTFMax, but never loop forever
		_, size := utf8.DecodeRuneInString(text[pos:])
		end = pos + size
	}
	return end
}
