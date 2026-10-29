# What each page contains

A plain inventory of every screen: what it shows, the buttons and forms on it, and what it lets someone do. It says nothing about layout or looks. It is meant as a checklist for the UI redesign: anything listed here has to survive it.

Roles: **admin** (everything), **member** (add, review, reply, edit), **viewer** (read and search only). Where a control is limited to a role, it says so.

Sections: [Signed-out pages](#signed-out-pages) · [Workspace app](#workspace-app) · [Settings sections](#settings-sections) · [Pages customers see](#pages-customers-see) · [Marketing site](#marketing-site)

---

## Signed-out pages

### Sign in (`/login`)
- Email and password form with a **Sign in** button.
- **Forgot your password?** link and **Create an account** link.
- If company sign-in is on: a **Use my work email address** link, plus one **Continue with …** button per configured provider.
- Shows an error if company sign-in failed. The email you typed is kept after a failed attempt.
- In local development only, a name-only sign-in replaces all of this.

### Create an account (`/signup`)
- Email, password (at least 10 characters) and password-again fields, with **Create account**.
- After submitting: a "check your email" message with a link back to sign in.
- Link to sign in instead. Remembers where you were going.

### Forgot password (`/forgot`)
- Email field and **Send reset link**. The confirmation is the same whether or not the address exists.
- Link back to sign in.

### Choose a new password (`/reset`)
- New password and password-again fields with **Set password and sign in**.
- If the link has expired: a message and an **Ask for a new one** link.

### Sign in with your company (`/login/sso`)
- Work email field and a button that sends you to your company's own sign-in.
- Link to sign in with a password instead.

### Join a workspace (`/invite/[token]`)
- Explains the invitation and which workspace it is for.
- **Join** and **Sign out** buttons, shown depending on whether you are signed in with the invited address.
- Messages for an expired or used link, or for being signed in with a different or unconfirmed address.

### Connect an AI assistant (`/oauth/authorize`)
- Shows which assistant is asking, and a choice of which workspace it may use.
- **Approve** and **Cancel** buttons. Only admins can approve.
- States that the assistant never sees names or email addresses and that access can be removed in Settings.
- Error messages for an incomplete link or an unregistered return address.

### Connecting Slack (`/integrations/slack/callback`)
- Finishes the Slack connection and sends you back to Settings.
- If it failed: the reason, a **Go back and try again** link.

---

## Workspace app

Every page below sits inside a workspace. The left navigation lists only the areas the workspace has switched on:
Inbox · Add feedback · Review (with a count of waiting suggestions) · Requests · Recordings · Research · Quotes · Findings · Ask · Roadmap · Messages (with a count) · Release notes · Surveys · People · Quality · Settings. There is also a **Sign out** button.

### Your workspaces (`/home`)
- With none: a welcome and a **Create workspace** form (name).
- With several: the list of workspaces with your role in each.
- With exactly one: goes straight into it.

### Workspace start (`/w/[id]`)
- No content. Sends you to Review if suggestions are waiting, otherwise Requests if any exist, otherwise Add feedback.

### Add feedback (`/add`)
- Large text box to paste a call transcript, support thread or chat.
- Optional: who said it (picker of people), a title, and a source link.
- **Find requests** button, and **Try a sample conversation** to fill in an example.
- Viewers see a read-only notice instead of the form.

### Review (`/review`)
- Tabs: **To review**, **Accepted**, **Dismissed**.
- Each suggestion shows its title, what kind of statement it is, how confident the AI is, and the customer's exact quote with a link to the full conversation.
- Per suggestion: **Accept as a request**, **Add it to that request** (pick an existing one, with a hint when it looks like a duplicate), **Dismiss**, and editing the title before accepting. Accepted and dismissed ones have **Undo**.
- **Accept everything at or above** a chosen confidence (80, 90 or 95%) for bulk acceptance.
- Accepted suggestions link to their request.

### Requests (`/requests`)
- Search by title, filter by status and tag, order by newest or most revenue behind it. **Apply** and **Clear filters**.
- **Save this view as…** to keep a filter; saved views appear as shortcuts and can be removed (with confirmation).
- Each request: title, status, revenue impact, number of quotes, date added.
- Older requests pagination. Empty states for no requests and no matches.

### Request (`/requests/[id]`)
- Title, impact line, quote count, public vote counts (with verified-customer votes).
- Status changer. Moving to a shipped status offers **Review the messages for the people who asked**.
- Tags: add and remove.
- Issue tracker box: **Create an issue** in the connected tracker, or the linked issue with options to keep the local status or stop following it.
- Public roadmap toggle (admin): make the request public, with its own public title and summary.
- Lists of customers who voted, people told about it, and release notes that mention it.
- **Decision brief**: write one, refresh it when quotes changed, retry on failure. It shows a summary, quotes, who asked, revenue, recent activity, companies and what would change the picture.
- Every supporting quote with a link to the full conversation.

### Inbox (`/inbox`)
- Desk figures: typical first-answer time, how many are waiting and how long, how many are past your target.
- Tabs: **Open**, **Mine**, **Nobody's**, **Closed**.
- Each conversation: customer, subject, channel (chat or email), message count, last activity, who has it, a preview.
- Updates itself without reloading. Older conversations pagination. Link to **Your name, saved replies and target**.

### Conversation (`/inbox/[id]`)
- Controls: take it, hand it to a teammate, close or reopen, **Delete this conversation** (confirmed; the way to honour a request to forget someone).
- The whole thread: customer messages, your replies (with sending state) and internal notes, with file downloads.
- Per customer message: **Send to the review queue as feedback**. Shows where that feedback stands (being read, waiting for review, became a request).
- Failed replies can be retried.
- Reply box: write a reply or an internal note, insert a saved reply, attach files. Warns if new messages arrived while you were writing.
- Viewers can read but not answer.

### Desk setup (`/inbox/desk`)
- Set your display name.
- Create, edit and delete saved replies.
- Set how fast you mean to answer (hours).

### Recordings (`/recordings`)
- Add one or several calls or interviews (MP3, WAV, M4A, MP4, OGG, FLAC, WebM), one after another, with progress, **Cancel upload**, and optionally who is speaking. A file over the 25 MB transcription limit is refused before any bytes move.
- List with status per recording: uploading, waiting, writing the transcript, ready, failed. Search by name or person, filter by state, and load older pages.
- Rename a recording (its transcript takes the same name), download the file, open a recording, continue an unfinished upload, or try a failed transcription again.
- Delete (confirmed). The row leaves the list immediately and a toast offers **Undo**; after 30 seconds a background job removes the file, the transcript and everything built on it.

### Conversation or recording (`/sources/[id]`)
- The full text or transcript. For recordings, an audio player, a play button on each line, and search that jumps to a match and plays its line.
- Download the transcript as plain text, or copy a link back to it.
- Select words to **Highlight** them, then tag them.
- Suggested highlights: request them from the AI, then accept, edit or dismiss each.
- Notice when sensitive-looking text (card numbers, keys, passwords) was removed before saving.
- Shows processing state and a link to review any suggestions found.
- Highlights and quotes from a review link scroll to the exact passage.
- **Delete** the conversation or recording (confirmed, with what else goes with it).

### Research (`/research`)
- Every highlight you have saved, with its tags, a link into its conversation, and **Remove highlight** (confirmed).
- Filter by tag. Older highlights pagination.
- Link to the tag list.

### Tags (`/research/codebook`)
- Add a tag with a color and a one-line meaning.
- Edit, archive, merge into another tag, and undo a merge. Archived and merged tags are listed separately.

### Quotes (`/quotes`)
- One search field that matches words or meaning (a switch picks which), so a meaning search never wipes the filters and a filter never wipes the search.
- Filters as removable chips: tag, how it feels, where it came from, when (7/30/90 days), person, account, and evidence or highlights (tabs). Person and account are searched in the directory (by name or email) rather than picked from a long list. Shows how many quotes match, newest or oldest first, table or board.
- Saved views: the filters and order on screen can be saved under a name for everyone in the workspace (`quote_view`); the creator or an admin can rename or remove one.
- Each row shows the quote, whether it is evidence or a highlight, its source, the request it supports, tags and feeling. Selecting rows raises a bar to set one feeling, tag highlights, copy, export or delete highlights.
- The quote opens a side panel with the full words, who said it and their company, its source and request, tags (editable on highlights), copy quote, copy link, **Add to finding** (appends a card to a draft document), and delete (highlights).
- Board view groups by feeling; dragging a card to another column saves that feeling.
- **Write a finding**, **Tags over time** and **Export** (CSV of the current filters) sit in the header. Export leaves quotes out only when the filters do.
- The command palette (⌘K) offers the page's actions: export with the filters on screen, clear the filters, and write a finding.
- States: first run (where quotes come from and how to add one), no matches (clear all), meaning search not set up, indexing in progress (auto-refreshes), offline (a notice, since the list on screen is the last one loaded), loading skeleton. Viewers read and export but cannot label, tag or delete.

### Label quotes (`/quotes/label`)
- Shows one quote at a time; choose how the person feels. Goal of about 200 labels, used to measure the AI's accuracy.
- Viewers cannot label.

### Tags over time (`/quotes/trends`)
- Quotes collected per tag per week over 12 weeks, plus how quotes feel over time.
- How accurate the AI's feeling labels are against yours, with a link to label more and a button to let the model label up to 200 quotes (costs money; warns that quotes go to your AI provider).

### Findings (`/findings`)
- List of documents with state (draft or shared by link), block count and last change.
- **Start a document** (title).

### Finding (`/findings/[id]`)
- Edit the title, add paragraphs, and add quotes found by searching what customers said, or by choosing **Add to finding** on a quote in Quotes (which appends without touching the rest). Quotes always show their stored words. A deleted quote leaves a notice.
- Reorder and remove blocks, and **Save**.
- **Publish with a link** after confirming you have read every quote. **Take it down now** ends the link permanently. A shared document cannot be edited.
- **Delete this document** (confirmed).

### Ask (`/ask`)
- Question box. Answers cite the exact quotes they came from, with links to the conversations, or say there is not enough evidence.
- Thumbs-style **Was this right?** feedback.
- History of earlier questions.
- Switched-off notice when no AI provider is set up. It does not count customers or say how common something is.

### Roadmap (`/roadmap`)
- Your requests grouped by status, most valuable first, each linking to its request.

### Messages (`/outreach`)
- Tabs: **To review**, **Sent**, **Cancelled**.
- Each batch: the request, how many people, its state, date.

### Messages to review (`/outreach/[id]`)
- State explanation and drafting/sending progress.
- Notes on people who cannot be written to (no email, unrecorded speaker).
- Messages grouped by company. Each has the quote it is based on, an editable draft, **Save**, and **Leave out** / include again. Shows sent, failed or opted-out state, and a retry for refused addresses.
- **Send these messages** (confirmed, with the sender's name) and **Cancel this batch**.

### Release notes (`/releases`)
- List with state: draft, scheduled, published, taken down.
- **Start a note**.

### Release note (`/releases/[id]`)
- Title and body, requests this note closes (checkboxes), **Save**.
- **Publish now**, **Or publish at** a date and time, and take it down. Link to the public page; warns if the workspace has no public address.

### Surveys (`/surveys`)
- **Start a survey**: empty or from a template, delivered by personal link by email or one public link.
- List with a status pill (draft, open, closed), how people get it, question count, invites sent, finished answers and the reply rate; search by title, filter by state, sort by date or answers, and load older pages.
- Select several surveys to close them at once, or (admins) delete them after one confirmation. Each row opens the editor or its results, and a survey can be duplicated into a new draft with its questions.
- Empty: a short explanation and the same start form above it.

### Survey (`/surveys/[id]`)
- A status pill in the header, and for drafts a **Next step** callout that names the one thing left: add a question, choose who it is for, prepare the invitations, or open it.
- In **Status**: open or close by hand, or pick **Close automatically** with a local date and time; the survey closes itself within a minute of that time, and a manual close clears the schedule.
- Open, close, **Delete this survey** (confirmed), and embed code to show it inside your own page. Link to results, and a reset for the public link.
- Details: title, intro, thank-you message, delivery, and whether answers are removed if a person is deleted.
- Questions: add, order, edit; pick one answer or free text; required or not; show a question only when earlier answers match. Locked once open, except wording.
- Audience: everyone with an email, or people matching rules; count who it picks; save.
- Invitations: write down who will be asked, preview the email, approve, send reminders (at most two each), exclude people, and show personal links to hand out for people without email.

### Survey results (`/surveys/[id]/results`)
- Finished answers, started-but-unfinished, and completion at the top; net promoter score with promoter/passive/detractor bars; averages for rating questions, and "no answers yet" when a question has none; counts and percentages for choice questions; every written answer grouped by question with who wrote it and when, and a link to the review queue.
- **Download CSV** saves every figure and written answer for a spreadsheet.

### People and companies (`/people`)
- Four totals at the top: people, companies, people with an email, and people without one.
- Import from a spreadsheet: pick the file, match columns (name, email, company, revenue), preview the first rows, skip problem rows, import. **Import another file**.
- Tabs: **People** and **Companies**.
- People: search by name or email, filter by company (searched, not a long list) and by whether an email is known, shown as removable chips with the match count. Each row shows an avatar and name, email, company, the number of quotes from them and when they were last heard; the name opens a side panel with their recent quotes, edit, copy or write to their email, their quotes and company, and **Delete** for admins (confirmed; keeps their opt-out). **Export** downloads the filtered list as CSV. **Add a person**. Pagination.
- Companies: search by name with a match count; each row shows domain, people (a link to that company's people), revenue, plan and renewal date, with **Edit**. **Add a company**. Pagination.
- **Merge into another person** (admins, from a row or the side panel): choose who survives, read what moves, acknowledge that the other is deleted, then merge. Everything the first person said, voted on, was invited to, talked to us in and saved as a quote view moves to the survivor; duplicate votes and duplicate survey invitations are dropped in the survivor's favour; an email or company the survivor was missing is filled in. It is one transaction and refuses (nothing changed) when both people were told about the same request, because a send record would be lost.

### Quality (`/quality`)
- How often suggestions are accepted, accepted unchanged, dismissed, and the counts behind them; a notice when there is not enough data.
- Week by week table, and what the AI cost per task.
- Spot checks (admin): a few assistant answers or briefs each week to mark as backed or not backed by their quotes.

### Settings (`/settings`)
Each section is described under [Settings sections](#settings-sections). Admin-only parts are marked.

---

## Settings sections

- **Team** — member list with role and changing roles (admin, member, viewer), removing members, **Invite someone** by email with a role, a copyable invitation link (works 7 days), resend and revoke open invitations.
- **Messages and release page** — the name that signs messages and the public address for release notes.
- **Feedback form for your website** (admin) — turn the form on or off, allowed website addresses, an embed code, and a new key. **Forget** everything that came in from one email address.
- **Billing** — current plan and what it includes, **Start checkout** to change plan, **Manage billing** (card, invoices, cancel), payment-failed warning and billing history.
- **Inbox: website chat and email** — turn chat and email on, allowed sites, greeting, the chat code to paste into your website, the incoming-email address and key, and new chat address / key.
- **Request statuses** — add, rename and mark which statuses count as shipped (shipping prepares messages for review).
- **Connections** — Slack (pick a channel, check connection), one issue tracker at a time (GitHub, Linear, Jira, and others; what status a request moves to when an issue closes or reopens), HubSpot and Salesforce (sync company value from revenue or closed-won deals), each with connect, check and disconnect.
- **Messages to other tools** (webhooks) — add an address, choose a kind (data, Slack, Discord, Teams) and the events, send a test, view recent deliveries, make a new signing secret, pause or remove.
- **API keys and AI assistants** — create a key with a name, abilities, expiry and allowed addresses; see recent activity; revoke. Setup text for connecting an assistant. Connected assistants that signed in, with disconnect.
- **Verified voting** (admin) — how voters count as verified, and a secret and example code to vouch for your own users.
- **Weekly digest** (admin) — turn on, recipients, preview.
- **Your data** (admin) — download everything in the workspace as one file.
- **Your password** — change it.
- **Delete your account** — ask for deletion, and cancel that request.
- **Delete this workspace** (admin) — type its name to confirm.

---

## Pages customers see

### Public roadmap (`/r/[slug]/roadmap`)
- Public requests by stage with vote counts and verified-customer counts.
- **Vote** button, **Sign in to vote** and **create an account** links. Message when your email matches a customer so votes count as verified, and when a voting link has expired.
- **Remove all my votes** (confirmed).

### Release notes (`/r/[slug]`, `/r/[slug]/[noteId]`)
- Published notes, newest first, and a single note with a **Link to this note**. Empty state when nothing is published.

### Survey (`/s/[token]`, embeddable at `/embed/s/[token]`)
- The questions, with required markers and questions that appear only when earlier answers call for them.
- **Submit**, and **Save and finish later** (come back to the same link). Thank-you message, and notices for closed or already-answered surveys. A note on how answers are used.

### Chat window (`/chat/[token]`)
- Visitor's name and email (optional), message box, file attachment, **Send**. New replies appear without reloading.
- A notice when chat is not allowed on that site.

### Shared findings (`/f/[token]`)
- A published document: title, paragraphs and customers' words only.

### Stop these emails (`/unsubscribe/[token]`)
- Confirm to stop receiving messages from that workspace.

### Stop the weekly digest (`/digest/unsubscribe/[token]`)
- Confirm to stop the digest.

---

## Marketing site

All public, no sign-in. Header and footer links go to every page below, with **Get started free** leading to sign-up.

- **Home** — headline and two buttons (**Get started free**, **See how it works**); the five-step path from conversation to personal reply; six promises (cited claims, you decide, weighted by who asks, private, works where your team works, honest about itself); an overview of capabilities; integrations count and a link to the integrations page.
- **Features** — what the product does, area by area.
- **Integrations** — the list of integrations by group with each marked available or coming soon.
- **Pricing** — Free, Team and Business plans.
- **Documentation** (`/docs`, `/docs/[slug]`) — an index and 15 guides: quick start, your team, concepts, sending feedback in, reviewing and requests, people/accounts/value, closing the loop, calls/highlights/findings, surveys, the support desk, connecting services, webhooks, API, AI assistants (MCP), your data (export, deletion, retention).
- **FAQ** — common questions and answers.
- **Security** — how data is protected.
- **Subprocessors** — the list of outside services that handle data.
- **Community**, **About**, **Contact** (an email link).
- **Privacy policy**, **Terms and conditions**, **Cookies**.

---

## Shared behaviours (not pages)

- Every destructive action asks for confirmation and says what will be lost.
- Errors, "not found" and "something went wrong" pages exist for the app and the site.
- Viewers see read-only versions of most pages; admin-only controls are hidden from everyone else.
- In the preview build only, a **Preview · sample data** tag appears and `/mock` lists every screen above.
