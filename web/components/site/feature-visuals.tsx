import type { ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Lock,
  Mail,
  MessageSquare,
  MessagesSquare,
  Mic,
  Phone,
  Send,
  Sparkles,
  Ticket,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Pictures of the product for the Features page. Each one is a small copy of a real screen, drawn in the same colours
// and shapes as the app (gradient header, status pills, tables, the inbox), so what a visitor sees here is what they
// get. They are decoration: the words next to them say the same things, so they are hidden from screen readers. Text
// is allowed to wrap; nothing is cut off with an ellipsis.

/** The frame every picture sits in: a window with a title bar, like the app in a browser. */
function Window({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-raised",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2.5">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-input/40" />
          ))}
        </span>
        <span className="ml-2 text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

/** The brand gradient strip a product screen starts with. */
function Strip({ title, note }: { title: string; note?: string }) {
  return (
    <div className="bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 px-4 py-3 text-on-brand">
      <p className="font-display text-base font-bold">{title}</p>
      {note ? <p className="text-xs text-on-brand">{note}</p> : null}
    </div>
  );
}

type Tone = "blue" | "teal" | "amber" | "muted" | "coral";
const TONE: Record<Tone, { pill: string; dot: string }> = {
  blue: { pill: "bg-tint-blue", dot: "bg-hue-blue" },
  teal: { pill: "bg-tint-teal", dot: "bg-hue-teal" },
  amber: { pill: "bg-tint-amber", dot: "bg-hue-amber" },
  coral: { pill: "bg-tint-coral", dot: "bg-hue-coral" },
  muted: { pill: "bg-muted", dot: "bg-input" },
};

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground",
        TONE[tone].pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", TONE[tone].dot)} />
      {children}
    </span>
  );
}

