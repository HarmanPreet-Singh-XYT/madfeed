package publicsite

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"product/api/internal/ratelimit"
)

func pgxText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

// Throttle is the form's allowance: 20 submissions a minute per workspace, and 20 a day per
// caller address, so one source cannot use up the workspace's share of the day.
func Throttle(lim *ratelimit.Limiter, perMinute, perAddrDay int) func(ctx context.Context, workspaceID, addr string) bool {
	return func(ctx context.Context, ws, addr string) bool {
		if addr != "" && !lim.Allow(ctx, "form-addr", ws+"|"+addr, perAddrDay, 86400).Allowed {
			return false
		}
		return lim.Allow(ctx, "form", ws, perMinute, 60).Allowed
	}
}
