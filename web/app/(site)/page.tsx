import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronDown,
  LockKeyhole,
  MessageSquareQuote,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { FAQS, INTEGRATION_GROUPS } from "@/lib/site-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Band,
  FloatingQuotes,
  GRADIENT,
  IconTile,
  LiftCard,
  Marquee,
  SectionHead,
  StackPanel,
  TINT,
  TextLink,
  Timeline,
  Wave,
} from "@/components/site/landing";
import { HeroDemo } from "@/components/site/hero-demo";
import { AskPalette } from "@/components/site/ask-palette";
import { RoleTabs } from "@/components/site/role-tabs";
import type { Role } from "@/components/site/role-tabs";
import { CodeTabs } from "@/components/site/code-tabs";
import { Versus } from "@/components/site/versus";
import {
  BentoCell,
  CallWave,
  DeskChat,
  IntegrationTiles,
  NpsBar,
  PipelineDiagram,
  RoadmapMini,
  ScatterToOrder,
  Scoreboard,
  StickyCta,
} from "@/components/site/bento";
import type { Hue } from "@/components/site/landing";
import {
  AskRefuse,
  ChartCard,
  Count,
  FunnelChart,
  Heatmap,
  PriorityChart,
  QuoteProof,
  ReviewQueue,
  ShipTimeline,
  SourcesChart,
  TrendChart,
} from "@/components/site/visuals";

export const metadata: Metadata = {
  title: {
    absolute: `${SITE.name}: customer feedback you can trust and act on`,
  },
  description:
    "Turn customer conversations into cited, prioritised requests, weigh them by who asked, and tell the people who asked when it ships.",
};

const SOURCES = [
  "Pasted conversations",
  "Call recordings",
  "Email",
  "Website chat",
  "Surveys",
  "Feedback form",
  "Slack",
  "API and webhooks",
  "Support inbox",
  "Release notes",
];

const PAINS: { icon: typeof Users; hue: Hue; before: string; after: string }[] =
  [
    {
      icon: MessageSquareQuote,
      hue: "coral",
      before: "Feedback is scattered across calls, tickets, chats and DMs.",
      after:
        "Everything lands in one review queue, each item kept as an untouched source.",
    },
    {
      icon: Users,
      hue: "sky",
      before: "The loudest voice wins, and nobody can say what it is worth.",
      after:
        "Every request is weighed by the accounts behind it, each counted once.",
    },
    {
      icon: Send,
      hue: "amber",
      before: "People who asked never hear back, so they stop asking.",
      after:
        "When it ships, you approve a personal note to each person who asked.",
    },
  ];

const STEPS = [
  {
    title: "Bring conversations in",
    body: "Paste one, upload a call, forward email, add a chat window to your site, or let your tools post them in. Card numbers, keys and passwords are hidden before anything is stored.",
  },
  {
    title: "Review what it found",
    body: "The AI proposes requests, each with the exact sentence that supports it. You accept, edit, merge or dismiss. Nothing becomes a request until you say so.",
  },
  {
    title: "See what matters",
    body: "Requests are weighed by the accounts that asked and what they are worth. Every quote is one click away, so nobody has to take a number on trust.",
  },
  {
    title: "Decide with evidence",
    body: "Ask questions answered only from real quotes, get cited briefs for the meeting, and share a public roadmap people can vote on.",
  },
  {
    title: "Close the loop",
    body: "Mark a request shipped and personal drafts appear, built from each person’s own words. You approve; only approved messages are sent.",
  },
];

