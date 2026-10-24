# Forms and surveys from other tools

For a simple "tell us what you think" form, the built-in website form (Settings, Feedback form) and surveys (Surveys) need no connection at all. Use this route only if the form lives in another tool.

1. In the form tool (or an automation service, see [automation.md](automation.md)) send each new response to `POST /v1/ext/feedback` ([README](README.md)).
2. Map the fields:
   - `source`: the form's name
   - `externalId`: the response id
   - `email`: the respondent's email, if the form asks for it
   - `text`: only the free-text answers, each on its own paragraph and starting with the question, for example `What would make this better? More export options.` Ratings and multiple choice answers carry little meaning as a note; leave them out.
3. Skip responses where the free-text answer is empty.

**Not verified against the live tools.** Try one response first.
