import type { Metadata } from "next";
import { Bullets, CallToAction, Page, Section } from "@/components/site/blocks";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Everything between a customer conversation and a personal reply: intake, cited extraction, review, weighted requests, research, surveys, a support desk, release notes and more.",
};

export default function Features() {
  return (
    <Page
      title="Features"
      lead="Everything between a customer saying something and you telling them what you did about it, in one place and one data model."
    >
      <nav
        aria-label="On this page"
        className="rounded-lg border border-border bg-muted p-4"
      >
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {[
            ["intake", "Bring feedback in"],
            ["review", "Cited extraction and review"],
            ["requests", "Requests, people and value"],
            ["ask", "Questions and briefs"],
            ["loop", "Close the loop"],
            ["research", "Calls, highlights and findings"],
            ["surveys", "Surveys"],
            ["desk", "Support desk"],
            ["public", "Public pages"],
            ["connect", "Integrations, API and assistants"],
            ["trust", "Trust, privacy and control"],
          ].map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-flex min-h-8 items-center text-link underline underline-offset-2 hover:no-underline"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="intake" title="Bring feedback in, from anywhere">
        <p>
          Conversations arrive in many places, so there are many ways in. All of
          them end in the same place: an untouched, stored source, split into
          pieces, with sensitive numbers hidden, waiting to be read.
        </p>
        <Bullets
          items={[
            "Paste a conversation, with the person, account and a link back if you have them.",
            "Upload a call or interview recording (large files, resumable) and get a transcript with speakers and timing.",
            "Import people and accounts from a CSV: columns are detected, you see a preview, and every bad row is named.",
            "Add a feedback form or a chat window to your website, limited to the sites you allow, with files in chat both ways.",
            "Forward or route customer email in from any mail provider.",
            "Collect messages from a Slack channel you choose.",
            "Let other tools post in: help desks, form tools, automation services and call-recording tools send notes and transcripts through one endpoint, and a retry never stores one twice.",
            "Run surveys; free-text answers join the review queue.",
          ]}
        />
      </Section>

      <Section id="review" title="Cited extraction and a review queue">
        <p>
          The AI reads each source and proposes the requests inside it. Each
          suggestion shows the original text with the supporting sentence
          highlighted, a confidence, and whether it looks like a new request or
          more evidence for an existing one.
        </p>
        <Bullets
          items={[
            "Every quote must appear word for word in the original at the stored position. Two code checks and a database rule enforce it, so an invented quote cannot be stored.",
            "Nothing becomes a request until a person accepts it. Accept, edit the title, merge into an existing request, or dismiss; undo any of it.",
            "Bulk-accept suggestions above a confidence you choose.",
            "A suggestion that looks like an existing request says so, with the reason, and a person presses the button. Nothing merges by itself.",
          ]}
        />
      </Section>

      <Section id="requests" title="Requests, people and what they are worth">
        <p>
          A request gathers evidence: who said it, which account they belong to,
          in which source, and exactly where. The numbers update as evidence is
          added.
        </p>
        <Bullets
          items={[
            "Impact shows quotes, people, accounts and total value. Value is summed over distinct accounts, so two people from one account count that account once.",
            "Customisable statuses, tags and areas; filters; sorting by value or newest; saved views you can share.",
            "People and accounts with revenue, plan and renewal date, from a strict CSV import, by hand, or read-only from HubSpot or Salesforce.",
            'Search quotes by meaning, so "I can\'t log in with my company account" finds "SSO is broken" too.',
          ]}
        />
      </Section>

      <Section id="ask" title="Questions and briefs you can verify">
        <Bullets
          items={[
            "Ask a question about what customers said. The answer is built only from stored quotes and cites them, or says there is no evidence. Questions with a false premise are refused.",
            "A decision brief for any request summarises the evidence, with every claim linked to its quote.",
            "A quality page shows how often accepted suggestions were edited or dismissed, and a weekly spot check samples answers and briefs for a person to grade.",
          ]}
        />
      </Section>

      <Section id="loop" title="Close the loop with the people who asked">
        <p>
          Marking a request shipped prepares a personal draft for each person
          who asked, written from their own words. You review each message, edit
          it, and approve. Only approved messages are sent, and that rule lives
          in the sending code, not just the screen.
        </p>
        <Bullets
          items={[
            "A send log, a signed unsubscribe link in every message, an honoured opt-out list, and bounce and complaint handling.",
            '"Told about this" marks on each request, so you know who has heard.',
            "Release notes written by you, linked to requests, published now or scheduled for an exact moment, with a public page.",
            "A public roadmap where signed-in visitors vote; votes from known customers are marked verified.",
          ]}
        />
      </Section>

      <Section id="research" title="Calls, highlights and findings">
        <Bullets
          items={[
            "Timed transcripts with speakers and a player; every highlight maps to a moment.",
            "A tag codebook with definitions and colours; merge two tags and undo it exactly.",
            "Highlight by hand, or accept suggested highlights from the codebook.",
            "A quotes screen as a table or a board, with tags over time and feeling labels (by a model or a person, with agreement measured).",
            "Findings documents made of quote cards that always show the stored words, shared by a link you can revoke.",
          ]}
        />
      </Section>

      <Section id="surveys" title="Surveys">
        <Bullets
          items={[
            "NPS, CSAT, choice and free-text questions.",
            "An audience built from rules over your people and accounts, with a preview of who would get it.",
            "Approved email invitations and reminders, a public link, or an embed in your own page.",
            'Questions that appear depending on up to four earlier answers, combined with "all" or "any".',
            "One final answer per person. If a person is deleted, their answers are removed or anonymised, as you choose.",
          ]}
        />
      </Section>

      <Section id="desk" title="A support desk that feeds the same loop">
        <Bullets
          items={[
            "Website chat and email in one shared inbox, with private notes and assignment to a named teammate.",
            "Saved replies, a reply-time target, median and slow-end first-reply times, and who is waiting.",
            "Two people cannot reply at once: a conversation that changed while you read it asks you to look again.",
            "Send a customer's message to the review queue and watch what came of it.",
          ]}
        />
      </Section>

      <Section id="public" title="Public pages">
        <Bullets
          items={[
            "A release-note page and a public roadmap on a short address you choose.",
            "An embeddable feedback form, chat window and survey.",
            "Only items you explicitly publish are public; nothing private is on a public route.",
          ]}
        />
      </Section>

      <Section id="connect" title="Integrations, an API and AI assistants">
        <Bullets
          items={[
            "Open issues in GitHub (and, as each is switched on, Linear, Jira, ClickUp, Asana and Azure DevOps) and let the request follow the issue. Issues never contain customer quotes, names or emails.",
            "Signed webhooks for your own code, or plain sentences in a Slack, Discord or Teams channel.",
            "A public API with scoped, expiring, address-limited keys.",
            "Ten tools for AI assistants (Claude, ChatGPT, Cursor and others) behind an approval page you control, with quotes that look like instructions withheld from them.",
          ]}
        />
      </Section>

      <Section id="trust" title="Trust, privacy and control">
        <Bullets
          items={[
            "Workspaces are isolated at the database level. Invite teammates by email, give each an admin, member or viewer role, and change or remove them any time; roles are enforced on every route.",
            "Customer text is never used to train models and goes only to AI routes marked as allowed to receive it. Every AI call records the provider, model, prompt version, tokens and cost.",
            "A daily AI allowance per workspace stops runaway cost.",
            "Export your whole workspace, or delete a person and everything about them.",
            "Built toward WCAG 2.2 AA, with keyboard use and phone layouts.",
          ]}
        />
      </Section>

      <CallToAction />
    </Page>
  );
}
