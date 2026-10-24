# Sending feedback in from other tools

Any tool that can send a web request (most help desks, form tools and automation services can) can put feedback in the review queue. Nothing becomes a request until a person accepts a suggestion.

## The endpoint
`POST {API address}/v1/ext/feedback` with a key that has the **Add notes to the review queue** permission (Settings, API keys). Send the key as `Authorization: Bearer fk_…` and a JSON body:

| Field | Required | What it is |
|---|---|---|
| `text` | yes | The words to read, up to 20,000 characters. For a ticket, put the whole thread in; say who is speaking ("Customer:", "Agent:") so quotes are attributed correctly. |
| `source` | no | Where it came from, for example `Help desk` or `Signup form` (40 characters). Shown at the start of the title. |
| `title` | no | For example the ticket subject (160 characters). |
| `url` | no | A link back to the original (http or https). |
| `externalId` | no | The original's id in the other tool. Sending the same id from the same `source` again stores it once, even if the text was edited. Always set this when the tool can retry. |
| `email` | no | Who said it. If a person with this email exists, the note is theirs (so their account's value counts). Nobody is created from it. The address is kept only so they can be erased later. |

Answer `202 {"received": true, "duplicate": false}`. `duplicate: true` means it was already there.

```sh
curl -sS -X POST "$API/v1/ext/feedback" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"source":"Help desk","title":"Ticket 1042","externalId":"1042",
       "url":"https://desk.example.com/tickets/1042","email":"dana@acme.com",
       "text":"Customer: we keep asking for SSO.\n\nAgent: noted."}'
```

## Limits and safety
- A key may add 500 notes a day and make 120 requests a minute; the workspace's daily reading allowance also applies. Over a limit you get `429`; retry later.
- Card numbers, keys and passwords are hidden before anything is stored or read by a model.
- Use a key just for this, with only that one permission, so it can be revoked on its own. Its activity is listed under the key.
- Notes are untrusted text. The review queue shows what was found and a person decides.

## Per-tool notes
The names of screens in other tools change; these recipes say what to send and where it goes, not which button to press.
- [Help desks](help-desks.md): Intercom, Zendesk, Help Scout, Freshdesk and similar.
- [Forms and surveys from other tools](forms.md): Typeform, Google Forms, SurveyMonkey and similar.
- [Automation services](automation.md): Zapier, Make and similar, including going the other way with outbound messages.
- [Call recordings and transcripts](calls.md): `POST /v1/ext/transcripts` takes WebVTT, SRT, JSON speaker turns or plain text.
- [Review sites and app stores](reviews.md).
- Email: forward customer email to the inbound address under Settings, Inbox (signed JSON route); see the inbox settings screen.
