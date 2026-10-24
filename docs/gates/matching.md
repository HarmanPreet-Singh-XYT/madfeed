# Meaning-based matching and search

Built 2026-10-24 (`api/internal/match`, `api/internal/embed`, migration 41).

- **What it does.** When extraction finishes, each new proposal is compared by meaning with the existing requests. The five closest above a similarity floor go to a small-tier model that must say whether one is clearly the same need. Only an answer with confidence 0.80 or more is stored, and only as a suggestion on the proposal ("This may be the same as ..."). A person presses the button; nothing merges alone. Without a judge only a very close match (0.75) is suggested, without a reason.
- **Search by meaning** on the Quotes screen. Quotes are indexed lazily by a background job the first time anyone searches.
- **Guarantees tested.** Another workspace's requests and quotes are never candidates; vectors from different models are never compared (a model change re-embeds); a failing matcher never fails extraction; the judge is not called below the similarity floor; a weak or "none" answer is not a suggestion; every embedding call is logged (`ai_event`, task `embedding`) and checked against the allowance.
- **Not measured.** How often a real model's suggestion is wrong. See `docs/OWNER-TODO.md` section I.
- **Limits.** Brute-force search per workspace (no ANN index): fine to roughly 100,000 quotes; add an HNSW index per workspace beyond that.
