import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Minus,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { FAQS } from "@/lib/site-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollBox } from "@/components/site/blocks";
import {
  Band,
  GRADIENT,
  IconTile,
  LiftCard,
  SectionHead,
  TextLink,
} from "@/components/site/landing";
import {
  CtaCard,
  PageHero,
  ghostButton,
  sunButton,
} from "@/components/site/page-kit";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start free with your own conversations. Move up when you need recordings, surveys, public pages and integrations.",
};

// What each plan includes, as set in the service's plan settings. Prices are decided by the owner and published
// before launch; none is invented here, and the AI allowance is described by size, not by an amount.
type Cell = boolean | string | { level: 1 | 2 | 3; label: string };
type Row = { what: string; free: Cell; team: Cell; business: Cell };
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "The whole loop",
    rows: [
      {
        what: "Paste, review and requests",
        free: true,
        team: true,
        business: true,
      },
      {
        what: "People, accounts and value",
        free: true,
        team: true,
        business: true,
      },
      {
        what: "Questions and briefs with citations",
        free: true,
        team: true,
        business: true,
      },
      {
        what: "Closing the loop (approved messages)",
        free: true,
        team: true,
        business: true,
      },
    ],
  },
  {
    title: "Research and publishing",
    rows: [
      {
        what: "Recordings and transcripts",
        free: false,
        team: true,
        business: true,
      },
      { what: "Surveys", free: false, team: true, business: true },
      {
        what: "Public pages (release notes, roadmap)",
        free: false,
        team: true,
        business: true,
      },
      { what: "Weekly digest", free: false, team: true, business: true },
    ],
  },
  {
    title: "Connect",
    rows: [
      {
        what: "Integrations (trackers, CRMs, chat)",
        free: false,
        team: true,
        business: true,
      },
      { what: "API keys", free: "None", team: "Up to 3", business: "Up to 10" },
    ],
  },
  {
    title: "Usage",
    rows: [
      {
        what: "AI allowance per day, per workspace",
        free: { level: 1, label: "Small" },
        team: { level: 2, label: "Larger" },
        business: { level: 3, label: "Largest" },
      },
    ],
  },
];

const PLANS = [
  {
    name: "Free",
    tagline: "Try it on your own conversations",
    choose:
      "Choose Free to see what it finds in the conversations you already have.",
    items: [
      "Paste, review and requests",
      "People, accounts and value",
      "Cited questions and briefs",
      "Approved messages to customers",
    ],
    cta: "Start free",
  },
  {
    name: "Team",
    tagline: "For product and research teams",
    featured: true,
    choose:
      "Choose Team when you want recordings, surveys, public pages and integrations.",
    items: [
      "Everything in Free",
      "Recordings and transcripts",
      "Surveys and a public roadmap",
      "Integrations, weekly digest, up to 3 API keys",
    ],
    cta: "Start free, upgrade later",
  },
  {
    name: "Business",
    tagline: "For larger teams and heavier use",
    choose:
      "Choose Business when more teammates use the API or you need the biggest AI allowance.",
    items: [
      "Everything in Team",
      "The largest daily AI allowance",
      "Up to 10 API keys",
    ],
    cta: "Start free, upgrade later",
  },
];

const ASSURANCES = [
  {
    icon: ShieldCheck,
    hue: "teal",
    title: "No surprise bills",
    body: "The AI allowance is per workspace per day, so one busy import cannot run up an unexpected bill.",
  },
  {
    icon: SlidersHorizontal,
    hue: "blue",
    title: "Limits that explain themselves",
    body: "Limits are enforced by the service, and when you reach one the screen says what is missing and how to get it.",
  },
  {
    icon: Download,
    hue: "amber",
    title: "Your data stays yours",
    body: "Export a whole workspace whenever you like, and change plan or payment details in Settings.",
  },
] as const;

const FAQ_QS = [
  "What does it cost?",
  "Do I have to set things up before it is useful?",
  "Will it send messages to my customers by itself?",
  "Can I get my data out?",
];

function CellView({ v, featured }: { v: Cell; featured?: boolean }) {
  if (v === true)
    return (
      <>
        <Check aria-hidden="true" className="mx-auto size-5 text-hue-teal" />
        <span className="sr-only">Included</span>
      </>
    );
  if (v === false)
    return (
      <>
        <Minus aria-hidden="true" className="mx-auto size-5 text-input" />
        <span className="sr-only">Not included</span>
      </>
    );
  if (typeof v === "string")
    return (
      <span className={cn("font-medium", featured && "text-link")}>{v}</span>
    );
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              "h-2.5 w-5 rounded-full",
              n <= v.level ? "bg-seq-4" : "bg-border",
            )}
          />
        ))}
      </span>
      <span className="text-xs font-medium">{v.label}</span>
    </span>
  );
}

