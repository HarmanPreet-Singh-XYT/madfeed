package cache

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"time"
)

const macLen = sha256.Size

// signed puts a keyed signature on every value it stores and treats anything without a valid one as missing.
// What the cache holds decides who may do what (a role, an API key's permissions, a plan), so a value written
// by anyone who merely reaches Redis must never be believed. The signature covers the key as well as the value,
// so an entry cannot be copied under another key. Counters (Hit) and deletes carry no meaning to forge.
type signed struct {
	Store
	secret []byte
}

// Sign wraps s so that only values written with secret are ever read back.
func Sign(s Store, secret []byte) Store { return &signed{Store: s, secret: secret} }

func (c *signed) mac(key string, val []byte) []byte {
	m := hmac.New(sha256.New, c.secret)
	m.Write([]byte(key))
	m.Write([]byte{0})
	m.Write(val)
	return m.Sum(nil)
}

func (c *signed) Set(ctx context.Context, key string, val []byte, ttl time.Duration) error {
	out := append(c.mac(key, val), val...)
	return c.Store.Set(ctx, key, out, ttl)
}

func (c *signed) Get(ctx context.Context, key string) ([]byte, bool, error) {
	v, ok, err := c.Store.Get(ctx, key)
	if err != nil || !ok {
		return nil, false, err
	}
	if len(v) < macLen {
		return nil, false, nil
	}
	body := v[macLen:]
	if !hmac.Equal(v[:macLen], c.mac(key, body)) {
		return nil, false, nil // not ours: ignore it
	}
	return body, true, nil
}
