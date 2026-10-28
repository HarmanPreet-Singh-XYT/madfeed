import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, FileCheck2, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconTile, TINT } from "@/components/site/landing";
import type { Hue } from "@/components/site/landing";
import { CtaCard, PageHero, ghostButton, sunButton } from "@/components/site/page-kit";
import { CodeTabs } from "@/components/site/code-tabs";
import { CallWave, DeskChat, NpsBar, RoadmapMini, ScatterToOrder } from "@/components/site/bento";
import { AskRefuse, PriorityChart, QuoteProof, ReviewQueue, ShipTimeline } from "@/components/site/visuals";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Everything between a customer conversation and a personal reply: intake, cited extraction, review, weighted requests, research, surveys, a support desk, release notes and more.",
};

const wrap = (node: ReactNode) => <div className="rounded-2xl bg-card p-4 shadow-card">{node}</div>;

type Block = {
  id: string;
  nav: string;
  tint: Hue;
  eyebrow: string;
  title: string;
  intro: string;
  bullets: ReactNode[];
  visual: ReactNode;
};

const BLOCKS: Block[] = [
  {
    id: "intake",
    nav: "Bring feedback in",
    tint: "blue",
    eyebrow: "Intake",
    title: "Bring feedback in, from anywhere",
    intro:
      "Conversations arrive in many places, so there are many ways in. All of them end in the same place: an untouched, stored source, split into pieces, with sensitive numbers hidden, waiting to be read.",
    bullets: [
      "Paste a conversation, with the person, account and a link back if you have them.",
      "Upload a call or interview recording (large files, resumable) and get a transcript with speakers and timing.",
      "Import people and accounts from a CSV: columns are detected, you see a preview, and every bad row is named.",
      "Add a feedback form or a chat window to your website, limited to the sites you allow, with files in chat both ways.",
      "Forward or route customer email in from any mail provider.",
      "Collect messages from a Slack channel you choose.",
      "Let other tools post in: help desks, form tools, automation services and call-recording tools send notes and transcripts through one endpoint, and a retry never stores one twice.",
      "Run surveys; free-text answers join the review queue.",
    ],
    visual: <ScatterToOrder />,
  },
  {
    id: "review",
    nav: "Cited extraction and review",
    tint: "coral",
    eyebrow: "Review",
    title: "Cited extraction and a review queue",
    intro:
      "The AI reads each source and proposes the requests inside it. Each suggestion shows the original text with the supporting sentence highlighted, a confidence, and whether it looks like a new request or more evidence for an existing one.",
    bullets: [
      "Every quote must appear word for word in the original at the stored position. Two code checks and a database rule enforce it, so an invented quote cannot be stored.",
      "Nothing becomes a request until a person accepts it. Accept, edit the title, merge into an existing request, or dismiss; undo any of it.",
      "Bulk-accept suggestions above a confidence you choose.",
      "A suggestion that looks like an existing request says so, with the reason, and a person presses the button. Nothing merges by itself.",
    ],
    visual: (
      <div className="space-y-4">
        <QuoteProof />
        <ReviewQueue />
      </div>
    ),
  },
  {
    id: "requests",
    nav: "Requests, people and value",
    tint: "amber",
    eyebrow: "Prioritise",
    title: "Requests, people and what they are worth",
    intro:
      "A request gathers evidence: who said it, which account they belong to, in which source, and exactly where. The numbers update as evidence is added.",
    bullets: [
      "Impact shows quotes, people, accounts and total value. Value is summed over distinct accounts, so two people from one account count that account once.",
      "Customisable statuses, tags and areas; filters; sorting by value or newest; saved views you can share.",
      "People and accounts with revenue, plan and renewal date, from a strict CSV import, by hand, or read-only from HubSpot or Salesforce.",
      'Search quotes by meaning, so "I can\'t log in with my company account" finds "SSO is broken" too.',
    ],
    visual: <PriorityChart />,
  },
  {
    id: "ask",
    nav: "Questions and briefs",
    tint: "sky",
    eyebrow: "Ask",
    title: "Questions and briefs you can verify",
    intro: "Ask in plain language and get an answer you can check, or an honest refusal.",
    bullets: [
      "Ask a question about what customers said. The answer is built only from stored quotes and cites them, or says there is no evidence. Questions with a false premise are refused.",
      "A decision brief for any request summarises the evidence, with every claim linked to its quote.",
      "A quality page shows how often accepted suggestions were edited or dismissed, and a weekly spot check samples answers and briefs for a person to grade.",
    ],
    visual: <AskRefuse />,
  },
  {
    id: "loop",
    nav: "Close the loop",
    tint: "teal",
    eyebrow: "Close the loop",
    title: "Close the loop with the people who asked",
    intro:
      "Marking a request shipped prepares a personal draft for each person who asked, written from their own words. You review each message, edit it, and approve. Only approved messages are sent, and that rule lives in the sending code, not just the screen.",
    bullets: [
      "A send log, a signed unsubscribe link in every message, an honoured opt-out list, and bounce and complaint handling.",
      '"Told about this" marks on each request, so you know who has heard.',
      "Release notes written by you, linked to requests, published now or scheduled for an exact moment, with a public page.",
      "A public roadmap where signed-in visitors vote; votes from known customers are marked verified.",
    ],
    visual: <ShipTimeline />,
  },
  {
    id: "research",
    nav: "Calls, highlights, findings",
    tint: "amber",
    eyebrow: "Research",
    title: "Calls, highlights and findings",
    intro: "Turn recordings into searchable moments, and share what you learned as quotes that cannot drift.",
    bullets: [
      "Timed transcripts with speakers and a player; every highlight maps to a moment.",
      "A tag codebook with definitions and colours; merge two tags and undo it exactly.",
      "Highlight by hand, or accept suggested highlights from the codebook.",
      "A quotes screen as a table or a board, with tags over time and feeling labels (by a model or a person, with agreement measured).",
      "Findings documents made of quote cards that always show the stored words, shared by a link you can revoke.",
    ],
    visual: wrap(<CallWave />),
  },
  {
    id: "surveys",
    nav: "Surveys",
    tint: "blue",
    eyebrow: "Surveys",
    title: "Surveys",
    intro: "Ask the right people the right question, and feed the answers into the same queue.",
    bullets: [
      "NPS, CSAT, choice and free-text questions.",
      "An audience built from rules over your people and accounts, with a preview of who would get it.",
      "Approved email invitations and reminders, a public link, or an embed in your own page.",
      'Questions that appear depending on up to four earlier answers, combined with "all" or "any".',
      "One final answer per person. If a person is deleted, their answers are removed or anonymised, as you choose.",
    ],
    visual: wrap(<NpsBar />),
  },
  {
    id: "desk",
    nav: "Support desk",
    tint: "coral",
    eyebrow: "Support desk",
    title: "A support desk that feeds the same loop",
    intro: "Answer customers in one shared inbox, and turn what they say into requests without copying anything.",
    bullets: [
      "Website chat and email in one shared inbox, with private notes and assignment to a named teammate.",
      "Saved replies, a reply-time target, median and slow-end first-reply times, and who is waiting.",
      "Two people cannot reply at once: a conversation that changed while you read it asks you to look again.",
      "Send a customer's message to the review queue and watch what came of it.",
    ],
    visual: wrap(<DeskChat />),
  },
  {
    id: "public",
    nav: "Public pages",
    tint: "sky",
    eyebrow: "Public pages",
    title: "Public pages",
    intro: "Show customers what you are doing, and let them weigh in.",
    bullets: [
      "A release-note page and a public roadmap on a short address you choose.",
      "An embeddable feedback form, chat window and survey.",
      "Only items you explicitly publish are public; nothing private is on a public route.",
    ],
    visual: wrap(<RoadmapMini />),
  },
  {
    id: "connect",
    nav: "Integrations, API, assistants",
    tint: "blue",
    eyebrow: "Connect",
    title: "Integrations, an API and AI assistants",
    intro: "Fit into the tools you already use, or build your own with a few lines of code.",
    bullets: [
      "Open issues in GitHub (and, as each is switched on, Linear, Jira, ClickUp, Asana and Azure DevOps) and let the request follow the issue. Issues never contain customer quotes, names or emails.",
      "Signed webhooks for your own code, or plain sentences in a Slack, Discord or Teams channel.",
      "A public API with scoped, expiring, address-limited keys.",
      "Ten tools for AI assistants (Claude, ChatGPT, Cursor and others) behind an approval page you control, with quotes that look like instructions withheld from them.",
    ],
    visual: <CodeTabs />,
  },
];

