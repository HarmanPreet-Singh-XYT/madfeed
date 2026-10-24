# Help desks

**Goal:** when a ticket closes (or is tagged, for example `feedback`), send its conversation here.

**Easiest route, any help desk with automations or webhooks:**
1. In the help desk, make a rule: when a ticket is solved (or gets the tag `feedback`), call a webhook / send a web request. If it can only call a webhook with its own fixed format, use an automation service in between ([automation.md](automation.md)) to reshape it.
2. The request is `POST /v1/ext/feedback` with the key as a bearer token (see [README](README.md)).
3. Map the fields:
   - `source`: the help desk's name
   - `title`: ticket subject
   - `externalId`: ticket id (so a re-solved ticket is not stored twice)
   - `url`: the ticket's link
   - `email`: the requester's email
   - `text`: the conversation, oldest first, one message per paragraph, each starting with who wrote it (`Customer:` or `Agent:`). Leave out internal notes and signatures if you can.

**Tips**
- Send only tickets that contain product feedback (a tag or a category), or the review queue fills with "where is my order".
- One ticket, one note. Do not send every reply separately.
- If the help desk can send only the last message, that is fine for short tickets; for long ones use its API in the automation service to fetch the whole thread first.

**Not verified against the live tools.** Nothing here has been run against a real help desk; try with one test ticket and look at the review queue.
