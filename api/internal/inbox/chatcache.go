package inbox

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"product/api/internal/cache"
)

// A chat window asks for news every few seconds, and almost every answer is "nothing". After a poll finds
// nothing, the API remembers that for the visitor, tagged with a version. Anything that adds a message the
// visitor can see sets a new version, so the next poll sees the mismatch and asks the database. The remembered
// answer is only ever "nothing new", so skipping the database can delay nothing and reveal nothing.
const (
	// chatMarksPerMinute caps how many "nothing new" markers one workspace can create a minute. The widget's
	// token is public and the visitor id is chosen by the browser, so without a cap anyone could fill Redis with
	// markers. Past the cap a poll simply asks the database, as it did before the cache existed.
	chatMarksPerMinute = 600

	chatIdleTTL = 60 * time.Second
	chatVerTTL  = time.Hour // longer than chatIdleTTL, so a version cannot expire under a live marker
)

type chatIdle struct {
	Ver    string `json:"v"`
	Origin string `json:"o"`
	After  int    `json:"a"`
}

func chatVerKey(ws uuid.UUID, visitor string) string { return "chatver:" + ws.String() + ":" + visitor }
func chatIdleKey(ws uuid.UUID, visitor string) string {
	return "chatidle:" + ws.String() + ":" + visitor
}

// chatVersion is the visitor's current version; empty when none has been set.
func (s *Service) chatVersion(ctx context.Context, ws uuid.UUID, visitor string) string {
	v, ok, err := s.Cache.Get(ctx, chatVerKey(ws, visitor))
	if err != nil || !ok {
		return ""
	}
	return string(v)
}

// chatIdleNow says whether a poll for messages after `after` can be answered "nothing new" without the
// database, and returns the version to tag a fresh answer with.
func (s *Service) chatIdleNow(ctx context.Context, ws uuid.UUID, visitor, origin string, after int) (ver string, idle bool) {
	if s.Cache == nil {
		return "", false
	}
	ver = s.chatVersion(ctx, ws, visitor)
	raw, ok, err := s.Cache.Get(ctx, chatIdleKey(ws, visitor))
	if err != nil || !ok {
		return ver, false
	}
	var m chatIdle
	if json.Unmarshal(raw, &m) != nil {
		return ver, false
	}
	return ver, m.Ver == ver && m.Origin == origin && after >= m.After
}

// chatMarkIdle records that nothing newer than `after` existed when the poll began at version ver.
func (s *Service) chatMarkIdle(ctx context.Context, ws uuid.UUID, visitor, origin string, after int, ver string) {
	if s.Cache == nil {
		return
	}
	if n, _, err := s.Cache.Hit(ctx, "chatmarks:"+ws.String(), time.Minute); err != nil || n > chatMarksPerMinute {
		return
	}
	if v, err := json.Marshal(chatIdle{Ver: ver, Origin: origin, After: after}); err == nil {
		_ = s.Cache.Set(ctx, chatIdleKey(ws, visitor), v, chatIdleTTL)
	}
}

// chatChanged tells the visitor's next poll to ask the database. Call it after the commit that added a message
// the visitor can see (their own, or a team reply).
func (s *Service) chatChanged(ctx context.Context, ws uuid.UUID, visitor string) {
	if s.Cache == nil || visitor == "" {
		return
	}
	// Retried if Redis is briefly away: a visitor must not wait out the marker because one write was dropped.
	cache.Persist(ctx, "chat", func(ctx context.Context) error {
		return s.Cache.Set(ctx, chatVerKey(ws, visitor), []byte(uuid.NewString()), chatVerTTL)
	})
}