function Mark({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-mark px-0.5 text-[#171717]">{children}</mark>
  );
}

const button =
  "inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap";

// ---------------------------------------------------------------------------------------------------------------

const SOURCES: { icon: typeof Phone; name: string; text: string }[] = [
  { icon: Phone, name: "Call", text: "“We copy it out by hand every Monday.”" },
  {
    icon: Mail,
    name: "Email",
    text: "“Can we sign in with our company account?”",
  },
  {
    icon: MessageSquare,
    name: "Chat",
    text: "“Is there still no way to export?”",
  },
  { icon: Ticket, name: "Ticket", text: "“Please add export to CSV.”" },
  {
    icon: ClipboardList,
    name: "Survey",
    text: "“We really need a mobile app.”",
  },
  { icon: MessagesSquare, name: "Slack", text: "“Any plans for a dark mode?”" },
];

const QUEUE: [string, string][] = [
  ["Export to CSV", "95%"],
  ["Sign in with a company account", "91%"],
  ["Export to CSV (more evidence)", "88%"],
  ["Mobile app", "84%"],
  ["Dark mode", "78%"],
  ["Usage dashboard", "71%"],
];

/** Many sources in, one queue out. */
export function IntakeVisual() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 items-stretch gap-3 text-sm sm:grid-cols-[1fr_auto_1fr]"
    >
      <ul className="space-y-2">
        {SOURCES.map((s) => (
          <li
            key={s.name}
            className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-card"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-tint-blue text-link">
              <s.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{s.name}</span>
              <span className="block text-xs text-muted-foreground">
                {s.text}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden items-center sm:flex">
        <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-2 to-brand-3 text-on-brand shadow-card">
          <ArrowRight className="size-4" />
        </span>
      </div>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-raised">
        <Strip title="Review queue" note="6 sources waiting to be read" />
        <ul className="flex flex-1 flex-col divide-y divide-border">
          {QUEUE.map(([title, c]) => (
            <li
              key={title}
              className="flex flex-1 items-center gap-2 px-4 py-3"
            >
              <span className="size-2 shrink-0 rounded-full bg-hue-blue" />
              <span className="flex-1 text-xs font-medium">{title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {c}
              </span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 border-t border-border bg-muted px-4 py-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          Each source is kept exactly as written, with card numbers hidden.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** A suggestion with its proof, and the buttons that turn it into a request. */
export function ReviewVisual() {
  return (
    <Window label="Review · To review">
      <div className="space-y-3 bg-muted p-4">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-semibold">Export any table to CSV</p>
            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium">
              Request
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                <span className="block h-full w-[94%] rounded-full bg-seq-4" />
              </span>
              94% confident
            </span>
          </div>
          <p className="border-l-2 border-primary/40 pl-3 text-[0.8125rem] leading-6 text-muted-foreground">
            Call with Harbor, 12:41. Priya: …so that part is fine. Honestly the
            thing that slows us down is{" "}
            <Mark>having no way to export the table</Mark>, we copy it by hand
            every Monday…
          </p>
          <p className="flex items-start gap-2 rounded-lg bg-tint-teal px-3 py-1.5 text-xs">
            <Check className="mt-0.5 size-3.5 shrink-0 text-hue-teal" />
            <span>
              Found word for word at characters{" "}
              <span className="font-mono whitespace-nowrap">
                1,204 to 1,241
              </span>
            </span>
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-40">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                Request title
              </p>
              <p className="rounded-lg border border-input/60 px-2.5 py-1.5 text-xs">
                Export any table to CSV
              </p>
            </div>
            <div className="basis-32">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                Add it to
              </p>
              <p className="flex items-center justify-between rounded-lg border border-input/60 px-2.5 py-1.5 text-xs">
                A new request <ChevronDown className="size-3.5" />
              </p>
            </div>
            <span className={cn(button, "bg-primary text-primary-foreground")}>
              Accept as a request
            </span>
            <span className="px-1.5 py-1.5 text-xs font-medium text-muted-foreground">
              Dismiss
            </span>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">Download usage as a file</p>
            <span className="text-xs text-muted-foreground">78% confident</span>
          </div>
          <p className="rounded-lg bg-tint-amber px-3 py-2 text-xs">
            <strong>This may be the same as:</strong> Export any table to CSV.
            Both ask to take a table out as a file.
          </p>
          <span className={cn(button, "border border-border bg-card")}>
            Add it to that request
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">Reviewed this week</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-card">
            <span className="block h-full w-[71%] rounded-full bg-primary" />
          </span>
          <span className="tabular-nums">37 of 52</span>
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const ROWS: {
  title: string;
  meta: string;
  tone: Tone;
  status: string;
  value: string;
  bar: number;
}[] = [
  {
    title: "Export to CSV",
    meta: "3 people · 2 accounts · 5 quotes",
    tone: "amber",
    status: "Planned",
    value: "$84k",
    bar: 100,
  },
  {
    title: "Single sign-on (SAML)",
    meta: "2 people · 1 account · 3 quotes",
    tone: "amber",
    status: "In progress",
    value: "$61k",
    bar: 73,
  },
  {
    title: "Slack alerts",
    meta: "1 person · 1 account · 1 quote",
    tone: "blue",
    status: "New",
    value: "$27k",
    bar: 32,
  },
  {
    title: "Dark mode",
    meta: "1 person · 1 account · 1 quote",
    tone: "muted",
    status: "Won't do",
    value: "$9k",
    bar: 11,
  },
];

/** The requests table: ranked by value, status editable in place. */
export function RequestsVisual() {
  return (
    <Window label="Requests · Most revenue first">
      <div className="space-y-3 bg-muted p-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {["Any status", "Any tag", "Most revenue first"].map((t) => (
            <span
              key={t}
              className="flex items-center gap-1.5 rounded-full border border-input/60 bg-card px-3 py-1.5"
            >
              {t} <ChevronDown className="size-3" />
            </span>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border bg-muted px-4 py-2 text-[11px] font-medium text-muted-foreground sm:grid-cols-[1fr_auto_3rem]">
            <span>Request</span>
            <span>Status</span>
            <span className="hidden text-right sm:block">Revenue</span>
          </div>
          <ul className="divide-y divide-border">
            {ROWS.map((r, i) => (
              <li
                key={r.title}
                className="relative grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1fr_auto_3rem]"
              >
                <span className="row-span-2 min-w-0 sm:row-span-1">
                  <span className="block text-[0.8125rem] font-medium">
                    {r.title}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {r.meta}
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-seq-3"
                      style={{ width: `${r.bar}%` }}
                    />
                  </span>
                </span>
                <span className="flex items-center gap-0.5">
                  <Pill tone={r.tone}>{r.status}</Pill>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </span>
                <span className="col-start-2 text-right text-[0.8125rem] font-semibold tabular-nums sm:col-start-auto">
                  {r.value}
                </span>
                {i === 1 ? (
                  <ul className="absolute top-[3.1rem] right-14 z-10 hidden w-36 sm:block space-y-px rounded-xl border border-border bg-card p-1 text-xs shadow-raised">
                    {["New", "Planned", "In progress", "Shipped"].map((s) => (
                      <li
                        key={s}
                        className={cn(
                          "flex items-center justify-between rounded-lg px-2.5 py-1.5",
                          s === "In progress" && "bg-accent font-medium",
                        )}
                      >
                        {s}
                        {s === "In progress" ? (
                          <Check className="size-3 text-primary" />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Value is summed over distinct accounts: two people from one account
          count that account once.
        </p>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** A question with an answer that cites, and one that refuses. */
export function AskVisual() {
  return (
    <Window label="Ask">
      <div className="space-y-3 bg-muted p-4">
        <div className="flex items-center gap-2 rounded-xl border border-input/60 bg-card p-2 pl-3.5">
          <span className="flex-1 text-[0.8125rem]">
            Why are trials not converting?
          </span>
          <span className={cn(button, "bg-primary text-primary-foreground")}>
            Ask
          </span>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="flex items-start gap-2 font-semibold">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-hue-sky" />
            Why are trials not converting?
          </p>
          <p className="text-[0.8125rem] leading-6">
            Five accounts say setup takes too long, and two say they could not
            connect their identity provider.
            <sup className="mx-0.5 font-semibold text-link">1</sup>
            <sup className="mx-0.5 font-semibold text-link">2</sup>
            <sup className="mx-0.5 font-semibold text-link">3</sup>
          </p>
          <ol className="space-y-1.5 text-xs">
            {[
              "“It took our admin two days just to get everyone in.”",
              "“We gave up on the trial before we finished setting up.”",
              "“I couldn’t work out how to connect our login.”",
            ].map((q, i) => (
              <li
                key={q}
                className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground"
              >
                <span className="font-semibold text-link">{i + 1}.</span>
                <span>
                  {q}{" "}
                  <span className="text-link underline">
                    See it in the conversation
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Was this right?
            <span className="rounded-full border border-border px-2.5 py-0.5 font-medium text-foreground">
              Yes
            </span>
            <span className="rounded-full border border-border px-2.5 py-0.5 font-medium text-foreground">
              No, it’s wrong
            </span>
          </p>
        </div>

        <div className="space-y-1 rounded-xl border-2 border-dashed border-input/50 bg-card p-4">
          <p className="flex items-start gap-2 font-semibold">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-hue-sky" />
            Do customers want a dark mode?
          </p>
          <p className="text-[0.8125rem] font-medium">
            Not enough evidence to answer that.
          </p>
          <p className="text-xs text-muted-foreground">
            No stored quote mentions it, so there is nothing to cite.
          </p>
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const STEPS: { label: string; done: boolean }[] = [
  { label: "Marked shipped", done: true },
  { label: "3 drafts written", done: true },
  { label: "You approve", done: false },
  { label: "Sent", done: false },
];

/** Shipping starts personal drafts; a person approves; only then does anything leave. */
export function LoopVisual() {
  return (
    <Window label="Messages · Export to CSV">
      <div className="space-y-3 bg-muted p-4">
        <ol className="grid grid-cols-4 gap-1">
          {STEPS.map((s, i) => (
            <li key={s.label} className="flex flex-col items-center gap-1.5">
              <span className="flex w-full items-center">
                <span
                  className={cn(
                    "h-0.5 flex-1",
                    i === 0
                      ? "bg-transparent"
                      : s.done
                        ? "bg-hue-teal"
                        : "bg-input/40",
                  )}
                />
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-on-brand",
                    s.done
                      ? "border-hue-teal bg-hue-teal"
                      : "border-input/60 bg-card text-muted-foreground",
                  )}
                >
                  {s.done ? <Check className="size-3.5" /> : null}
                </span>
                <span
                  className={cn(
                    "h-0.5 flex-1",
                    i === STEPS.length - 1
                      ? "bg-transparent"
                      : STEPS[i + 1].done
                        ? "bg-hue-teal"
                        : "bg-input/40",
                  )}
                />
              </span>
              <span className="text-center text-[11px] leading-tight font-medium">
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-link">
                P
              </span>
              <span>
                <span className="block text-[0.8125rem] font-semibold">
                  Priya Raman
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  priya@brightlane.example
                </span>
              </span>
            </span>
            <Pill tone="muted">Draft</Pill>
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              Based on what she said:
            </span>{" "}
            “We copy it out by hand every Monday.”
          </p>
          <div className="space-y-1 rounded-lg border border-input/50 p-3 text-[0.8125rem] leading-6">
            <p className="font-semibold">Export to CSV is live</p>
            <p>
              Hi Priya, you told us the Monday report took two hours. Export to
              CSV is live today: open Requests, choose Export. Thank you for
              telling us.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(button, "bg-primary text-primary-foreground")}>
              Approve and send 3 messages
            </span>
            <span className={cn(button, "border border-border")}>Edit</span>
            <span className="text-xs text-muted-foreground">
              Nothing is sent until you approve it.
            </span>
          </div>
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const WAVE = [
  4, 9, 14, 8, 20, 26, 18, 30, 22, 12, 7, 16, 28, 34, 24, 14, 9, 18, 30, 36, 26,
  16, 10, 6, 14, 22, 30, 24, 16, 8, 12, 20, 28, 18, 10, 6,
];

/** A recording, its transcript with a highlight, and the tagged highlights collected from it. */
export function ResearchVisual() {
  const hot = new Set([13, 14, 18, 19, 20, 26, 27, 32]);
  return (
    <Window label="Recording · Call with Harbor">
      <div className="space-y-3 bg-muted p-4">
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Mic className="size-4" />
            </span>
            <div className="flex h-10 min-w-0 flex-1 items-center gap-[3px] overflow-hidden">
              {WAVE.map((h, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-[3px] shrink-0 rounded-full",
                    hot.has(i) ? "bg-hue-amber" : "bg-seq-1",
                  )}
                  style={{ height: `${h + 6}px` }}
                />
              ))}
            </div>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              12:41
            </span>
          </div>
          <p className="text-[0.8125rem] leading-6">
            <span className="mr-2 font-mono text-[11px] text-muted-foreground">
              12:41 Priya
            </span>
            “We rebuild this every Monday.{" "}
            <Mark>If I could just export it</Mark>, I would stop.”
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            {
              tag: "Pain point",
              tone: "coral" as Tone,
              text: "“We rebuild this every Monday.”",
              who: "Priya · 12:41",
            },
            {
              tag: "Request",
              tone: "blue" as Tone,
              text: "“If I could just export it, I would stop.”",
              who: "Priya · 12:55",
            },
          ].map((h) => (
            <div
              key={h.tag}
              className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-card"
            >
              <Pill tone={h.tone}>{h.tag}</Pill>
              <p className="text-xs leading-5">{h.text}</p>
              <p className="text-[11px] text-muted-foreground">{h.who}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              Finding: reports are rebuilt by hand
            </p>
            <Pill tone="teal">Shared by link</Pill>
          </div>
          <p className="border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">
            “We rebuild this every Monday.” Always shown exactly as said, with
            who said it and where.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Anyone with the link can read it. You can revoke the link at any
            time.
          </p>
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** Survey results: the score, and who said what. */
export function SurveyVisual() {
  return (
    <Window label="Survey results · How is onboarding going?">
      <div className="space-y-3 bg-muted p-4">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs font-medium text-muted-foreground">
            How likely are you to recommend us to a colleague?
          </p>
          <p className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-bold tracking-tight">
              +48
            </span>
            <span className="text-xs text-muted-foreground">
              NPS, 187 answers
            </span>
          </p>
          <div className="flex h-8 overflow-hidden rounded-full text-xs font-semibold">
            <span className="flex w-[12%] items-center justify-center bg-hue-coral text-on-brand">
              12%
            </span>
            <span className="flex w-[28%] items-center justify-center bg-input/50 text-foreground">
              28%
            </span>
            <span className="flex flex-1 items-center justify-center bg-brand-3 text-on-brand">
              60%
            </span>
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {[
              ["Detractors", "bg-hue-coral"],
              ["Passives", "bg-input/50"],
              ["Promoters", "bg-brand-3"],
            ].map(([label, dot]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", dot)} />
                {label}
              </span>
            ))}
          </p>
        </div>

        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs font-medium text-muted-foreground">
            What best describes how you use it?
          </p>
          {[
            ["Deciding what to build", 46],
            ["Preparing for customer calls", 31],
            ["Reporting to leadership", 23],
          ].map(([label, v]) => (
            <div key={label} className="space-y-1">
              <p className="flex justify-between text-xs">
                <span>{label}</span>
                <span className="font-semibold tabular-nums">{v}%</span>
              </p>
              <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-seq-3"
                  style={{ width: `${v}%` }}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-tint-teal px-3 py-2 text-xs">
          <Check className="mt-0.5 size-3.5 shrink-0 text-hue-teal" />
          24 free-text answers went to the review queue.
        </p>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** The shared inbox: the list, a thread with a private note, and sending a message on as feedback. */
export function DeskVisual() {
  return (
    <Window label="Inbox · Open">
      <div className="grid grid-cols-1 sm:grid-cols-[10.5rem_1fr]">
        <ul className="divide-y divide-border border-b border-border bg-muted sm:border-r sm:border-b-0">
          {[
            ["Lena Fischer", "Can we export to CSV?", false, true],
            ["Sam Ortega", "Dark mode?", true, false],
            ["Priya Raman", "Invoice question", true, false],
          ].map(([name, subject, open, sel]) => (
            <li
              key={String(name)}
              className={cn("space-y-0.5 px-3 py-2.5", sel && "bg-card")}
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                {open ? (
                  <span className="size-1.5 rounded-full bg-hue-amber" />
                ) : null}
                {name}
              </p>
              <p className="text-[11px] text-muted-foreground">{subject}</p>
            </li>
          ))}
        </ul>
        <div className="space-y-2.5 p-4">
          <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2 text-[0.8125rem] shadow-card">
            Can I get this out as a file?
          </p>
          <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[0.8125rem] text-primary-foreground">
            Not yet, but you are the third person to ask. I have passed it on.
          </p>
          <p className="flex items-start gap-2 rounded-xl border border-dashed border-hue-amber bg-tint-amber px-3 py-2 text-xs">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            Private note: third time this week.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(button, "border border-border bg-card")}>
              <Send className="mr-1.5 size-3.5" />
              Send to the review queue as feedback
            </span>
          </div>
          <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Saved replies
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                "Thanks, I have passed it on",
                "It is on the roadmap",
                "Can you tell me more?",
              ].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px]"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
          <p className="flex items-center gap-2 rounded-lg bg-tint-blue px-3 py-2 text-xs">
            First answer in 11 minutes typically · 2 waiting
          </p>
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const ROADMAP: { title: string; tone: Tone; status: string; votes: number }[] =
  [
    {
      title: "Single sign-on",
      tone: "amber",
      status: "In progress",
      votes: 212,
    },
    { title: "Slack alerts", tone: "blue", status: "Planned", votes: 128 },
    { title: "Export to CSV", tone: "teal", status: "Shipped", votes: 305 },
  ];

/** The public roadmap, as a visitor sees it. */
export function PublicVisual() {
  return (
    <Window label="northwind.example · Roadmap">
      <div>
        <div className="bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 px-5 pt-5 pb-8 text-on-brand">
          <span className="inline-flex rounded-full bg-on-brand/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-widest uppercase">
            Roadmap
          </span>
          <p className="mt-2 font-display text-xl font-bold tracking-tight">
            What we’re working on
          </p>
        </div>
        <ul className="-mt-4 space-y-2 px-4 pb-4">
          {ROADMAP.map((r) => (
            <li
              key={r.title}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card"
            >
              <span className="flex w-12 shrink-0 flex-col items-center rounded-xl border border-border py-1.5">
                <ChevronUp className="size-3.5 text-link" />
                <span className="text-xs font-semibold tabular-nums">
                  {r.votes}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-semibold">
                  {r.title}
                </span>
                <span className="mt-1 block">
                  <Pill tone={r.tone}>{r.status}</Pill>
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-border bg-muted px-4 py-2.5 text-[11px] text-muted-foreground">
          Only what you publish is here. Votes from known customers are marked
          verified.
        </p>
      </div>
    </Window>
  );
}
