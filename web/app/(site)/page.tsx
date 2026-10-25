import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { INTEGRATION_GROUPS } from "@/lib/site-data";
import { Cards, CallToAction } from "@/components/site/blocks";
import { btn, btnPrimary, card } from "@/components/ui";

export const metadata: Metadata = {
  title: {
    absolute: `${SITE.name}: customer feedback you can trust and act on`,
  },
  description:
    "Turn customer conversations into cited, prioritised requests, weigh them by who asked, and tell the people who asked when it ships.",
};

const STEPS = [
  {
    n: "1",
    title: "Bring conversations in",
    body: "Paste one, upload a call, forward email, add a chat window to your site, or let your tools post them in.",
  },
  {
    n: "2",
    title: "Review what it found",
    body: "The AI proposes requests, each with the exact sentence that supports it. You accept, edit, merge or dismiss.",
  },
  {
    n: "3",
    title: "See what matters",
    body: "Requests are weighed by the accounts that asked and what they are worth, with every quote one click away.",
  },
  {
    n: "4",
    title: "Decide with evidence",
    body: "Ask questions answered only from real quotes, get cited briefs, and share a public roadmap.",
  },
  {
    n: "5",
    title: "Close the loop",
    body: "When it ships, review and approve a personal message to each person who asked. Nothing goes out without you.",
  },
];

export default function Landing() {
  const available = INTEGRATION_GROUPS.flatMap((g) => g.items).filter(
    (i) => i.status === "available",
  ).length;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-20 px-4 py-14">
      <section aria-labelledby="hero" className="space-y-6 text-center">
        <h1
          id="hero"
          className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl"
        >
          Know what your customers are asking for, and prove it.
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          {SITE.name} reads the conversations you already have, finds the
          requests inside them with the exact words behind each one, weighs them
          by who asked, and helps you tell those people when it ships.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/signup" className={btnPrimary}>
            Get started free
          </Link>
          <Link href="/features" className={btn}>
            See how it works
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Paste one conversation and see cited requests in minutes. No setup
          first.
        </p>
      </section>

      <section aria-labelledby="chain" className="space-y-6">
        <h2 id="chain" className="text-center text-3xl font-semibold">
          From a conversation to a personal reply
        </h2>
        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map((s) => (
            <li key={s.n} className={`${card} space-y-2`}>
              <p
                aria-hidden="true"
                className="text-sm font-semibold text-link"
              >
                Step {s.n}
              </p>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="promises" className="space-y-6">
        <h2 id="promises" className="text-center text-3xl font-semibold">
          Built so you can check its work
        </h2>
        <Cards
          items={[
            {
              title: "Every claim has a source",
              body: "Quotes are checked to appear word for word in the original. Answers cite them, or say there is no evidence. A made-up quote cannot be saved.",
            },
            {
              title: "You decide, not the AI",
              body: "Suggestions wait in a review queue. Nothing becomes a request, and nothing is sent to a customer, until a person approves it.",
            },
            {
              title: "Weighted by who is asking",
              body: "A request is worth the accounts behind it, summed once per account. Import values, or read them from your CRM.",
            },
            {
              title: "Private by design",
              body: "Each workspace is isolated in the database. Customer text is never used to train models, and card numbers, keys and passwords are hidden before anything is stored.",
            },
            {
              title: "Works where your team works",
              body: `${available} ways to bring feedback in or send work out today, plus a web request almost any tool can send, signed webhooks, an API and AI-assistant tools.`,
            },
            {
              title: "Honest about itself",
              body: "A quality page shows how often its suggestions were right, and a weekly spot check samples answers and briefs for a person to grade.",
            },
          ]}
        />
      </section>

      <section aria-labelledby="everything" className="space-y-6">
        <h2 id="everything" className="text-center text-3xl font-semibold">
          One place for the whole loop
        </h2>
        <Cards
          items={[
            {
              title: "Requests and evidence",
              body: "Statuses, tags, saved views and a table you can sort by value, with every quote behind each request.",
            },
            {
              title: "Calls and interviews",
              body: "Upload recordings, read timed transcripts with speakers, highlight and tag moments, and get suggested highlights.",
            },
            {
              title: "Surveys",
              body: "NPS, CSAT, choice and free text, targeted by rules over your people and accounts, with branching questions.",
            },
            {
              title: "Support desk",
              body: "Website chat and email in a shared inbox: hand over, saved replies, reply times, files, and a button to send a message to the review queue.",
            },
            {
              title: "Release notes and roadmap",
              body: "Publish or schedule release notes and a public roadmap where signed-in visitors can vote.",
            },
            {
              title: "Findings",
              body: "Share research as documents made of quote cards that always show the stored words, by a link you can revoke.",
            },
          ]}
        />
        <p className="text-center">
          <Link
            href="/features"
            className="text-link underline underline-offset-2 hover:no-underline"
          >
            All features
          </Link>
        </p>
      </section>

      <section aria-labelledby="int" className="space-y-4 text-center">
        <h2 id="int" className="text-3xl font-semibold">
          Connect what you already use
        </h2>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Slack, GitHub, webhooks, an API and AI-assistant tools are available
          now. Linear, Jira, ClickUp, Asana, Azure DevOps, HubSpot and
          Salesforce are built and arriving as each is tried against the real
          service. Anything else that can send a web request already works.
        </p>
        <Link href="/integrations" className={btn}>
          See every integration
        </Link>
      </section>

      <CallToAction />
    </div>
  );
}
