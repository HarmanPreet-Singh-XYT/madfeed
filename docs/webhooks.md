# Outbound webhooks

An admin adds a web address under Settings, "Messages to other tools", and picks events. Each event is then sent to that address as a signed JSON POST. This is how an automation service, a chat channel or your own code reacts to what happens here.

## Events
| Type | When | `data` |
|---|---|---|
| `request.created` | a suggestion was accepted and started a new request | `requestId`, `title` |
| `request.status_changed` | a request moved to a different status (by a person, or by an issue closing in a connected tracker) | `requestId`, `title`, `fromStatusId`, `fromBucket`, `toStatusId`, `toStatusName`, `toBucket` |
| `suggestions.ready` | reading a new piece of feedback finished and found suggestions | `sourceItemId`, `count` |
| `release_note.published` | a person published a release note now (a note scheduled for later sends nothing) | `noteId`, `title` |
| `survey.response_completed` | someone finished a survey | `surveyId`, `responseId` |
| `ping` | the "Send a test" button | `message` |

Messages carry ids, statuses and titles of your own requests. They never carry customer quotes, names or email addresses; fetch details through the API if you need them.

## Chat channels
An address can be a chat channel instead of a program: choose "A message for a Slack channel", "Discord channel" or "Microsoft Teams channel" and paste the incoming-webhook address that tool gives you. Each event then arrives as one plain sentence ("Request “Dark mode” moved to Planned") with a link to the app, in that tool's message format (Slack `{"text"}`, Discord `{"content"}`, Teams an Adaptive Card message). Request titles are written from customer words, so they are made safe first: Slack's `<` `>` `&` are escaped, Discord messages carry `allowed_mentions: none`, and markdown in titles is escaped for Discord and Teams. These addresses are still sent the signature headers, which chat tools ignore. Not tried against the real tools; Teams' format is the one used by its "Workflows" webhooks and may differ in your tenant.

## Shape
```json
{ "id": "…event id…", "type": "request.status_changed", "createdAt": "2026-10-24T17:00:00Z",
  "workspaceId": "…", "data": { … } }
```
Headers: `Webhook-Id` (the event id, identical on every retry; use it to drop duplicates), `Webhook-Event` (the type), `Webhook-Signature`, `Content-Type: application/json`.

## Checking the signature
`Webhook-Signature` is `t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 over `"<t>.<raw body>"` using the signing secret shown when the address was added. Recompute it on the raw body, compare in constant time, and reject messages whose `t` is more than a few minutes from your clock. A new secret can be made at any time ("New secret"); it is shown once.

## Delivery
- Answer with any 2xx within 10 seconds. Redirects are not followed.
- Anything else is retried after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h; after 8 attempts the message is marked failed.
- 30 failed attempts in a row switch the address off (the history says so); an admin switches it back on.
- Messages and their history are kept 30 days. Deleting an address deletes its history.
- Delivery is at least once and not strictly ordered. Treat `Webhook-Id` as the idempotency key.

## Safety
- Addresses must be `https://`. Names or addresses that point inside a private network (localhost, 10.x, 192.168.x, link-local and cloud metadata addresses, and so on) are refused when saved and again when connecting, so a name that later resolves to one is also refused.
- Signing secrets are sealed with `SECRETS_KEY` at rest; the list never returns them.
- Only admins can add, change, test or remove addresses. An event is written in the same transaction as the change, so a rolled-back change sends nothing.
- `WEBHOOKS_ALLOW_PRIVATE=true` (development only, refused in production) lets local test receivers be used.