const SHOWCASE: {
  tint: Hue;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: React.ReactNode;
}[] = [
  {
    tint: "blue",
    eyebrow: "Evidence",
    title: "Every claim has a source",
    body: "Quotes are checked to appear word for word in the original at the stored position. A made-up quote cannot be saved.",
    points: [
      "Click any request to see every sentence behind it",
      "Answers cite quotes, or say there is no evidence",
      "Redacted before storage: card numbers, keys, passwords",
    ],
    visual: <QuoteProof />,
  },
  {
    tint: "coral",
    eyebrow: "Review",
    title: "You decide, not the AI",
    body: "Suggestions wait in a review queue until a person accepts them. Nothing becomes a request, and nothing is sent, without you.",
    points: [
      "Accept, edit, merge or dismiss every suggestion",
      "Bulk-accept the obvious ones in one click",
      "A quality page shows how often suggestions were right",
    ],
    visual: <ReviewQueue />,
  },
  {
    tint: "sky",
    eyebrow: "Ask",
    title: "Answers that cite, or refuse",
    body: "Ask in plain language: why are trials not converting, who wants SSO. You get quotes back, or a plain “there is no evidence”.",
    points: [
      "Cited briefs ready for planning",
      "Refuses questions your data cannot answer",
      "Works from your own conversations only",
    ],
    visual: <AskRefuse />,
  },
  {
    tint: "amber",
    eyebrow: "Prioritise",
    title: "Weighted by who is asking",
    body: "A request is worth the accounts behind it, summed once per account. Import values from a CSV, or read them from your CRM.",
    points: [
      "Two people from one account count once",
      "Sort the whole table by value",
      "Saved views for every meeting",
    ],
    visual: <PriorityChart />,
  },
  {
    tint: "teal",
    eyebrow: "Close the loop",
    title: "Tell the people who asked",
    body: "When a request ships, personal drafts are built from each person’s own words. You review and approve; only approved messages go out.",
    points: [
      "Enforced in the sending code, not only on the screen",
      "Unsubscribe link and opt-outs honoured",
      "A “told about this” mark on every person",
    ],
    visual: <ShipTimeline />,
  },
];

const ROLES: Role[] = [
  {
    id: "pm",
    label: "Product managers",
    title: "Walk into planning with a ranked list",
    body: "Stop re-reading transcripts. Every line on the list carries its quotes, and its worth in accounts.",
    points: [
      "Ranked by the value of the accounts asking, each counted once",
      "Cited briefs you can paste into the meeting notes",
      "Saved views for every review and roadmap session",
    ],
    prompts: [
      {
        q: "What should we build next quarter?",
        a: "By value: Export to CSV ($84k), Single sign-on ($61k), Slack alerts ($27k). Each links to its quotes.",
      },
      {
        q: "What changed since the last sprint?",
        a: "Export to CSV went from 9 to 15 mentions a week.",
      },
    ],
    visual: <PriorityChart />,
  },
  {
    id: "founder",
    label: "Founders",
    title: "Hear the next ten customers, without reading all of it",
    body: "Paste what you heard this week. See what came up more than once, and show your team the proof behind a decision.",
    points: [
      "Works from the first conversation, with no setup",
      "Refuses to guess when the data does not say",
      "Share the evidence with one revocable link",
    ],
    prompts: [
      {
        q: "What confuses people in onboarding?",
        a: "Five accounts say setup takes too long [1][2][3].",
      },
      {
        q: "Why do customers cancel?",
        a: "No evidence in your conversations, so no answer. Import cancellation notes to answer this.",
        refused: true,
      },
    ],
    visual: <AskRefuse />,
  },
  {
    id: "support",
    label: "Support and success",
    title: "Turn the ticket pile into requests, then close the loop",
    body: "Send a customer message to the review queue in one click, and tell people when what they asked for ships.",
    points: [
      "Shared inbox for website chat and email, with private notes",
      "A live status card follows each request you raise",
      "Personal drafts you approve before anything is sent",
    ],
    prompts: [
      {
        q: "Which tickets are really feature requests?",
        a: "12 this week. 7 are already linked to a request.",
      },
      {
        q: "Who should hear about the export fix?",
        a: "3 people asked. 3 personal drafts are ready for your approval.",
      },
    ],
    visual: <ShipTimeline />,
  },
  {
    id: "research",
    label: "Researchers",
    title: "Findings made of quotes that cannot drift",
    body: "Highlight and tag moments in calls, then share a document of quote cards that always shows the stored words.",
    points: [
      "Timed transcripts with speakers, and a player",
      "Tags with merge and an exact undo",
      "Every quote checked verbatim against its source",
    ],
    prompts: [
      {
        q: "Show me quotes about onboarding.",
        a: "8 quotes from 5 people, tagged and ready for a findings document.",
      },
      {
        q: "How many people mention pricing?",
        a: "4 people across 3 accounts. Quotes attached.",
      },
    ],
    visual: <QuoteProof />,
  },
];

