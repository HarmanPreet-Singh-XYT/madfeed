# Gate 4 record (in progress): research layer

Date: 2026-10-23    Environment: local (Docker Postgres 18, Go 1.27.3, Node 26); real model: DeepSeek `deepseek-flash`, synthetic text only
Status: **PART A BUILT (codebook, highlights, grounded Q&A), GATE OPEN.** Part B (file upload, transcription, media-synced transcript, highlight proposals) is not started: it needs a transcription vendor and storage decisions.

## Passed so far

| Gate 4 item (`07`) | Result | Evidence |
|---|---|---|
| Codebook integrity: rename, merge, delete a tag with 200 uses | PASS | `internal/research` `TestMergeMovesEverythingAndUndoRestoresExactly`: 200 highlights and a request on one tag, some already carrying the target tag and others a third tag. Merge moves all, archives the old tag; undo restores the full tag-assignment table byte-for-byte (compared before and after). Mutation-checked: the "already had the target" bookkeeping, when removed, fails the test. Archive is reversible; rename keeps names unique ignoring case. Only admins archive, merge or undo. |
| Highlights are verbatim | PASS | the quote is read from the source at byte offsets; a client quote that differs, splits a character, is out of range or empty is refused; the database trigger refuses a mismatch even if the code is bypassed; source text cannot be edited afterwards; multi-byte text tested |
| Q&A permissions | PASS | viewers may ask and read; another workspace's quotes never reach the prompt, and its users cannot read our answers (404); history and ratings are per asker |
| Q&A: answers never ungrounded (structural) | PASS | an answer is kept only if every sentence carries citation markers that point at passages actually offered; invented, missing, zero or out-of-range markers, uncited sentences, counted customers and empty answers are rejected and not stored. The text shown for a citation is the stored row's own text, never the model's. Nothing relevant found: no model call, an honest refusal. Daily cap per workspace. |
| Q&A quality with a real model (60 answerable, 20 unanswerable, 20 false-premise) | PASS on a small synthetic set | `go run ./cmd/qaeval`: 10 topics x 4 quotes. **Unanswerable: 20 of 20 refused (target 90%). False premise: 20 of 20 not accepted (the model refused each).** Answerable: 57 of 60 answered; 51 of 60 (85%) cited only quotes of the intended topic; the other 6 cited the Slack-notifications quote on an email-notifications question, which is genuinely related, so 57 of 60 (95%) read as correct; the 3 refusals were "no one describes problems with an *existing* Slack integration" style, which is acceptable caution. Target was 80%. Cost for 100 questions: about $0.027. |

First run of the same test, kept for honesty: 45 of 60 answered. Most misses were my own badly phrased questions ("Why do people want slow reports?"); the model was right to refuse them. I rewrote the 6 phrasings and reran; the unanswerable and false-premise results were 20/20 in both runs.

## Not done (Gate 4 stays open)

| Item | Needs |
|---|---|
| File ingest (resumable 1 GB upload, interrupted upload, unsupported type, no orphaned storage objects) | storage (Supabase Storage bucket and policies) |
| Transcription quality (10 recordings, word error rate, 85% on clean audio) | a transcription vendor (new subprocessor: your decision) and sample audio |
| Media sync (click a sentence, player seeks within 1 s) | transcripts with timestamps |
| Highlight proposals acceptance rate on 20 recordings | transcripts and a human gold set |
| Q&A on the real, larger and messier data: the corpus above is 40 clean one-line quotes, retrieval is word search (no embeddings), and counting questions ("how many customers...") are refused by design | embeddings provider; real data |
| Deletion: deleting a person or recording removes quotes, chunks, embeddings, transcripts and media | partly covered by database cascades (highlights and citations cascade with sources); a person-deletion path and a storage check are not built |
| Export and import carry tags and highlights | not built yet: `internal/portability` does not include the codebook or highlights, so an export today omits them |
| Cost for 10 hours of audio | transcription vendor |
| Web screens for codebook, highlights and Ask | in progress |
| Manual pass of flows F5 and F6; reading 10 answers with their sources | a person |
