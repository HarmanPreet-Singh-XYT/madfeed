# Cold test and screen-reader pass (Gate 5, needs a person)

## Cold test (about 40 minutes, one sitting)

Pick someone who has never seen the product: a teammate from another team, a friend who works in product or support. Do **not** explain anything. Sit beside them (or share their screen), take notes, and stay silent unless they are stuck for more than two minutes; then note it and give the smallest hint.

Before they arrive: a workspace they have not seen; the sign-in set up (a Supabase account for them, or the development sign-in); a short real-looking customer conversation they can paste (a support call or an email thread, 300 to 800 words) and a CSV of 5 to 10 customers (name, email, company, annual revenue).

Say only: "This tool turns customer conversations into requests you can prioritise, and tells customers when you ship what they asked for. Please do these four things, and say out loud what you expect and what confuses you."

| # | Task | Done unassisted? | Minutes | What they said or hesitated on |
|---|---|---|---|---|
| F1 | Sign in, add the conversation, accept one suggestion, find the request and the exact sentence it came from | | | |
| F2 | Add the customers, then add a second conversation from a named customer and add it to the same request | | | |
| F3 | Open the request, read the brief, and decide whether to build it; set a status | | | |
| F4 | Mark it shipped, review the messages it prepared, edit one, and approve (use the local mail stand-in: nothing real is sent) | | | |

Record afterwards: time to the first accepted request (target under 5 minutes); every moment they said "what does this mean?"; any word they misread (request, evidence, tag); anything they tried that did not exist; whether they understood that nothing is sent until approved.

Pass: all four done with at most two hints in total, and no one thought a message had been sent when it had not. Anything else is a finding: log it as S2 (task could not be completed) or S3 (hesitation), fix, and repeat with a different person.

## Screen-reader pass (about 30 minutes)

Use VoiceOver (macOS: Cmd+F5) with Safari, and again with NVDA and Firefox on Windows if you have it. Keyboard only.

- [ ] Sign-in page: both fields announce their labels; an error is announced when it appears.
- [ ] The skip link is the first thing reached and moves you to the main content.
- [ ] The workspace navigation announces "sections" and the current page.
- [ ] Review queue: a suggestion's quote, title and Accept button are read in a sensible order; after accepting, you hear that the list changed.
- [ ] Request page: the status select announces its value; the "shipping" confirmation is announced when it opens.
- [ ] Transcript page: each line's play button announces the time and speaker; the audio player is reachable.
- [ ] Ask: the answer is announced when it arrives; each citation number links to its quote.
- [ ] Every button that says only a symbol or a short word still says what it acts on ("Delete Interview 1.wav", not "Delete").
- [ ] Nothing important is conveyed by colour alone (tag colours always come with the tag name).

Log each failure with the screen, the step and what was announced.
