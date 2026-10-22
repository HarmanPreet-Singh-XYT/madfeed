// Package email defines how the app sends transactional mail. The send path
// for customer-facing messages lives in the outreach code, which must check
// the approved state before calling Sender; this package only delivers.
package email

import (
	"context"
	"errors"
)

type Message struct {
	From, ReplyTo string
	To            []string
	Subject       string
	Text, HTML    string
	// IdempotencyKey makes retries safe: the same key never sends twice.
	// Use a stable id such as the outreach_message id.
	IdempotencyKey string
	Tags           map[string]string // opaque ids for analytics; never personal data
}

type Sender interface {
	Send(ctx context.Context, m Message) (providerID string, err error)
}

// ErrTransient means retrying later may succeed (rate limit, outage).
// ErrPermanent means the message itself or our credentials are wrong; do not retry.
var (
	ErrTransient = errors.New("email: transient failure")
	ErrPermanent = errors.New("email: permanent failure")
)
