# Call recordings and transcripts

Until transcript import is built (step 3 in `docs/INTEGRATIONS-PLAN.md`), two routes work today:
- Upload the recording itself (Add, Recording): it is transcribed here and highlights can be suggested.
- Paste the transcript from your call tool into Add, Paste. Put the speaker's name at the start of each turn. Or send it through [the inbound endpoint](README.md) with `source` set to the call tool's name, the call's id as `externalId` and a link in `url`.
Very long transcripts (over 20,000 characters) must be split by topic or time before sending.