const PLANS = [
  {
    name: "Free",
    for: "Try it with your own conversations",
    items: [
      "Paste, review and requests",
      "People, accounts and value",
      "Cited questions and briefs",
      "Approved messages to customers",
    ],
  },
  {
    name: "Team",
    for: "For product and research teams",
    featured: true,
    items: [
      "Everything in Free",
      "Recordings and transcripts",
      "Surveys and public roadmap",
      "Integrations and weekly digest",
      "Up to 3 API keys",
    ],
  },
  {
    name: "Business",
    for: "For larger teams and heavier use",
    items: [
      "Everything in Team",
      "The largest daily AI allowance",
      "Up to 10 API keys",
    ],
  },
];

const TRUST: { icon: typeof Users; hue: Hue; title: string; body: string }[] = [
  {
    icon: BookOpenCheck,
    hue: "blue",
    title: "A made-up quote cannot be saved",
    body: "Every stored quote must appear word for word in its source at the stored position. Answers cite quotes or say there is no evidence.",
  },
  {
    icon: BadgeCheck,
    hue: "teal",
    title: "Secrets are hidden before they are stored",
    body: "Card numbers, keys and passwords are redacted at ingest, before storage and before any AI call. Every message to a customer has an unsubscribe link, and opt-outs are honoured.",
  },
  {
    icon: LockKeyhole,
    hue: "sky",
    title: "Each workspace is isolated",
    body: "Separation is enforced in the database, and every request runs inside it. Teammates only see what their role allows.",
  },
  {
    icon: ShieldCheck,
    hue: "coral",
    title: "Never used to train models",
    body: "Customer text only goes to AI routes marked as allowed to receive it. Every AI call is logged with provider, model, tokens and cost.",
  },
  {
    icon: Trash2,
    hue: "amber",
    title: "Deleting a person deletes everything",
    body: "Quotes, transcripts, recordings, survey answers and files go together. You can export your data at any time.",
  },
  {
    icon: Sparkles,
    hue: "blue",
    title: "Honest about its own accuracy",
    body: "A quality page shows how often suggestions were right, and a weekly spot check samples answers for a person to grade.",
  },
];

const SAMPLE_WEEK = [
  { to: 38, label: "open requests", hue: "blue" },
  { to: 12, label: "shipped", hue: "teal" },
  { to: 31, label: "people told", hue: "amber" },
] as const;

const ghostOnBrand =
  "h-12 rounded-xl border border-on-brand/40 bg-on-brand/10 px-7 text-base font-semibold text-on-brand shadow-none backdrop-blur transition-[translate,background-color] hover:-translate-y-0.5 hover:bg-on-brand/20";
const sunOnBrand =
  "h-12 rounded-xl bg-sun px-7 text-base font-bold text-ink shadow-raised transition-[translate,background-color] hover:-translate-y-0.5 hover:bg-sun/90";