const TRUST: { icon: typeof LockKeyhole; hue: Hue; title: string; body: string }[] = [
  { icon: LockKeyhole, hue: "blue", title: "Isolated workspaces", body: "Separated at the database level, with roles enforced on every route." },
  { icon: ShieldCheck, hue: "teal", title: "Never trains models", body: "Customer text goes only to AI routes marked as allowed to receive it." },
  { icon: FileCheck2, hue: "amber", title: "Every AI call logged", body: "Provider, model, prompt version, tokens and cost, plus a daily allowance." },
  { icon: Trash2, hue: "coral", title: "Export and delete", body: "Export your whole workspace, or delete a person and everything about them." },
];

export default function Features() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything between a customer's words and your reply"
        lead="One place and one data model for what customers said, what it is worth, and telling them what you did about it."
        actions={
          <>
            <Button asChild size="lg" className={sunButton}>
              <Link href="/signup">Start free</Link>
            </Button>
            <Button asChild size="lg" className={ghostButton}>
              <Link href="/pricing">
                See pricing <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </>
        }
        ticks={["Useful from the first pasted conversation", "Nothing sent without your approval"]}
      />

      <nav
        aria-label="On this page"
        className="sticky top-[61px] z-30 border-b border-border bg-background/90 backdrop-blur"
      >
        <ul className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3">
          {[...BLOCKS.map((b) => [b.id, b.nav]), ["trust", "Trust and control"]].map(([id, label]) => (
            <li key={id} className="shrink-0">
              <a
                href={`#${id}`}
                className="inline-flex min-h-9 items-center rounded-full bg-secondary px-4 text-sm font-medium transition-colors hover:bg-accent"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-12 sm:py-16">
        {BLOCKS.map((b, i) => (
          <div key={b.id} className="space-y-8">
            <section
              id={b.id}
              aria-labelledby={`${b.id}-h`}
              className={cn(
                "reveal scroll-mt-36 rounded-[2rem] p-6 shadow-card sm:p-12",
                TINT[b.tint],
              )}
            >
              <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-14">
                <div className={cn("space-y-5", i % 2 === 1 && "lg:order-2")}>
                  <p className="text-xs font-semibold tracking-widest text-link uppercase">{b.eyebrow}</p>
                  <h2
                    id={`${b.id}-h`}
                    className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl"
                  >
                    {b.title}
                  </h2>
                  <p className="text-lg text-muted-foreground">{b.intro}</p>
                  <ul className="space-y-2.5">
                    {b.bullets.map((t, n) => (
                      <li key={n} className="flex gap-2.5">
                        <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-link" />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={cn("min-w-0 lg:sticky lg:top-40", i % 2 === 1 && "lg:order-1")}>{b.visual}</div>
              </div>
            </section>
            {i === 4 ? (
              <CtaCard
                title="Want to see the loop on your own data?"
                text="Paste one conversation and watch it become cited, weighted requests."
              />
            ) : null}
          </div>
        ))}

        <section
          id="trust"
          aria-labelledby="trust-h"
          className="reveal scroll-mt-36 rounded-[2rem] bg-ink p-6 text-on-brand sm:p-12"
        >
          <div className="mb-8 max-w-2xl space-y-3">
            <p className="text-xs font-semibold tracking-widest text-on-brand/70 uppercase">Trust</p>
            <h2 id="trust-h" className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Trust, privacy and control
            </h2>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t) => (
              <li key={t.title} className="space-y-3 rounded-3xl border border-on-brand/15 bg-on-brand/5 p-6">
                <IconTile icon={t.icon} hue={t.hue} />
                <h3 className="font-display font-semibold">{t.title}</h3>
                <p className="text-sm text-on-brand/75">{t.body}</p>
              </li>
            ))}
          </ul>
          <ul className="mt-8 space-y-2.5 text-on-brand/90">
            {[
              "Invite teammates by email, give each an admin, member or viewer role, and change or remove them any time.",
              "A daily AI allowance per workspace stops runaway cost.",
              "Built toward WCAG 2.2 AA, with keyboard use and phone layouts.",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-sun" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-8">
            <Link href="/security" className="font-semibold underline underline-offset-4 hover:no-underline">
              Read the security page
            </Link>
          </p>
        </section>

        <CtaCard />
      </div>
    </>
  );
}