export default function Pricing() {
  const faqs = FAQ_QS.map((q) => FAQS.find((f) => f.q === q)).filter(
    (f): f is (typeof FAQS)[number] => !!f,
  );
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Start free. Move up when you need more."
        lead="Paste your own conversations on the free plan first. Move up when you want recordings, surveys, public pages and integrations."
        actions={
          <>
            <Button asChild size="lg" className={sunButton}>
              <Link href="/signup">Start free</Link>
            </Button>
            <Button asChild size="lg" className={ghostButton}>
              <a href="#compare">
                Compare plans <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </>
        }
        ticks={[
          "Free to start",
          "Change plan any time in Settings",
          "You approve everything that is sent",
        ]}
      />

      <Band id="plans">
        <p
          role="note"
          className="reveal mx-auto mb-10 max-w-3xl rounded-2xl bg-tint-amber px-5 py-4 text-center text-sm"
        >
          <strong className="font-display">
            Prices are announced before launch.
          </strong>{" "}
          This page shows what each plan includes today. Nothing here is a
          quote.
        </p>
        <h2 id="plans-h" className="sr-only">
          Plans
        </h2>
        <ul className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
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
              <div className="space-y-1">
                {p.featured ? (
                  <p className="mb-2 w-fit rounded-full bg-sun px-3 py-0.5 text-xs font-bold text-ink">
                    Most teams start here
                  </p>
                ) : null}
                <h3 className="font-display text-2xl font-bold">{p.name}</h3>
                <p
                  className={cn(
                    "text-sm",
                    p.featured ? "text-on-brand/85" : "text-muted-foreground",
                  )}
                >
                  {p.tagline}
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
              <p
                className={cn(
                  "text-sm",
                  p.featured ? "text-on-brand/85" : "text-muted-foreground",
                )}
              >
                {p.choose}
              </p>
              <Button
                asChild
                size="lg"
                variant={p.featured ? "default" : "outline"}
                className={cn(
                  "h-12 rounded-xl text-base font-bold",
                  p.featured && "bg-sun text-ink shadow-raised hover:bg-sun/90",
                  !p.featured && "border-input shadow-none",
                )}
              >
                <Link href="/signup">{p.cta}</Link>
              </Button>
            </li>
          ))}
        </ul>
        <p className="reveal mx-auto mt-14 flex max-w-3xl flex-col items-center justify-between gap-3 rounded-3xl bg-secondary px-6 py-5 text-center sm:flex-row sm:text-left">
          <span>
            <span className="block font-display font-bold">
              Need something custom?
            </span>
            <span className="text-sm text-muted-foreground">
              Larger limits, a security review or a call before you start: tell
              us what you need.
            </span>
          </span>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-11 shrink-0 rounded-xl border-input bg-card"
          >
            <Link href="/contact">Talk to us</Link>
          </Button>
        </p>
      </Band>

      <Band id="compare" tone="muted">
        <SectionHead
          id="compare"
          eyebrow="Compare"
          title="Exactly what each plan includes"
          lead="Every plan has the whole loop. Higher plans add research, publishing, connections and a bigger AI allowance."
        />
        <div className="reveal mx-auto max-w-5xl overflow-hidden rounded-3xl bg-card shadow-card">
          <ScrollBox label="What each plan includes">
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
              <caption className="sr-only">What each plan includes</caption>
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="px-5 py-4 font-display text-base font-semibold"
                  >
                    Included
                  </th>
                  {["Free", "Team", "Business"].map((n) => (
                    <th
                      key={n}
                      scope="col"
                      className={cn(
                        "px-4 py-4 text-center font-display text-base font-bold",
                        n === "Team" && "bg-tint-blue",
                      )}
                    >
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              {GROUPS.map((g) => (
                <tbody key={g.title}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={4}
                      className="bg-muted px-5 py-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase"
                    >
                      {g.title}
                    </th>
                  </tr>
                  {g.rows.map((r) => (
                    <tr
                      key={r.what}
                      className="border-b border-border last:border-b-0"
                    >
                      <th scope="row" className="px-5 py-3.5 font-normal">
                        {r.what}
                      </th>
                      <td className="px-4 py-3.5 text-center">
                        <CellView v={r.free} />
                      </td>
                      <td className="bg-tint-blue/60 px-4 py-3.5 text-center">
                        <CellView v={r.team} featured />
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <CellView v={r.business} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </ScrollBox>
        </div>
        <p className="mt-8 text-center">
          <Button asChild size="lg" className="h-12 rounded-xl px-7 text-base">
            <Link href="/signup">Start free</Link>
          </Button>
        </p>
      </Band>

      <Band id="assurance">
        <SectionHead
          id="assurance"
          eyebrow="How limits work"
          title="Predictable by design"
          lead="You should never have to wonder what a busy day will cost, or what is stopping you."
        />
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {ASSURANCES.map((a, i) => (
            <LiftCard key={a.title} index={i} className="flex flex-col gap-4">
              <IconTile icon={a.icon} hue={a.hue} />
              <h3 className="font-display text-xl font-semibold tracking-tight">
                {a.title}
              </h3>
              <p className="text-muted-foreground">{a.body}</p>
            </LiftCard>
          ))}
        </ul>
      </Band>

      <Band id="faq" tone="muted">
        <SectionHead
          id="faq"
          eyebrow="Before you start"
          title="Questions people ask about cost and risk"
        />
        <div className="mx-auto max-w-3xl space-y-3">
          {faqs.map((f, i) => (
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
          <span className="px-3 text-muted-foreground">·</span>
          <TextLink href="/contact">Ask us something else</TextLink>
        </p>
      </Band>

      <section className="px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <CtaCard
            title="Try the free plan"
            text="Start on Free, paste a conversation and see what it finds. Move up later if you need more."
          />
        </div>
      </section>
    </>
  );
}