export default function Landing() {
  const items = INTEGRATION_GROUPS.flatMap((g) => g.items);
  const available = items.filter((i) => i.status === "available");
  const soon = items.filter((i) => i.status === "soon");
  const SHOWN = 11;
  return (
    <>
      <section
        aria-labelledby="hero"
        className={cn("relative overflow-hidden px-4 pt-14 sm:pt-20", GRADIENT)}
      >
        <div
          aria-hidden="true"
          className="drift absolute -top-32 -left-32 size-[28rem] rounded-full bg-hue-sky/45 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="drift absolute top-52 -right-32 size-[28rem] rounded-full bg-hue-teal/55 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute top-8 left-1/2 size-72 -translate-x-1/2 rounded-full bg-sun/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl">
          <FloatingQuotes />
          <div className="mx-auto max-w-3xl space-y-6 text-center text-on-brand">
            <Link
              href="/features"
              className="group inline-flex items-center gap-2 rounded-full bg-on-brand/15 py-1.5 pr-3 pl-4 text-sm font-medium backdrop-blur transition-colors hover:bg-on-brand/25"
            >
              <Sparkles aria-hidden="true" className="size-4 text-sun" />
              Every claim comes with its source
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <h1
              id="hero"
              className="text-fade font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-6xl"
            >
              Know what your customers are asking for, and{" "}
              <span className="underline decoration-sun decoration-wavy decoration-4 underline-offset-[10px]">
                prove it.
              </span>
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-pretty text-on-brand/90 sm:text-xl">
              {SITE.name} reads the conversations you already have, finds the
              requests inside them with the exact words behind each one, weighs
              them by who asked, and helps you tell those people when it ships.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className={sunOnBrand}>
                <Link href="/signup">Get started free</Link>
              </Button>
              <Button asChild size="lg" className={ghostOnBrand}>
                <Link href="/features">
                  See how it works <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-on-brand/90">
              {[
                "Paste one conversation, see cited requests in minutes",
                "No setup first",
                "You approve everything",
              ].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check aria-hidden="true" className="size-4 text-sun" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto mt-12 max-w-5xl pb-16 sm:pb-28">
            <HeroDemo />
            <p className="mt-4 text-center text-xs text-on-brand/80">
              A sample conversation, played back. Pick another, or replay it.
            </p>
          </div>
        </div>
        <Wave />
      </section>

      <section aria-label="Where feedback comes from" className="py-10">
        <p className="mb-4 px-4 text-center text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Bring in feedback from wherever it already lives
        </p>
        <Marquee items={SOURCES} />
      </section>

      <Band id="problem">
        <SectionHead
          id="problem"
          eyebrow="Why it exists"
          title="Customers tell you exactly what they need. It just never makes it to the roadmap."
          lead="The answers are already in your calls, tickets and chats. The work is finding them, proving them and acting on them."
        />
        <div className="space-y-8">
          <ScatterToOrder />
          <ul className="grid gap-6 md:grid-cols-3">
            {PAINS.map((p, i) => (
              <LiftCard
                key={p.before}
                index={i}
                className="flex flex-col gap-4"
              >
                <IconTile icon={p.icon} hue={p.hue} />
                <p className="text-muted-foreground line-through decoration-input/60">
                  {p.before}
                </p>
                <p className="font-display text-lg leading-snug font-semibold text-pretty">
                  {p.after}
                </p>
              </LiftCard>
            ))}
          </ul>
        </div>
      </Band>

      <Band id="features" tone="muted">
        <SectionHead
          id="features"
          eyebrow="What you get"
          title="Built so you can check its work"
          lead="Most tools ask you to trust a summary. This one shows you the sentence."
        />
        <div className="flex flex-col gap-6 pb-2">
          {SHOWCASE.map((s, i) => (
            <StackPanel key={s.title} tint={s.tint} index={i}>
              <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-14">
                <div className={cn("space-y-5", i % 2 === 1 && "lg:order-2")}>
                  <p className="text-xs font-semibold tracking-widest text-link uppercase">
                    {s.eyebrow}
                  </p>
                  <h3 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                    {s.title}
                  </h3>
                  <p className="text-lg text-muted-foreground">{s.body}</p>
                  <ul className="space-y-2">
                    {s.points.map((p) => (
                      <li key={p} className="flex gap-2.5">
                        <Check
                          aria-hidden="true"
                          className="mt-1 size-4 shrink-0 text-link"
                        />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={cn(i % 2 === 1 && "lg:order-1")}>
                  {s.visual}
                </div>
              </div>
            </StackPanel>
          ))}
        </div>
      </Band>

      <Band id="chain">
        <SectionHead
          id="chain"
          eyebrow="How it works"
          title="From a conversation to a personal reply"
          lead="Five steps, and you stay in charge of every one."
        />
        <div className="space-y-12">
          <PipelineDiagram />
          <div className="mx-auto max-w-3xl">
            <Timeline steps={STEPS} />
          </div>
          <p className="text-center">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-xl px-7 text-base"
            >
              <Link href="/docs/getting-started">
                Read the quick start <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </p>
        </div>
      </Band>

      <Band id="tools" tone="muted">
        <SectionHead
          id="tools"
          eyebrow="One platform"
          title="Everything the loop needs, in one place"
          lead="From the first call to the release note, nothing to stitch together."
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-6">
          <BentoCell
            className="lg:col-span-3"
            fig="Fig 1.1 · Ask"
            title="Ask anything, get quotes or a refusal"
            body="Plain-language questions, answered only from your stored quotes."
            tint="sky"
            index={0}
          >
            <AskPalette />
          </BentoCell>
          <BentoCell
            className="lg:col-span-3"
            fig="Fig 1.2 · Calls"
            title="Calls and interviews, searchable by moment"
            body="Timed transcripts with speakers. Highlight and tag, or take the suggested highlights."
            tint="amber"
            index={1}
          >
            <CallWave />
          </BentoCell>
          <BentoCell
            className="lg:col-span-2"
            fig="Fig 1.3 · Surveys"
            title="Surveys that target the right people"
            body="NPS, CSAT, choice and free text, with branching. Free text goes to review."
            tint="teal"
            index={0}
          >
            <NpsBar />
          </BentoCell>
          <BentoCell
            className="lg:col-span-2"
            fig="Fig 1.4 · Support desk"
            title="A shared inbox that feeds the queue"
            body="Website chat and email, private notes, hand-over, saved replies."
            tint="coral"
            index={1}
          >
            <DeskChat />
          </BentoCell>
          <BentoCell
            className="lg:col-span-2"
            fig="Fig 1.5 · Roadmap"
            title="A public roadmap people can vote on"
            body="Release notes and a roadmap for signed-in visitors."
            tint="blue"
            index={2}
          >
            <RoadmapMini />
          </BentoCell>
        </div>
        <p className="mt-10 text-center">
          <Button asChild size="lg" className="h-12 rounded-xl px-7 text-base">
            <Link href="/features">See all features</Link>
          </Button>
        </p>
      </Band>

      <Band id="shape">
        <SectionHead
          id="shape"
          eyebrow="See the shape of it"
          title="Patterns you cannot see in a pile of transcripts"
          lead="Trends, sources and hot spots, drawn from the same quotes you can click through to."
        />
        <ul
          aria-label="A sample week"
          className="mb-8 grid gap-4 sm:grid-cols-3"
        >
          {SAMPLE_WEEK.map((t, i) => (
            <li
              key={t.label}
              style={{ "--i": i } as React.CSSProperties}
              className={cn(
                "reveal flex items-baseline gap-3 rounded-3xl p-6",
                TINT[t.hue],
              )}
            >
              <span className="font-display text-5xl font-extrabold tracking-tight">
                <Count to={t.to} />
              </span>
              <span className="font-medium text-muted-foreground">
                {t.label}
                <span className="block text-xs">in a sample week</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <ChartCard
            className="reveal lg:col-span-3"
            title="What people mention, week by week"
            note="Mentions per week for three requests. Spot the one that is taking off."
            insight="Export to CSV went from 2 to 15 mentions a week in eight weeks."
          >
            <TrendChart />
          </ChartCard>
          <ChartCard
            className="reveal lg:col-span-2"
            title="Where feedback comes from"
            note="Share of quotes by source, this month against last."
            insight="Chat and surveys are growing. Calls are still the biggest source."
          >
            <SourcesChart />
          </ChartCard>
          <ChartCard
            className="reveal lg:col-span-3"
            title="Which tags are heating up"
            note="Mentions per tag per week. Darker means more."
            insight="Reporting is heating up while onboarding cools off."
          >
            <Heatmap />
          </ChartCard>
          <ChartCard
            className="reveal lg:col-span-2"
            title="From quote to shipped"
            note="Quotes found, accepted by you, grouped into requests, shipped."
            insight="31 people were told when these shipped."
          >
            <FunnelChart
              rows={[
                { label: "Quotes found", value: 412 },
                { label: "Accepted by you", value: 164 },
                { label: "Grouped into requests", value: 38 },
                { label: "Shipped", value: 12 },
              ]}
            />
          </ChartCard>
        </div>
      </Band>

      <Band id="who" tone="muted">
        <SectionHead
          id="who"
          eyebrow="Who it is for"
          title="See how it works for people like you"
          lead="Pick a role. Each one gets its own story and the questions it would ask."
        />
        <RoleTabs roles={ROLES} />
      </Band>

      <Band id="versus">
        <SectionHead
          id="versus"
          eyebrow="The difference"
          title="The old way, and this way"
          lead="Same job: decide what to build from what customers said. Different weekend."
        />
        <Versus />
      </Band>

      <Band id="api">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div className="reveal space-y-5">
            <p className="inline-flex rounded-full bg-secondary px-3 py-1 text-xs font-semibold tracking-wider text-link uppercase">
              For developers
            </p>
            <h2
              id="api-h"
              className="font-display text-3xl leading-tight font-bold tracking-tight text-balance sm:text-5xl"
            >
              Send feedback in from anywhere
            </h2>
            <p className="text-lg text-muted-foreground">
              One request from your help desk, form tool or script, and it lands
              in the review queue. Nothing is acted on until a person accepts
              it.
            </p>
            <ul className="space-y-2">
              {[
                "Scoped, expiring keys, limited to the addresses you allow",
                "Send the same externalId twice and it is stored once",
                "Signed outbound webhooks, and tools for AI assistants",
              ].map((p) => (
                <li key={p} className="flex gap-2.5">
                  <Check
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-link"
                  />
                  {p}
                </li>
              ))}
            </ul>
            <p className="flex flex-wrap gap-x-6 gap-y-2">
              <TextLink href="/docs/api">Read the API docs</TextLink>
              <TextLink href="/docs/sending-feedback">
                Sending-feedback guide
              </TextLink>
            </p>
          </div>
          <div className="reveal">
            <CodeTabs />
          </div>
        </div>
      </Band>

      <Band id="int" tone="muted">
        <SectionHead
          id="int"
          eyebrow="Integrations"
          title="Connect what you already use"
          lead="Anything that can send a web request already works. The rest are switched on once each has been tried against the real service."
        />
        <div className="space-y-6">
          <IntegrationTiles
            names={available.slice(0, SHOWN).map((i) => i.name)}
            more={Math.max(0, available.length - SHOWN)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              Coming soon ({soon.length})
            </span>
            {soon.map((i) => (
              <span
                key={i.name}
                className="rounded-full border-2 border-dashed border-input px-3.5 py-1 text-sm text-muted-foreground"
              >
                {i.name}
              </span>
            ))}
          </div>
          <p className="text-center">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-xl px-7 text-base"
            >
              <Link href="/integrations">See every integration</Link>
            </Button>
          </p>
        </div>
      </Band>

      <Band id="trust" tone="ink">
        <SectionHead
          id="trust"
          onInk
          eyebrow="Trust and privacy"
          title="Private by design, honest about itself"
          lead="Rules the product enforces in code, and the numbers we have measured, with how."
        />
        <div className="space-y-6">
          <Scoreboard />
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map((t, i) => (
              <li
                key={t.title}
                style={{ "--i": i % 3 } as React.CSSProperties}
                className="reveal group space-y-4 rounded-3xl border border-on-brand/15 bg-on-brand/5 p-7 transition-[translate,background-color] duration-300 hover:-translate-y-1.5 hover:bg-on-brand/10"
              >
                <IconTile icon={t.icon} hue={t.hue} />
                <h3 className="font-display text-lg font-semibold">
                  {t.title}
                </h3>
                <p className="text-sm text-on-brand/75">{t.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 text-center text-sm text-on-brand/75">
          Read the{" "}
          <Link
            href="/security"
            className="font-semibold text-on-brand underline underline-offset-4 hover:no-underline"
          >
            security page
          </Link>{" "}
          or the{" "}
          <Link
            href="/subprocessors"
            className="font-semibold text-on-brand underline underline-offset-4 hover:no-underline"
          >
            list of subprocessors
          </Link>
          .
        </p>
      </Band>

      <Band id="plans">
        <SectionHead
          id="plans"
          eyebrow="Pricing"
          title="Start free, move up when you need more"
          lead="Prices are announced before launch. This is what each plan includes today."
        />
        <ul className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
          {PLANS.map((p, i) => (
            <li
              key={p.name}
              style={{ "--i": i } as React.CSSProperties}
              className={cn(
                "reveal flex flex-col gap-5 rounded-3xl p-7 transition-[translate] duration-300 hover:-translate-y-1.5",
                p.featured
                  ? cn(
                      GRADIENT,
                      "text-on-brand shadow-raised md:-my-4 md:py-11",
                    )
                  : "bg-card shadow-card",
              )}
            >
              <div>
                <h3 className="font-display text-2xl font-bold">{p.name}</h3>
                <p
                  className={cn(
                    "text-sm",
                    p.featured ? "text-on-brand/85" : "text-muted-foreground",
                  )}
                >
                  {p.for}
                </p>
              </div>
              <ul className="flex-1 space-y-2.5 text-sm">
                {p.items.map((it) => (
                  <li key={it} className="flex gap-2.5">
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        p.featured ? "text-sun" : "text-hue-teal",
                      )}
                    />
                    {it}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-center">
          <TextLink href="/pricing">Compare plans in full</TextLink>
        </p>
      </Band>

      <Band id="faq" tone="muted">
        <SectionHead
          id="faq"
          eyebrow="Questions"
          title="Short, direct answers"
        />
        <div className="mx-auto max-w-3xl space-y-3">
          {FAQS.slice(0, 6).map((f, i) => (
            <details
              key={f.q}
              style={{ "--i": i } as React.CSSProperties}
              className="reveal group rounded-2xl bg-card p-5 shadow-card transition-colors open:bg-tint-blue"
            >
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 font-display font-semibold">
                {f.q}
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-link transition-transform duration-300 group-open:rotate-180"
                />
              </summary>
              <p className="mt-2 leading-relaxed text-muted-foreground">
                {f.a}
              </p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-center">
          <TextLink href="/faq">More questions answered</TextLink>
        </p>
      </Band>

      <section
        aria-labelledby="cta-h"
        className={cn("relative overflow-hidden px-4 pt-28 pb-24", GRADIENT)}
      >
        <Wave flip />
        <div
          aria-hidden="true"
          className="drift absolute top-1/2 left-1/4 size-96 rounded-full bg-hue-teal/50 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl space-y-6 text-center text-on-brand">
          <h2
            id="cta-h"
            className="font-display text-4xl leading-[1.1] font-extrabold tracking-tight text-balance sm:text-6xl"
          >
            See it with your own conversations
          </h2>
          <p className="mx-auto max-w-xl text-lg text-on-brand/90">
            Paste a customer conversation and get cited requests in minutes. No
            setup first.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className={sunOnBrand}>
              <Link href="/signup">Start free</Link>
            </Button>
            <Button asChild size="lg" className={ghostOnBrand}>
              <Link href="/docs/getting-started">
                Read the quick start <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
      <StickyCta />
    </>
  );
}
