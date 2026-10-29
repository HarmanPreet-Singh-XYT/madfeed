// Package fulltext turns what a person typed into a safe Postgres full-text
// query. The input is never passed through as syntax: only letters and digits
// survive, so a stray quote or a `!` cannot change the meaning of the search.
package fulltext

import (
	"strings"
	"unicode"
)

// maxWords caps the work a single search can ask of the database.
const maxWords = 8

// Query builds a `to_tsquery` string from plain words: every word is required.
func Query(s string) string {
	words := strings.FieldsFunc(s, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	if len(words) > maxWords {
		words = words[:maxWords]
	}
	return strings.Join(words, " & ")
}
