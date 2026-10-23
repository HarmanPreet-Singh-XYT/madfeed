# Gate 2 record (in progress): context and weight

Date: 2026-10-22    Environment: local (Docker Postgres 18, Go 1.27.3, Node 26)
Status: **BUILT AND TESTED LOCALLY, GATE OPEN.** Email forward-in, saved views, real-model brief quality and partner trials are not done.

## Passed (evidence = tests; `make check` and `make e2e` green)

| Gate 2 item (`07`) | Result | Evidence |
|---|---|---|
| CSV import fixtures | PASS | `internal/directory`: clean, BOM, CRLF, semicolon/tab/pipe delimiters, quoted commas and newlines, swapped and renamed columns, missing columns (file-level error), invalid UTF-8, NUL bytes, over-size, broken quoting, ragged rows, header-only, 50,000 rows (imports in about 11 s with the race detector on). Every row problem names its row and column. A 20 s fuzz run of the parser found nothing. |
| No partial import without confirmation | PASS | the preview writes nothing; a file with problems imports nothing unless "leave out rows with problems" is chosen; re-importing the same file updates instead of duplicating; later files never blank values already known |
| Impact arithmetic | PASS | `internal/store` `TestImpactTotalsMatchABruteForce...`: 6 seeds x 120 random operations (add/remove/move evidence, move people between accounts, change/remove revenue, delete accounts and requests), every request compared with an independent Go calculation after every step. Disabling any of three triggers made it fail (mutation-checked). One account counts once however many quotes or people it has (also checked over HTTP: two people at one company = 100,000, not 200,000). |
| Brief: every quote verbatim | PASS (structural) | the model returns only quote **ids**; the text shown is the evidence row's own text, which the database already verified against the source. Invented, repeated, missing or not-offered ids are rejected. |
| Brief refusals | PASS | one quote: marked low-evidence and any generalising wording ("many", "growing", "customers", "across"...) is rejected; invented customer counts rejected; prompt injection cannot get an invented id through; the model never sees names, companies or money |
| Brief lifecycle | PASS | pending, ready, failed (with retry), stale when evidence changes (old text stays visible, flagged), free when already current, daily cap, background job, role checks, cross-tenant 404 |
| Quality panel | PASS | rates, edits, dismissals, by source and week and AI cost match hand-counted values exactly; "not enough data" under 20 decisions; a person's title change is stored on the suggestion and survives undo |
| Data export and re-import | PASS | `internal/portability`: export, import into a clean workspace with fresh ids; accounts, people, source text, requests, byte-exact quotes and computed impact identical; tampered quote, wrong version, unknown fields, dangling references, non-empty target and non-admins are refused and write nothing. A standalone `Verify` checks an export file with no database. |
| Performance | PASS | 10,000 requests / 100,000 quotes / 2,000 accounts / 6,000 people: list queries 0.7 to 0.9 ms, one account's value change recomputes impact in 7 ms; query plans contain no sequential scans; 100k quote insert 2.6 s |
| Browser flow, desktop and phone | PASS | `web/e2e/phase2.spec.ts` + earlier specs: 10 tests, run twice in a row. Covers CSV upload with a bad row and column auto-detection, people and companies, choosing who said it, adding to an existing request, company counted once, sort by revenue, brief pending then ready then stale, quality page, download of the export checked quote-by-quote against source offsets, viewer restrictions. axe finds no serious or critical issues on the new screens. |

## Bugs found by testing, now fixed
- Header "E-mail" was not recognised as an email column (normalisation mismatch).
- The API had no mapping for the directory errors, so a bad CSV returned a 500 instead of a readable 400.
- Pasting feedback attributed to a person from another workspace would have been a 500; it is a 400 with a plain message.
- After an import finished, the page refresh collapsed the import section and hid the success message.
- The web paste action dropped the chosen person (caught by the browser test).

## Not done (Gate 2 stays open)

| Item | Needs |
|---|---|
| Email forward-in (plain, HTML, attachments, replies, spam, forged sender) | Resend inbound capability check, sender domain, API key |
| Saved views and filters on requests | DONE 2026-10-23, see below |
| Brief claim support rated >= 4/5 by a human on 20 real briefs | a real model and partner data |
| Real-model behaviour of the brief prompt (does it comply with the thin-evidence rules without being rejected too often?) | AI key; the rejection rate is the number to watch |
| Manual L8 pass: run flow F3 on a seeded workspace and open ten random citations | a person |
| L9 partner step: assumption tests A2, A3, A5 with 2-3 partners | partners |
| Keyboard-only and screen-reader passes | a person |

## Known limits
- The export streams from one consistent snapshot, but the HTTP timeout wrapper buffers the response in memory, so very large workspaces need a different delivery path (a background export to storage) before they are supported.
- Import of an export file is a service and tested, but has no HTTP endpoint or screen yet.
- Briefs, review-queue state and AI events are not part of the export.
- Revenue has no currency; the UI shows plain numbers labelled "revenue".
- Prompt version is `brief-v1`. Each prompt change needs a gold-set run before it ships.


## Update 2026-10-23: saved views and filters (the open Gate 2 item)
- The request list filters by status, tag and a title search (plain text: `%`, `_` and `\` match themselves, a quote or SQL-looking text matches nothing), in both orders, with stable paging. Checked over HTTP: each filter and combinations, a tag from another workspace matches nothing, paging a filtered list neither skips nor repeats, bad values are refused by the contract.
- Saved views: typed columns with real foreign keys (a view cannot point at another workspace's status or tag), shared by the workspace, any editor can add, the creator or an admin can remove, names unique ignoring case, at most 50, a view with no filter and the default order is refused. Viewers can use views but not change them.
- Performance at 10,000 requests: worst-case search (matches nothing, so every title is read) takes about 3.5 ms; no extra index needed.
- Browser test (`views.spec.ts`, desktop and phone): filter, no-match message, save, duplicate name refused, apply a saved view, viewer restrictions, removal asks first. It caught a real bug: after "Clear filters" the dropdowns still showed the old choices (fixed).
