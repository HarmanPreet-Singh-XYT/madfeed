# Outbound webhooks

Built 2026-10-24 (`api/internal/hooks`, migration 44, `docs/webhooks.md`). Step 1 of `docs/INTEGRATIONS-PLAN.md`.

- **What it does.** Admins add https addresses and pick events (request created, status changed, suggestions ready, release note published, survey finished). Each event becomes a signed JSON message (HMAC-SHA256 over time and body), retried with backoff, switched off after 30 failures in a row, history kept 30 days.
- **Outbox.** Events are written in the same transaction as the change (`hooks.Emit`), so a rolled-back change sends nothing; a loop in the worker delivers them, claiming rows with `FOR UPDATE SKIP LOCKED` and a two-minute lease so several workers cannot double-send.
- **Tested.** Signature verifies and differs per secret; same event id on every retry; backoff and give-up; auto-pause and re-enable; test button; admin-only on every route (and the generated viewer, stranger and anonymous sweeps); another workspace's events never reach an endpoint; private, loopback, link-local, shared-range and `.internal` addresses refused when saved and when dialling; redirects not followed; secrets sealed at rest and never listed; real status changes, accepted suggestions and release notes queue the right messages and carry no quote text; browser test at desktop and phone size with axe.
- **Not tested.** Any real receiving service.
- **Limits.** Scheduled release notes send nothing when they go live. Events are at-least-once and unordered. Payloads are small and fixed; there is no per-endpoint filter beyond the event type.
