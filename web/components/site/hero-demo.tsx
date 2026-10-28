"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Mail,
  MessageSquare,
  Phone,
  RotateCcw,
} from "lucide-react";
import { Frame } from "@/components/site/landing";
import { cn } from "@/lib/utils";

// A sample conversation that reads itself: lines arrive, the sentences behind each request light up, and a card for
// each request appears and is marked "verified word for word". Everything here is sample text, labelled as such.
// The server renders the finished state, so it reads fine without script; the browser then replays it once.

type Part = { t: string; hl?: number };
type Msg = { who: string; parts: Part[] };
type Scenario = {
  id: string;
  label: string;
  icon: typeof Phone;
  meta: string;
  msgs: Msg[];
  requests: { title: string; tag: string; value: string; account: string }[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "call",
    label: "Call",
    icon: Phone,
    meta: "Call with Priya · Northwind Logistics",
    msgs: [
      {
        who: "Priya",
        parts: [
          {
            t: "Thanks for making time. Overall we like it, a few things come up every week.",
          },
        ],
      },
      {
        who: "Priya",
        parts: [
          { t: "We rebuild this report in a spreadsheet every Monday. " },
          { t: "If I could just export it, that is two hours back.", hl: 0 },
        ],
      },
      { who: "You", parts: [{ t: "Anything else slowing the team down?" }] },
      {
        who: "Priya",
        parts: [
          { t: "Our security team keeps asking " },
          { t: "whether you support single sign-on", hl: 1 },
          { t: "." },
        ],
      },
      {
        who: "Priya",
        parts: [
          { t: "Alerts in Slack would stop us missing escalations.", hl: 2 },
        ],
      },
    ],
    requests: [
      {
        title: "Export any table to CSV",
        tag: "Reporting",
        value: "$40k",
        account: "Northwind",
      },
      {
        title: "Single sign-on (SAML)",
        tag: "Security",
        value: "$24k",
        account: "Northwind",
      },
      {
        title: "Slack alerts for escalations",
        tag: "Integrations",
        value: "$12k",
        account: "Northwind",
      },
    ],
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    meta: "Email from Marcus · Brightside Health",
    msgs: [
      {
        who: "Marcus",
        parts: [
          { t: "Hi team, quick note after the rollout. It has gone well." },
        ],
      },
      {
        who: "Marcus",
        parts: [
          {
            t: "Our finance team asked again whether the usage table can be downloaded.",
            hl: 0,
          },
        ],
      },
      {
        who: "Marcus",
        parts: [
          { t: "Separately, " },
          { t: "the dashboard is slow to load on Monday mornings", hl: 1 },
          { t: "." },
        ],
      },
      {
        who: "Marcus",
        parts: [{ t: "Could admins get a weekly summary email?", hl: 2 }],
      },
    ],
    requests: [
      {
        title: "Download the usage table",
        tag: "Reporting",
        value: "$28k",
        account: "Brightside",
      },
      {
        title: "Faster dashboard load",
        tag: "Performance",
        value: "$21k",
        account: "Brightside",
      },
      {
        title: "Weekly summary email for admins",
        tag: "Notifications",
        value: "$9k",
        account: "Brightside",
      },
    ],
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    meta: "Website chat · Elena · Tallow & Finch",
    msgs: [
      { who: "Elena", parts: [{ t: "hey, quick one" }] },
      {
        who: "Elena",
        parts: [
          {
            t: "is there any way to get this out as a file? support said maybe later",
            hl: 0,
          },
        ],
      },
      {
        who: "Elena",
        parts: [{ t: "also " }, { t: "where do I invite a teammate?", hl: 1 }],
      },
      {
        who: "Elena",
        parts: [
          { t: "and we need invoices with our VAT number on them", hl: 2 },
        ],
      },
    ],
    requests: [
      {
        title: "Export any table to CSV",
        tag: "Reporting",
        value: "$16k",
        account: "Tallow & Finch",
      },
      {
        title: "Clearer way to invite teammates",
        tag: "Onboarding",
        value: "$16k",
        account: "Tallow & Finch",
      },
      {
        title: "VAT number on invoices",
        tag: "Billing",
        value: "$16k",
        account: "Tallow & Finch",
      },
    ],
  },
];

const TICK_MS = 850;

