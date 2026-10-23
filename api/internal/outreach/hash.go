package outreach

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/google/uuid"

	"product/api/internal/store/dbgen"
)

// EmailHash is a keyed fingerprint of an address. It lets us keep honouring an opt-out after
// the address itself has been deleted; it cannot be turned back into the address without
// guessing it and holding the key.
func EmailHash(key []byte, email string) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("suppress-v1|" + strings.ToLower(strings.TrimSpace(email))))
	return hex.EncodeToString(mac.Sum(nil))
}

// suppressed is true if the address is on the list by name or, when a key is configured, by hash.
func suppressed(ctx context.Context, q *dbgen.Queries, key []byte, ws uuid.UUID, email string) (bool, error) {
	named, err := q.IsSuppressed(ctx, dbgen.IsSuppressedParams{WorkspaceID: ws, Email: email})
	if err != nil || named || len(key) == 0 {
		return named, err
	}
	return q.IsSuppressedHash(ctx, dbgen.IsSuppressedHashParams{WorkspaceID: ws, EmailHash: EmailHash(key, email)})
}

// RecordTombstones must run before a person's messages are deleted. For each message that was
// actually sent (so a link to it exists in someone's inbox) it keeps the link's id and the
// address hash.
func RecordTombstones(ctx context.Context, q *dbgen.Queries, key []byte, ws, personID uuid.UUID) error {
	if len(key) == 0 {
		return nil
	}
	rows, err := q.SentMessagesForPerson(ctx, dbgen.SentMessagesForPersonParams{WorkspaceID: ws, PersonID: personID})
	if err != nil {
		return err
	}
	for _, r := range rows {
		if err := q.InsertTombstone(ctx, dbgen.InsertTombstoneParams{WorkspaceID: ws, MessageID: r.ID, EmailHash: EmailHash(key, r.ToEmail)}); err != nil {
			return err
		}
	}
	return nil
}
