package cache

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Every key that holds workspace data names the workspace (and the person, when it is per person), so one
// tenant's entry can never answer for another's. Whoever writes the data deletes the key, after the commit.
const (
	TenantTTL = 30 * time.Second // role of a person in a workspace
	PlanTTL   = 60 * time.Second // raw billing account of a workspace
	KeyTTL    = 30 * time.Second // what an API key may do (never longer than the key itself lasts)
)

func TenantKey(ws, user uuid.UUID) string { return "tenant:" + ws.String() + ":" + user.String() }
func PlanKey(ws uuid.UUID) string         { return "plan:" + ws.String() }

// APIKeyKey is named by the key's stored hash (never the secret).
func APIKeyKey(hash string) string { return "apikey:" + hash }

// ForgetAPIKeys drops remembered keys by their stored hashes. Whoever ends or changes a key calls it after the
// commit, so a revoked key stops working at once instead of when its entry runs out.
func ForgetAPIKeys(ctx context.Context, c Store, hashes ...string) {
	if c == nil || len(hashes) == 0 {
		return
	}
	keys := make([]string, len(hashes))
	for i, h := range hashes {
		keys[i] = APIKeyKey(h)
	}
	del(ctx, c, "apikey", keys...)
}

// ForgetTenant drops what is remembered about people's roles in a workspace. A nil Store does nothing, so
// services that were built without a cache need no checks. A failure is logged and retried (see Persist);
// if it never succeeds the entry expires on its own within TenantTTL.
func ForgetTenant(ctx context.Context, c Store, ws uuid.UUID, users ...uuid.UUID) {
	if c == nil || len(users) == 0 {
		return
	}
	keys := make([]string, len(users))
	for i, u := range users {
		keys[i] = TenantKey(ws, u)
	}
	del(ctx, c, "tenant", keys...)
}

// ForgetPlan drops the remembered billing account of a workspace.
func ForgetPlan(ctx context.Context, c Store, ws uuid.UUID) {
	if c == nil {
		return
	}
	del(ctx, c, "plan", PlanKey(ws))
}
