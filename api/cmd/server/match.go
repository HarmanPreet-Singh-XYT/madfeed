package main

import (
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"product/api/internal/ai"
	"product/api/internal/config"
	"product/api/internal/embed"
	"product/api/internal/intake"
	"product/api/internal/match"
)

// newMatcher builds the meaning-based matching service. With no OPENAI_API_KEY (or EMBED_PROVIDER=off) it has
// no embedder, and everything that needs one reports itself as off instead of failing.
func newMatcher(pool *pgxpool.Pool, cfg config.Config, judge match.Completer, budget ai.Budget, jc *river.Client[pgx.Tx], log *slog.Logger) *match.Service {
	s := &match.Service{Pool: pool, Judge: judge, Budget: budget, Jobs: jc}
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" || strings.EqualFold(os.Getenv("EMBED_PROVIDER"), "off") {
		return s
	}
	dim := match.VectorDim
	if v := os.Getenv("EMBED_DIMENSIONS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			dim = n
		}
	}
	if dim != match.VectorDim {
		log.Warn("EMBED_DIMENSIONS must be 512 (the database stores 512-number vectors): meaning-based matching is off")
		return s
	}
	base := os.Getenv("EMBED_BASE_URL")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	s.Embed = &embed.OpenAI{BaseURL: base, APIKey: key, ModelName: os.Getenv("EMBED_MODEL"), Dimensions: dim}
	s.PricePerMTokensUSD = 0.02 // text-embedding-3-small; override with EMBED_PRICE_PER_MTOKENS_USD
	if v, err := strconv.ParseFloat(os.Getenv("EMBED_PRICE_PER_MTOKENS_USD"), 64); err == nil && v >= 0 {
		s.PricePerMTokensUSD = v
	}
	return s
}

// suggesterOf hands extraction a matcher only when it can work, so a missing key is one line at start-up and
// not a warning on every item.
func suggesterOf(s *match.Service) intake.Suggester {
	if s == nil || !s.Ready() {
		return nil
	}
	return s
}
