package portability

import (
	"crypto/sha256"
	"encoding/hex"
)

// contentHash matches how intake fingerprints pasted text (sha256 of the text),
// so an imported source still de-duplicates against a later paste.
func contentHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
