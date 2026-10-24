# Call recordings and transcripts

Most call tools can export or send a transcript. Send it to `POST /v1/ext/transcripts` (same key and limits as the [inbound endpoint](README.md): a key with the "Add notes to the review queue" permission). It is read like any pasted conversation: suggestions with the exact quote, which a person accepts or dismisses.

## Body
Either `transcript` (text) or `turns` (a list), plus the optional `source`, `title`, `url`, `externalId` and `email` fields from the README. `externalId` should be the call's id in the other tool, so a re-sent call is stored once.

- `transcript` formats, guessed unless you set `format` to `auto`, `text`, `vtt`, `srt` or `json`:
  - **WebVTT** and **SRT** subtitle files. A speaker is taken from a `<v Name>` tag or a `Name:` at the start of a cue; a cue with no speaker carries on the previous turn.
  - **JSON** with speaker turns. A list of `{speaker, text}` objects, or an object holding such a list under `turns`, `segments`, `utterances`, `transcript`, `monologues`, `sentences`, `entries`, `results` or `paragraphs`; a turn made of `sentences` is joined. Speaker may be a name, an object with a `name`, or a number (shown as "Speaker 0").
  - **Plain text** is kept as written. Put the speaker's name at the start of each turn.
- `turns`: `[{"speaker": "Dana", "text": "…"}]`, up to 5,000 turns.

Timing is dropped; speakers are kept; neighbouring turns by the same speaker are joined. Markup tags are removed. Card numbers, keys and passwords are hidden before storing. The answer says how many turns were read and the format used.

```sh
curl -sS -X POST "$API/v1/ext/transcripts" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"source":"Call tool","title":"Acme QBR","externalId":"call-77","email":"dana@acme.com",
       "transcript":"WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Dana>We keep asking for single sign-on.</v>"}'
```

## Limits
- At most about 200,000 bytes of text per call (several hours of talk). Longer calls must be split by topic or time first; the answer says so.
- If the call was with one customer, set `email` so the quotes count for their account. For a call with several customers, leave it out.
- Nothing here has been run against a real call tool's export; try one call and read the suggestions.

## Without the API
Upload the recording itself on the Add page (it is transcribed here) or paste the transcript there.
