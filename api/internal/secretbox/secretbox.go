// Package secretbox encrypts the credentials we keep for other services (a chat workspace's token, an
// issue tracker's token) so a copy of the database alone does not give them away. AES-256-GCM, a fresh
// random nonce for every value, and the owner of the value (its workspace and purpose) bound in as
// associated data, so a sealed value cannot be moved to another workspace's row and still open.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
)

// Box seals and opens values with one key.
type Box struct {
	aead cipher.AEAD
	key  []byte
}

var ErrOpen = errors.New("secretbox: cannot open (wrong key, wrong owner or damaged)")

const version = 1

// New builds a Box from a base64 (standard or URL) 32-byte key, as set in SECRETS_KEY.
func New(b64 string) (*Box, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		raw, err = base64.RawURLEncoding.DecodeString(b64)
	}
	if err != nil || len(raw) != 32 {
		return nil, fmt.Errorf("SECRETS_KEY must be 32 random bytes, base64 encoded (for example: openssl rand -base64 32)")
	}
	block, err := aes.NewCipher(raw)
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: g, key: raw}, nil
}

// Derive makes a separate key for another purpose (for example signing a sign-in redirect) from the
// same secret, so one setting covers both and the keys never equal each other.
func (b *Box) Derive(purpose string) []byte {
	m := hmac.New(sha256.New, b.key)
	m.Write([]byte("derive-v1|" + purpose))
	return m.Sum(nil)
}

// Seal encrypts plaintext for the given owner (for example "workspace-uuid|slack").
func (b *Box) Seal(plaintext []byte, owner string) []byte {
	nonce := make([]byte, b.aead.NonceSize())
	_, _ = rand.Read(nonce)
	out := append([]byte{version}, nonce...)
	return b.aead.Seal(out, nonce, plaintext, []byte(owner))
}

// Open decrypts a value sealed for the same owner.
func (b *Box) Open(sealed []byte, owner string) ([]byte, error) {
	n := b.aead.NonceSize()
	if len(sealed) < 1+n+b.aead.Overhead() || sealed[0] != version {
		return nil, ErrOpen
	}
	pt, err := b.aead.Open(nil, sealed[1:1+n], sealed[1+n:], []byte(owner))
	if err != nil {
		return nil, ErrOpen
	}
	return pt, nil
}