export function HeroDemo() {
  const [idx, setIdx] = useState(0);
  const sc = SCENARIOS[idx];
  const M = sc.msgs.length;
  const R = sc.requests.length;
  const last = M + R + 2;
  const [t, setT] = useState(last); // finished until the browser replays it
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reduced = useRef(false);

  // The timer stops itself once every line and card has appeared, so nothing outside needs to watch it.
  const play = useCallback((i: number) => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (reduced.current) {
      setT(99);
      return;
    }
    const s = SCENARIOS[i];
    const limit = s.msgs.length + s.requests.length + 2;
    let n = 0;
    setT(0);
    timer.current = setInterval(() => {
      n += 1;
      setT(n);
      if (n >= limit && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, TICK_MS);
  }, []);

  useLayoutEffect(() => {
    reduced.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    play(0);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [play]);

  function pick(i: number) {
    setIdx(i);
    play(i);
  }

  const msgsShown = Math.min(t, M);
  const hlShown = t > M ? Math.min(t - M, R) : 0;
  const done = t >= last;
  const status = done
    ? `${R} requests found · ${R} quotes verified word for word · nothing is saved until you accept`
    : t < M
      ? "Reading the conversation…"
      : "Finding requests and checking each quote…";

  return (
    <Frame title="Paste a conversation → cited requests">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div
          role="tablist"
          aria-label="Sample conversations"
          className="flex gap-1"
        >
          {SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`demo-tab-${s.id}`}
              aria-selected={i === idx}
              aria-controls="demo-panel"
              onClick={() => pick(i)}
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
                i === idx
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              <s.icon aria-hidden="true" className="size-4" />
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => play(idx)}
          className="flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Replay
        </button>
      </div>

      <div
        id="demo-panel"
        role="tabpanel"
        aria-labelledby={`demo-tab-${sc.id}`}
        className="grid text-left md:grid-cols-[1.15fr_1fr]"
      >
        <div className="space-y-3 p-5 sm:p-6">
          <p className="text-xs font-medium text-muted-foreground">
            {sc.meta} · sample
          </p>
          <ul className="space-y-2.5 text-sm leading-relaxed">
            {sc.msgs.map((m, i) => (
              <li
                key={i}
                className={cn(
                  "flex gap-2.5 transition-all duration-500",
                  i < msgsShown
                    ? "visible translate-y-0"
                    : "invisible translate-y-2",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    m.who === "You"
                      ? "bg-secondary text-link"
                      : "bg-tint-amber text-foreground",
                  )}
                >
                  {m.who[0]}
                </span>
                <p>
                  <span className="sr-only">{m.who}: </span>
                  {m.parts.map((p, j) =>
                    p.hl === undefined ? (
                      <span key={j}>{p.t}</span>
                    ) : (
                      <span
                        key={j}
                        className={cn(
                          "rounded-sm px-0.5 transition-colors duration-500",
                          hlShown > p.hl
                            ? "bg-mark text-ink"
                            : "bg-transparent",
                        )}
                      >
                        {p.t}
                        <sup
                          aria-hidden="true"
                          className={cn(
                            "ml-0.5 inline-flex size-4 items-center justify-center rounded-full bg-primary align-top text-[10px] font-bold text-primary-foreground transition-opacity duration-500",
                            hlShown > p.hl ? "visible" : "invisible",
                          )}
                        >
                          {p.hl + 1}
                        </sup>
                      </span>
                    ),
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 border-t border-border bg-tint-blue p-5 sm:p-6 md:border-t-0 md:border-l">
          <p className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Requests found</span>
            <span className="rounded-full bg-card px-2 py-0.5 tabular-nums">
              {hlShown} of {R}
            </span>
          </p>
          <ul className="space-y-2.5">
            {sc.requests.map((r, i) => {
              const shown = hlShown > i;
              const verified = t > M + i + 1 || done;
              return (
                <li
                  key={r.title}
                  className={cn(
                    "rounded-2xl bg-card p-3.5 shadow-card transition-all duration-500",
                    shown ? "visible translate-y-0" : "invisible translate-y-3",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-sm font-semibold">
                        {r.title}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="rounded-full bg-secondary px-2 py-0.5">
                          {r.tag}
                        </span>
                        <span>
                          {r.account} · {r.value}/yr
                        </span>
                      </p>
                    </div>
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full bg-tint-teal px-2 py-0.5 text-[11px] font-medium transition-opacity duration-500",
                        verified ? "visible" : "invisible",
                      )}
                    >
                      <Check
                        aria-hidden="true"
                        className="size-3 text-hue-teal"
                      />
                      Verbatim
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-3 border-t border-border bg-muted px-5 py-3.5 sm:flex-row sm:items-center">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {status}
        </p>
        <Link
          href="/signup"
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-glow transition-[translate] hover:-translate-y-0.5"
        >
          Try it on your own conversation{" "}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </Frame>
  );
}
