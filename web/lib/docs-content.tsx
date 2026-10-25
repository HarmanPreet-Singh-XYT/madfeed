import type { ReactNode } from "react";
import Link from "next/link";
import { Bullets } from "@/components/site/blocks";

export type Doc = {
  slug: string;
  title: string;
  summary: string;
  body: ReactNode;
};

const a = "text-link underline underline-offset-2 hover:no-underline";

function H({ children }: { children: ReactNode }) {
  return <h2 className="pt-4 text-xl font-semibold">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed">{children}</p>;
}
function Code({ children }: { children: string }) {
  return (
    <pre
      tabIndex={0}
      className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-sm"
    >
      <code>{children}</code>
    </pre>
  );
}
function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-6 leading-relaxed">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ol>
  );
}

export const DOCS: Doc[] = [
  {
    slug: "getting-started",
    title: "Quick start",
    summary:
      "From a first pasted conversation to a request with its evidence, in a few minutes.",
    body: (
      <>
        <P>
          You do not need to set anything up first. This takes about five
          minutes.
        </P>
        <Steps
          items={[
            <>
              Create an account on the{" "}
              <Link className={a} href="/signup">
                sign-up page
              </Link>{" "}
              and confirm your email address.
            </>,
            <>
              Create a workspace. It is your company&apos;s space; nothing in it
              is visible to any other workspace.
            </>,
            <>
              Open <strong>Add feedback</strong> and paste a customer
              conversation: a support thread, call notes, an email. Add the
              person and their company if you know them, and a link back to the
              original.
            </>,
            <>
              Open <strong>Review</strong>. In a few seconds the AI shows what
              it found. Each suggestion shows the original text with the
              supporting sentence highlighted and a confidence.
            </>,
            <>
              Accept the ones that are right, edit a title, merge one into an
              existing request, or dismiss what is not useful. You can undo any
              of it.
            </>,
            <>
              Open <strong>Requests</strong>. Your accepted suggestions are now
              requests with their evidence: the exact quotes, who said them, and
              where.
            </>,
          ]}
        />
        <H>Then, when you are ready</H>
        <Bullets
          items={[
            <>
              Import your{" "}
              <Link className={a} href="/docs/people-and-value">
                people and accounts
              </Link>{" "}
              from a CSV so requests are weighed by what the accounts are worth.
            </>,
            <>
              Add more{" "}
              <Link className={a} href="/docs/sending-feedback">
                feedback sources
              </Link>
              : a form or chat window on your site, email, Slack, uploaded
              calls.
            </>,
            <>
              Learn how to{" "}
              <Link className={a} href="/docs/closing-the-loop">
                close the loop
              </Link>{" "}
              when a request ships.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    slug: "team",
    title: "Your team",
    summary: "Invite teammates, choose their roles, and remove people.",
    body: (
      <>
        <P>
          An admin manages the team under <strong>Settings, Team</strong>.
        </P>
        <H>Invite someone</H>
        <Steps
          items={[
            "Enter their email address and choose a role: admin, member or viewer.",
            "Choose Send invitation. If your service can send email, they get a message with a link; if not, you are shown the link to copy and send yourself.",
            "They open the link, sign in or create an account with that exact email address, confirm the address if asked, and choose Join.",
          ]}
        />
        <Bullets
          items={[
            "The link works for 7 days and only for someone signed in with the invited address after it has been confirmed. Anyone else who opens it is told it was meant for another address and is not added.",
            "Inviting an address that already has an open invitation updates its role and sends it again; there is only ever one.",
            "Under Waiting to be used you can copy a link, send it again (which also extends it) or cancel it. A cancelled link stops working at once.",
            "A person who is already a member keeps the role they have.",
          ]}
        />
        <H>Roles</H>
        <Bullets
          items={[
            <>
              <strong>Admin:</strong> everything, including billing,
              connections, keys, publishing settings and the team.
            </>,
            <>
              <strong>Member:</strong> add feedback, review, reply, edit.
            </>,
            <>
              <strong>Viewer:</strong> read and search only.
            </>,
          ]}
        />
        <P>
          Change a role from the list in Settings, Team. A workspace always
          keeps at least one admin: the last admin cannot be demoted, removed or
          leave until someone else is made an admin.
        </P>
        <H>Removing people, and leaving</H>
        <P>
          An admin can remove anyone; anyone can leave a workspace themselves.
          The person loses access at once. What they wrote stays, and
          conversations assigned to them become unassigned.
        </P>
      </>
    ),
  },
  {
    slug: "concepts",
    title: "Concepts",
    summary: "The few words the product uses, and what each one means.",
    body: (
      <>
        <P>The product uses one small vocabulary everywhere.</P>
        <dl className="space-y-3">
          {[
            [
              "Workspace",
              "One company's space. Everything inside belongs to it alone.",
            ],
            [
              "Source",
              "Something that came in: a pasted conversation, a transcript, an email, a survey answer. It is stored exactly as received (after sensitive numbers are hidden) and never edited.",
            ],
            [
              "Quote (evidence)",
              "A passage of a source that supports a request. It must appear word for word in its source at the stored position; the platform refuses to store one that does not.",
            ],
            [
              "Suggestion",
              "What the AI proposes from a source. It waits in the review queue until a person accepts, edits, merges or dismisses it.",
            ],
            [
              "Request",
              "Something customers asked for, made of evidence. It has a status, tags, an owner and an impact.",
            ],
            [
              "Person and account",
              "A person is someone who said something; an account is the company they belong to, with a value (revenue).",
            ],
            [
              "Impact",
              "How much a request matters: quotes, people, accounts and total value, summed once per account.",
            ],
            [
              "Tag and area",
              "Labels you define to group requests and highlights.",
            ],
            [
              "Status",
              "Where a request is: you customise the list. A status belongs to a bucket (open, active, done = shipped, closed). Moving into a shipped status starts the loop-closing messages.",
            ],
            [
              "Draft and approval",
              "A message prepared for someone who asked. Nothing is sent until you approve it.",
            ],
          ].map(([t, d]) => (
            <div key={t}>
              <dt className="font-semibold">{t}</dt>
              <dd className="text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
        <H>Roles</H>
        <P>
          <strong>Admin</strong> can do everything, including billing,
          connections, keys and publishing settings. <strong>Member</strong> can
          add, review, reply and edit. <strong>Viewer</strong> can read and
          search but change nothing. Roles are enforced on the server for every
          action.
        </P>
      </>
    ),
  },
  {
    slug: "sending-feedback",
    title: "Sending feedback in",
    summary:
      "Every way feedback can arrive, including the one web request that lets almost any tool post in.",
    body: (
      <>
        <H>Inside the product</H>
        <Bullets
          items={[
            <>
              <strong>Paste</strong> on the Add feedback page, with an optional
              person, company and source link. One text can be up to 200,000
              bytes.
            </>,
            <>
              <strong>Recordings:</strong> upload a call or interview; it is
              transcribed with speakers and timing, and highlights are
              suggested. (Paid plans.)
            </>,
            <>
              <strong>Website form and chat:</strong> in Settings, switch on the
              feedback form or the chat inbox, add the sites allowed to use
              them, and copy the embed code.
            </>,
            <>
              <strong>Email:</strong> Settings, Inbox gives an address to route
              customer email to.
            </>,
            <>
              <strong>Slack:</strong> connect a workspace and choose one
              channel; its messages become feedback.
            </>,
            <>
              <strong>Surveys:</strong> free-text answers go to the review
              queue.
            </>,
          ]}
        />
        <H>From other tools: one web request</H>
        <P>
          Help desks, form tools, automation services and call tools can all
          post in with a key that has the &quot;add notes to the review
          queue&quot; permission (Settings, API keys).
        </P>
        <Code>{`curl -X POST "$API/v1/ext/feedback" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"source":"Help desk","title":"Ticket 1042","externalId":"1042",
       "url":"https://desk.example.com/tickets/1042","email":"dana@acme.com",
       "text":"Customer: we keep asking for SSO.\\n\\nAgent: noted."}'`}</Code>
        <Bullets
          items={[
            <>
              <code>text</code> (required, up to 20,000 characters): put the
              whole thread in and label who is speaking.
            </>,
            <>
              <code>source</code>, <code>title</code>, <code>url</code>: where
              it came from, shown on the review queue.
            </>,
            <>
              <code>externalId</code>: the other tool&apos;s id. Sending the
              same one again from the same source stores it once, even if the
              text was edited. The answer says <code>duplicate: true</code>.
            </>,
            <>
              <code>email</code>: if a person with this email exists, the note
              is theirs, so their account&apos;s value counts. Nobody is created
              from it.
            </>,
          ]}
        />
        <H>Call transcripts</H>
        <P>
          <code>POST /v1/ext/transcripts</code> takes a transcript as WebVTT,
          SRT, JSON speaker turns or plain text (the format is guessed), or a
          list of turns. Timing is dropped, speakers are kept, neighbouring
          turns by one speaker are joined, and the result is read like any
          pasted conversation.
        </P>
        <Code>{`curl -X POST "$API/v1/ext/transcripts" \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"source":"Call tool","title":"Acme QBR","externalId":"call-77",
       "transcript":"WEBVTT\\n\\n00:00:01.000 --> 00:00:04.000\\n<v Dana>We keep asking for single sign-on.</v>"}'`}</Code>
        <H>Limits and safety</H>
        <Bullets
          items={[
            "A key may add 500 notes a day and make 120 requests a minute; a workspace also has a daily allowance of new text (about 5 MB). Over a limit you get a 429; try again later.",
            "Card numbers, keys and passwords are hidden before anything is stored.",
            "Use a key made only for this, with only that permission, so you can revoke it on its own.",
          ]}
        />
      </>
    ),
  },
  {
    slug: "review-and-requests",
    title: "Reviewing and requests",
    summary: "How the review queue works, and what a request page shows.",
    body: (
      <>
        <H>The review queue</H>
        <P>
          Each suggestion shows the source text with the supporting sentence
          highlighted, a confidence, and whether it looks like a new request or
          more evidence for one you already have. When it looks like an existing
          request, a box says so with the reason; one button adds it there.
          Nothing merges by itself.
        </P>
        <Bullets
          items={[
            <>
              <strong>Accept</strong> creates a request (or adds evidence to the
              one you chose).
            </>,
            <>
              <strong>Edit</strong> the title before accepting; the correction
              is remembered.
            </>,
            <>
              <strong>Dismiss</strong> removes it from the queue. Dismissed
              suggestions are kept 90 days so you can undo.
            </>,
            <>
              <strong>Bulk accept</strong> above a confidence you choose.
            </>,
          ]}
        />
        <H>A request</H>
        <Bullets
          items={[
            "Its status, tags and area, and its impact: quotes, people, accounts and total value.",
            "Every piece of evidence: the quote, who said it, their account, the source and where in it. Open the source to see the quote in context.",
            "A decision brief you can generate: a summary where every claim links to its quote.",
            "The linked issue in your tracker, if you opened one.",
            "Who has been told when it shipped.",
          ]}
        />
        <H>Finding things</H>
        <Bullets
          items={[
            "The Requests table filters by status and tag, searches titles, sorts by value or newest, and saves views you can share.",
            "The Quotes page searches by meaning as well as words.",
            "Ask answers a question from stored quotes only, with citations, or says there is no evidence.",
          ]}
        />
      </>
    ),
  },
  {
    slug: "people-and-value",
    title: "People, accounts and value",
    summary:
      "Importing people and accounts, and how a request's value is worked out.",
    body: (
      <>
        <P>
          A request is weighed by the accounts of the people who asked. Add that
          context on the People page.
        </P>
        <H>Importing a CSV</H>
        <Steps
          items={[
            "Open People and choose Import.",
            "Paste or upload your file. Columns are detected (name, email, company, revenue, plan, renewal date) and you can change the mapping.",
            "Read the preview. It tells you how many rows are valid and names every bad row and why. Nothing is saved until you confirm.",
          ]}
        />
        <H>How value is calculated</H>
        <P>
          A request&apos;s value is the sum of the revenue of the{" "}
          <em>distinct</em> accounts behind it. Two people from one account
          count that account once, so a loud account cannot inflate a request.
          The numbers update as evidence is added.
        </P>
        <H>From a CRM</H>
        <P>
          HubSpot and Salesforce can fill in account value automatically,
          read-only, for people you already have (matched by email): from the
          company&apos;s annual revenue, or from the total of its closed-won
          deals. It never creates or removes a person, never writes to the CRM,
          and leaves a person alone whose account is a different company. See{" "}
          <Link className={a} href="/docs/integrations">
            connecting services
          </Link>
          .
        </P>
      </>
    ),
  },
  {
    slug: "closing-the-loop",
    title: "Closing the loop",
    summary:
      "Statuses, personal messages when something ships, release notes and the public roadmap.",
    body: (
      <>
        <H>When a request ships</H>
        <P>
          Move a request to a status in the <em>done</em> bucket. The platform
          prepares one draft for each person who asked, written from their own
          quotes. Open <strong>Outreach</strong> to see the batch.
        </P>
        <Steps
          items={[
            "Read each draft. Edit it, or remove a person from the batch.",
            "Approve. Only approved messages can be sent; this is enforced in the sending code itself.",
            "Watch the send log. Each message has a signed unsubscribe link, and anyone who opted out is skipped.",
            "Requests show who has been told.",
          ]}
        />
        <P>
          If you move a request back out of a shipped status before approving,
          the unapproved batch is withdrawn.
        </P>
        <H>Release notes</H>
        <P>
          Write a note, link it to the requests it ships, and publish it now or
          schedule it for an exact moment. With public pages switched on, each
          note has its own page under your chosen address. Unpublish at any
          time.
        </P>
        <H>Roadmap and votes</H>
        <P>
          Publish a roadmap page. Signed-in visitors can vote, and votes from
          people you know are marked verified, either by a link signed by your
          own app or by a confirmed email address.
        </P>
      </>
    ),
  },
  {
    slug: "research",
    title: "Calls, highlights and findings",
    summary:
      "Recordings, transcripts, the tag codebook, quotes and shareable findings.",
    body: (
      <>
        <Bullets
          items={[
            <>
              <strong>Recordings:</strong> upload a call. Large files upload in
              pieces and resume after a break. The transcript has speakers and
              timing and a player; clicking a quote jumps to the moment.
            </>,
            <>
              <strong>Highlights:</strong> select text to highlight it and
              attach tags. Suggested highlights appear from your codebook;
              accept or dismiss them.
            </>,
            <>
              <strong>Codebook:</strong> define tags with a meaning and a
              colour. Merge two tags (with an exact undo), archive or restore.
            </>,
            <>
              <strong>Quotes:</strong> every stored quote as a table or board,
              with tags over time and feeling labels set by a model or a person.
            </>,
            <>
              <strong>Findings:</strong> a document made of quote cards that
              always show the stored words. Publishing asks you to confirm you
              have read the quotes; share by a link you can revoke.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    slug: "surveys",
    title: "Surveys",
    summary:
      "Build, target, send and read surveys, including branching questions.",
    body: (
      <>
        <Steps
          items={[
            "Create a survey and choose how it is delivered: by approved email invitation, or by a public link (which can also be embedded in a page).",
            "Add questions: NPS, CSAT, multiple choice, or free text. Mark which are required.",
            "Optionally show a question only when earlier answers match: up to four conditions, combined with all or any. Conditions are fixed once the survey opens.",
            "For invitations, define the audience with rules over your people and accounts and preview exactly who would get it.",
            "Open the survey. Approve the invitations; send reminders to people who have not answered.",
            "Read results on the survey's results page. Free-text answers also join the review queue.",
          ]}
        />
        <P>
          Each person gives one final answer. If a person is deleted, their
          answers are removed or anonymised, as you chose when you set the
          survey up.
        </P>
      </>
    ),
  },
  {
    slug: "support-desk",
    title: "The support desk",
    summary: "Website chat and email in a shared inbox.",
    body: (
      <>
        <Bullets
          items={[
            "Switch on website chat and email under Settings, Inbox, and add the sites allowed to show the chat window.",
            "Conversations appear in the Inbox. Open one to read the thread, reply, add a private note, or hand it to a named teammate.",
            "Under Desk setup, set the name teammates see, save up to 100 replies, and set an optional first-reply target in hours.",
            "The inbox shows median and slow-end first-reply times, who is waiting, and how many are past the target.",
            "Visitors and the team can send pictures, PDFs and plain text (5 MB each, up to 3 per message). Files are always downloads and are not virus scanned.",
            "Send a customer's message to the review queue and see a live card of what came of it.",
          ]}
        />
        <P>
          If two people try to reply at once, the second is asked to read the
          new messages first.
        </P>
      </>
    ),
  },
  {
    slug: "integrations",
    title: "Connecting services",
    summary:
      "Slack, issue trackers and CRMs: how to connect them, and what they will and will not do.",
    body: (
      <>
        <P>
          Connections are made by an admin in Settings, Connections. Credentials
          are encrypted and shown once. Which services appear depends on what
          has been switched on for the service; see the{" "}
          <Link className={a} href="/integrations">
            integrations page
          </Link>{" "}
          for what is available now, coming soon and planned.
        </P>
        <H>Slack</H>
        <P>
          Add the app, choose one channel, and its messages become feedback in
          the review queue.
        </P>
        <H>Issue trackers</H>
        <P>
          GitHub is available; Linear, Jira Cloud, ClickUp, Asana and Azure
          DevOps follow the same pattern as each is switched on. Only one
          tracker can be connected at a time.
        </P>
        <Steps
          items={[
            "Make a token or key in the tracker with permission to create issues in one repository, team or project.",
            "In Settings, enter the details. The connection is checked before it is stored.",
            "Some trackers need one more step on their side (for example adding a webhook); the screen shows the address and secret once.",
            "Choose which of your statuses a request moves to when the issue is done, and when it is reopened (or leave them alone).",
            "On a request page, choose Create an issue. The issue holds the title and counts and a link back, never quotes, names or emails.",
          ]}
        />
        <P>
          If someone changes the request here after the link last agreed with
          the issue, a change from the tracker is held back and shown on the
          request for a person to settle; it is never overwritten. Moving into a
          shipped status prepares drafts for you to review; nothing is sent
          automatically.
        </P>
        <H>CRMs (HubSpot, Salesforce)</H>
        <P>
          Read-only account value; see{" "}
          <Link className={a} href="/docs/people-and-value">
            People, accounts and value
          </Link>
          . The first sync starts within a minute of connecting and then runs
          daily; &quot;Sync now&quot; asks for another.
        </P>
        <H>Sign-in</H>
        <P>
          Email and password today. Company sign-in through your identity
          provider, and provider buttons, arrive when switched on.
        </P>
      </>
    ),
  },
  {
    slug: "webhooks",
    title: "Webhooks",
    summary:
      "Signed messages to your own code, or plain sentences in Slack, Discord or Teams.",
    body: (
      <>
        <P>
          In Settings, Messages to other tools, add an address (it must start
          with https:// and point to the public internet), choose the events and
          the kind of address, and copy the signing secret, which is shown once.
          Use Send a test to check it.
        </P>
        <H>Events</H>
        <Bullets
          items={[
            <>
              <code>request.created</code>: a suggestion was accepted and
              started a request.
            </>,
            <>
              <code>request.status_changed</code>: a request moved to another
              status.
            </>,
            <>
              <code>suggestions.ready</code>: reading a new source found
              suggestions.
            </>,
            <>
              <code>release_note.published</code>: a note was published now (a
              note scheduled for later sends nothing).
            </>,
            <>
              <code>survey.response_completed</code>: someone finished a survey.
            </>,
          ]}
        />
        <P>
          Messages carry ids, statuses and titles of your own requests. They
          never carry customer quotes, names or email addresses.
        </P>
        <H>The message</H>
        <Code>{`{ "id": "…event id…", "type": "request.status_changed",
  "createdAt": "2026-10-24T17:00:00Z", "workspaceId": "…", "data": { … } }`}</Code>
        <P>
          Headers: <code>Webhook-Id</code> (the same on every retry; use it to
          drop duplicates), <code>Webhook-Event</code>, and{" "}
          <code>Webhook-Signature</code>.
        </P>
        <H>Checking the signature</H>
        <P>
          <code>Webhook-Signature</code> is{" "}
          <code>t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, where{" "}
          <code>v1</code> is the HMAC-SHA256 of{" "}
          <code>&quot;&lt;t&gt;.&lt;raw body&gt;&quot;</code> under your secret.
          Recompute it on the raw body, compare in constant time, and reject
          messages whose <code>t</code> is more than a few minutes from your
          clock.
        </P>
        <H>Delivery</H>
        <Bullets
          items={[
            "Answer with any 2xx within 10 seconds. Redirects are not followed.",
            "Anything else is retried after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours; after 8 attempts the message is marked failed.",
            "30 failures in a row switch the address off; you switch it back on.",
            "History is kept 30 days. Delivery is at least once, so treat Webhook-Id as the key.",
            "Addresses that point inside a private network are refused when saved and again when sending.",
          ]}
        />
        <H>Chat channels</H>
        <P>
          Choose Slack, Discord or Microsoft Teams as the kind of address and
          paste the incoming-webhook address that tool gives you. Each event
          arrives as one plain sentence with a link. Customer-derived titles are
          made safe: no mentions, no smuggled links or markup.
        </P>
      </>
    ),
  },
  {
    slug: "api",
    title: "API",
    summary:
      "Keys, permissions and the endpoints for reading, asking and adding.",
    body: (
      <>
        <H>Keys</H>
        <P>
          In Settings, API keys, make a key with a name and exactly the
          permissions it needs. A key can expire, can be limited to addresses,
          is rate limited, and keeps an activity log. The secret is shown once.
        </P>
        <dl className="space-y-2">
          {[
            [
              "requests",
              "See request titles, statuses, tags, release notes and counts of quotes, people and accounts.",
            ],
            [
              "quotes",
              "Also see the exact quotes, and search them by meaning.",
            ],
            ["ask", "Ask questions; answers cite stored quotes."],
            ["submit", "Add notes and call transcripts to the review queue."],
            [
              "write",
              "Change a request's status (never into or out of shipped) and add tags.",
            ],
          ].map(([t, d]) => (
            <div key={t}>
              <dt className="font-mono text-sm font-semibold">{t}</dt>
              <dd className="text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
        <P>
          Keys never expose people&apos;s names or email addresses. New keys can
          read but change nothing unless you tick more.
        </P>
        <H>Endpoints</H>
        <Code>{`GET  /v1/ext/requests?q=&statusId=&tagId=&limit=   list, most valuable first
GET  /v1/ext/requests/{id}                         one request, with quotes if permitted
GET  /v1/ext/statuses                              the statuses
GET  /v1/ext/tags                                  the tags
GET  /v1/ext/release-notes                         published notes
GET  /v1/ext/quotes/search?q=                      quotes by meaning
POST /v1/ext/ask            {"question": "…"}      a cited answer or "no evidence"
POST /v1/ext/feedback       {"text": "…", …}       a note for the review queue
POST /v1/ext/transcripts    {"transcript": "…", …} a call transcript
PUT  /v1/ext/requests/{id}/status {"statusId": …}  change status
POST /v1/ext/requests/{id}/tags   {"tagId": …}     add a tag`}</Code>
        <P>
          Send the key as <code>Authorization: Bearer …</code>. The full
          contract is an OpenAPI document. Limits: 120 requests a minute per
          key; 500 notes a day. Quotes that look like instructions to an AI are
          flagged in the response so your code can withhold them.
        </P>
      </>
    ),
  },
  {
    slug: "assistants",
    title: "AI assistants (MCP)",
    summary:
      "Connect Claude, ChatGPT, Cursor and others, and what they can and cannot do.",
    body: (
      <>
        <P>
          Any assistant that supports remote tools can connect to your
          workspace. An admin approves what it may do, and can disconnect it at
          any time.
        </P>
        <H>Connect</H>
        <Steps
          items={[
            "In your assistant, add a remote tool server at your service's /mcp address and choose to sign in.",
            "The assistant sends you to an approval page. Choose the workspace and tick the permissions to allow.",
            "Approve. The assistant gets a short-lived access that renews while it is approved. Disconnect it in Settings at any time.",
          ]}
        />
        <P>
          For a local assistant you can instead run the small program on your
          computer with an API key.
        </P>
        <H>The ten tools</H>
        <Bullets
          items={[
            <>
              <code>search_requests</code>: find requests, optionally by words,
              status or tag.
            </>,
            <>
              <code>get_request</code>: one request with its exact quotes.
            </>,
            <>
              <code>ask_feedback</code>: a question answered only from stored
              quotes, with citations, or &quot;no evidence&quot;.
            </>,
            <>
              <code>list_statuses</code>, <code>list_tags</code>,{" "}
              <code>list_release_notes</code>.
            </>,
            <>
              <code>search_quotes</code>: quotes closest in meaning to some
              words.
            </>,
            <>
              <code>submit_feedback</code>: add a note to the review queue.
            </>,
            <>
              <code>set_request_status</code> and <code>tag_request</code>:
              change a status (never to or from shipped) and add a tag; both
              need the extra &quot;write&quot; permission.
            </>,
          ]}
        />
        <H>What assistants cannot do</H>
        <P>
          They cannot send messages, publish, merge, delete, accept or dismiss
          suggestions, or move a request into or out of shipped. Those stay with
          people. Quotes that look like instructions aimed at an AI are withheld
          from assistants, and every result reminds the assistant that quotes
          are evidence, not instructions.
        </P>
      </>
    ),
  },
  {
    slug: "privacy-and-data",
    title: "Your data: export, deletion and retention",
    summary:
      "What you can export, what deleting removes, and what expires by itself.",
    body: (
      <>
        <Bullets
          items={[
            <>
              <strong>Export:</strong> an admin can download the whole workspace
              (companies, people, conversations, requests and the quotes behind
              them) from Settings, and import it again.
            </>,
            <>
              <strong>Delete a person:</strong> removes their quotes,
              conversations, transcripts, recordings, survey answers and chat
              files.
            </>,
            <>
              <strong>Delete a recording or a conversation:</strong> removes its
              content.
            </>,
            <>
              <strong>Expires by itself:</strong> questions and answers after
              180 days, per-call AI cost records after 400, admin notices after
              30, dismissed suggestions after 90.
            </>,
            <>
              <strong>Never kept in logs:</strong> message content, email
              addresses and tokens.
            </>,
          ]}
        />
        <P>
          See the{" "}
          <Link className={a} href="/privacy">
            privacy policy
          </Link>
          , the{" "}
          <Link className={a} href="/security">
            security page
          </Link>{" "}
          and the{" "}
          <Link className={a} href="/subprocessors">
            subprocessors
          </Link>{" "}
          for the rest.
        </P>
      </>
    ),
  },
];

export function docBySlug(slug: string): Doc | undefined {
  return DOCS.find((d) => d.slug === slug);
}
