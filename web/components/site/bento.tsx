import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  BarChart3,
  Check,
  ClipboardList,
  Headphones,
  Lock,
  Mail,
  MessageSquare,
  MessagesSquare,
  Phone,
  Send,
  Sparkles,
  Ticket,
  UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Count } from "@/components/site/visuals";
import type { Hue } from "@/components/site/landing";

const idx = (i: number) => ({ "--i": i }) as CSSProperties;

/* ---------- Chaos to order: scattered feedback settles into one tidy queue as you scroll ---------- */

const SCATTER: { icon: LucideIcon; src: string; quote: string; x: string; y: string; r: string }[] = [
  { icon: Phone, src: "Call", quote: "“two hours back”", x: "-46px", y: "-40px", r: "-9deg" },
  { icon: Mail, src: "Email", quote: "“can we download this?”", x: "34px", y: "-56px", r: "7deg" },
  { icon: MessageSquare, src: "Chat", quote: "“still waiting on SSO”", x: "58px", y: "-28px", r: "-6deg" },
  { icon: Ticket, src: "Ticket", quote: "“export is missing”", x: "-52px", y: "46px", r: "8deg" },
  { icon: ClipboardList, src: "Survey", quote: "“needs Slack alerts”", x: "20px", y: "58px", r: "-11deg" },
  { icon: MessagesSquare, src: "DM", quote: "“any update on this?”", x: "60px", y: "36px", r: "6deg" },
];

export function ScatterToOrder() {
  return (
    <div className="overflow-x-clip rounded-[2rem] bg-muted p-6 sm:p-10">
      <ul
        aria-label="Feedback from six places, gathered into one queue"
        className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
      >
        {SCATTER.map((c) => (
          <li
            key={c.src}
            style={{ "--x": c.x, "--y": c.y, "--r": c.r } as CSSProperties}
            className="scatter flex items-center gap-3 rounded-2xl bg-card p-3.5 shadow-card"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-link"
            >
              <c.icon className="size-4.5" />
            </span>
            <span className="min-w-0 text-sm">
              <span className="block text-xs font-semibold text-muted-foreground">{c.src}</span>
              <span className="block truncate font-medium">{c.quote}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">
        <Check aria-hidden="true" className="size-4" />
        One review queue, every source kept as written
      </p>
    </div>
  );
}

/* ---------- Pipeline: how a sentence travels, and where a person steps in ---------- */

const NODES: { icon: LucideIcon; title: string; sub: string; human?: boolean }[] = [
  { icon: Headphones, title: "Sources", sub: "calls, email, chat" },
  { icon: Sparkles, title: "Extract", sub: "AI proposes" },
  { icon: UserCheck, title: "Review", sub: "you accept", human: true },
  { icon: BarChart3, title: "Requests", sub: "weighed by account" },
  { icon: Send, title: "Close the loop", sub: "you approve, then send", human: true },
];

export function PipelineDiagram() {
  const W = 1040;
  const NW = 160;
  const GAP = 50;
  const x0 = 20;
  const y = 56;
  const H = 104;
  const xs = NODES.map((_, i) => x0 + i * (NW + GAP));
  return (
    <figure className="rounded-[2rem] bg-card p-6 shadow-card sm:p-8">
      <svg
        viewBox={`0 0 ${W} 200`}
        role="img"
        aria-label="Pipeline: sources feed extraction, which proposes requests. You review and accept them. They are weighed by account. When one ships, you approve a message to each person who asked."
        className="hidden h-auto w-full font-sans md:block"
      >
        {xs.slice(0, -1).map((x, i) => {
          const a = x + NW;
          const b = xs[i + 1];
          const my = y + H / 2;
          return (
            <g key={i}>
              <path d={`M${a} ${my} L${b} ${my}`} className="stroke-input" strokeWidth="2" strokeDasharray="4 6" fill="none" />
              <g className="flow-dots">
                {[0, 1].map((d) => (
                  <circle key={d} r="4.5" className="fill-sun" stroke="var(--ink)" strokeWidth="1.5">
                    <animateMotion
                      dur="2.6s"
                      begin={`${i * 0.5 + d * 1.3}s`}
                      repeatCount="indefinite"
                      path={`M${a} ${my} L${b} ${my}`}
                    />
                  </circle>
                ))}
              </g>
            </g>
          );
        })}
        {NODES.map((n, i) => (
          <g key={n.title}>
            <rect
              x={xs[i]}
              y={y}
              width={NW}
              height={H}
              rx="22"
              className={cn("fill-card", n.human ? "stroke-primary" : "stroke-border")}
              strokeWidth={n.human ? 2.5 : 1.5}
            />
            <n.icon x={xs[i] + 16} y={y + 18} width={26} height={26} className="text-link" strokeWidth={2} />
            <text x={xs[i] + 16} y={y + 72} className="fill-foreground font-display text-[16px] font-bold">
              {n.title}
            </text>
            <text x={xs[i] + 16} y={y + 91} className="fill-muted-foreground text-[12px]">
              {n.sub}
            </text>
            {n.human ? (
              <g>
                <rect x={xs[i] + NW - 52} y={y - 12} width="44" height="24" rx="12" className="fill-primary" />
                <text
                  x={xs[i] + NW - 30}
                  y={y + 4}
                  textAnchor="middle"
                  className="fill-primary-foreground text-[12px] font-bold"
                >
                  You
                </text>
              </g>
            ) : null}
          </g>
        ))}
      </svg>
      <ol className="space-y-2 md:hidden">
        {NODES.map((n, i) => (
          <li key={n.title} className="flex items-center gap-3 rounded-2xl bg-muted p-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-card text-link shadow-card">
              <n.icon aria-hidden="true" className="size-4.5" />
            </span>
            <span className="text-sm">
              <span className="font-display font-semibold">{n.title}</span>
              <span className="text-muted-foreground"> · {n.sub}</span>
            </span>
            <span className="ml-auto text-xs font-semibold text-link">{n.human ? "You decide" : `Step ${i + 1}`}</span>
          </li>
        ))}
      </ol>
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-primary" /> A person decides here
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-sun ring-1 ring-ink" /> A sentence on its way
        </span>
      </figcaption>
    </figure>
  );
}

/* ---------- Bento ---------- */

export function BentoCell({
  fig,
  title,
  body,
  className,
  tint,
  index = 0,
  children,
}: {
  fig: string;
  title: string;
  body: string;
  className?: string;
  tint?: Hue;
  index?: number;
  children: ReactNode;
}) {
  const wells: Record<Hue, string> = {
    blue: "bg-tint-blue",
    teal: "bg-tint-teal",
    amber: "bg-tint-amber",
    coral: "bg-tint-coral",
    sky: "bg-tint-sky",
  };
  return (
    <article
      style={idx(index)}
      className={cn(
        "reveal group flex flex-col gap-4 rounded-3xl bg-card p-6 shadow-card transition-[translate,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-raised",
        className,
      )}
    >
      <div className={cn("flex-1 rounded-2xl p-4", wells[tint ?? "blue"])}>{children}</div>
      <div className="space-y-1.5">
        <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">{fig}</p>
        <h3 className="font-display text-xl font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </article>
  );
}

const BARS = Array.from({ length: 56 }, (_, i) => 16 + Math.round(Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) * 56 + ((i * 37) % 11)));
const FOUND = [
  [7, 12],
  [24, 29],
  [41, 45],
];

export function CallWave() {
  return (
    <div
      role="img"
      aria-label="A call recording as a waveform with three moments highlighted where the customer made a request, and the transcript line for the first one"
      className="space-y-3"
    >
      <div className="flex h-24 items-center gap-[3px]">
        {BARS.map((h, i) => {
          const hit = FOUND.some(([a, b]) => i >= a && i <= b);
          return (
            <span
              key={i}
              style={{ height: `${h}%`, ...idx(i % 7) }}
              className={cn("rise w-full min-w-[2px] rounded-full", hit ? "bg-hue-amber" : "bg-seq-2/60")}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["00:42", "02:15", "03:58"].map((t) => (
          <span key={t} className="rounded-full bg-card px-2.5 py-0.5 font-mono text-[11px] font-medium shadow-card">
            {t}
          </span>
        ))}
      </div>
      <p className="rounded-xl bg-card p-3 text-sm shadow-card">
        <span className="font-mono text-xs text-muted-foreground">00:42 Priya </span>
        “We rebuild this every Monday.{" "}
        <span className="rounded-sm bg-mark px-0.5 text-ink">If I could just export it</span>…”
      </p>
    </div>
  );
}

export function NpsBar() {
  const seg = [
    { name: "Detractors", v: 12, cls: "bg-hue-coral text-on-brand" },
    { name: "Passives", v: 28, cls: "bg-input text-ink" },
    { name: "Promoters", v: 60, cls: "bg-hue-teal text-ink" },
  ];
  return (
    <div
      role="img"
      aria-label="Survey result: 12 percent detractors, 28 percent passives, 60 percent promoters, net promoter score plus 48"
      className="space-y-4"
    >
      <p className="font-display text-5xl font-extrabold tracking-tight">
        +<Count to={48} />
        <span className="ml-2 font-sans text-sm font-medium text-muted-foreground">NPS, sample</span>
      </p>
      <div className="grow-x flex h-10 gap-0.5">
        {seg.map((s) => (
          <span
            key={s.name}
            title={`${s.name}: ${s.v}%`}
            style={{ width: `${s.v}%` }}
            className={cn("flex items-center justify-center text-xs font-bold first:rounded-l-xl last:rounded-r-xl", s.cls)}
          >
            {s.v}%
          </span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {seg.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-2.5 rounded-sm", s.cls.split(" ")[0])} />
            {s.name}
          </li>
        ))}
      </ul>
      <p className="rounded-xl bg-card px-3 py-2 text-xs shadow-card">
        24 free-text answers went to the review queue.
      </p>
    </div>
  );
}

export function DeskChat() {
  return (
    <div
      role="img"
      aria-label="A support chat: a customer asks for a file export, a teammate replies, a private note is visible only to the team, and a button sends the message to the review queue"
      className="space-y-2.5 text-sm"
    >
      <p className="w-fit max-w-[88%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2 shadow-card">
        Can I get this out as a file?
      </p>
      <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground">
        Not yet, I will pass it on.
      </p>
      <p className="flex items-start gap-1.5 rounded-xl border-2 border-dashed border-hue-amber/60 bg-tint-amber px-3 py-2 text-xs">
        <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Private note: third time this week.
      </p>
      <p className="flex w-fit items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-link shadow-card">
        <Send aria-hidden="true" className="size-3.5" /> Send to review queue
      </p>
    </div>
  );
}

export function RoadmapMini() {
  const cols: { name: string; cards: { t: string; v: number; done?: boolean }[] }[] = [
    { name: "Planned", cards: [{ t: "Slack alerts", v: 128 }, { t: "Dark mode", v: 41 }] },
    { name: "In progress", cards: [{ t: "Single sign-on", v: 212 }] },
    { name: "Shipped", cards: [{ t: "Export to CSV", v: 305, done: true }] },
  ];
  return (
    <div
      role="img"
      aria-label="A public roadmap with three columns: planned, in progress and shipped, each card showing votes"
      className="grid grid-cols-3 gap-2 text-[12px]"
    >
      {cols.map((c, ci) => (
        <div key={c.name} className="space-y-2 rounded-xl bg-card/70 p-2">
          <p className="truncate font-semibold text-muted-foreground">{c.name}</p>
          {c.cards.map((k, ki) => (
            <p
              key={k.t}
              style={idx(ci + ki)}
              className="pop space-y-1 rounded-lg bg-card p-2 shadow-card"
            >
              <span className="flex items-start gap-1 font-medium">
                {k.done ? <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-hue-teal" /> : null}
                {k.t}
              </span>
              <span className="block font-mono text-[11px] text-muted-foreground">▲ {k.v}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- Scoreboard: numbers we can stand behind, with how they were measured ---------- */

export function Scoreboard() {
  const tiles: { big: ReactNode; label: string; note: string }[] = [
    {
      big: (
        <>
          <Count to={40} /> of 40
        </>
      ),
      label: "trick questions refused",
      note: "20 unanswerable and 20 with a false premise. A small synthetic set, measured once against one provider. A measurement, not a guarantee.",
    },
    {
      big: (
        <>
          ~<Count to={2} /> ms
        </>
      ),
      label: "to load a page of a filtered view over 100,000 quotes",
      note: "Measured locally on one machine with 50 requests. Real workloads vary.",
    },
    {
      big: <Check aria-hidden="true" className="size-14 text-sun" strokeWidth={2.5} />,
      label: "Nothing unapproved is sent",
      note: "The send worker itself refuses a message that has not been approved, not just the screen.",
    },
  ];
  return (
    <ul className="grid gap-px overflow-hidden rounded-3xl border border-on-brand/15 bg-on-brand/15 md:grid-cols-3">
      {tiles.map((t, i) => (
        <li key={t.label} style={idx(i)} className="reveal space-y-3 bg-ink p-7">
          <p className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">{t.big}</p>
          <p className="font-display text-base font-semibold">{t.label}</p>
          <p className="text-sm text-on-brand/65">{t.note}</p>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Integration tiles ---------- */

const MONO: Hue[] = ["blue", "teal", "amber", "coral", "sky"];
const MONO_BG: Record<Hue, string> = {
  blue: "bg-hue-blue",
  teal: "bg-hue-teal",
  amber: "bg-hue-amber",
  coral: "bg-hue-coral",
  sky: "bg-hue-sky",
};

export function IntegrationTiles({ names, more }: { names: string[]; more: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {names.map((n, i) => (
        <li
          key={n}
          style={idx(i % 4)}
          className="reveal group flex items-center gap-3 rounded-2xl bg-card p-3.5 shadow-card transition-[translate] duration-300 hover:-translate-y-1"
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl font-display text-base font-bold text-on-brand",
              MONO_BG[MONO[i % MONO.length]],
            )}
          >
            {n[0]}
          </span>
          <span className="min-w-0 text-sm font-medium">
            <span className="block truncate">{n}</span>
            <span className="text-xs font-normal text-muted-foreground">Available now</span>
          </span>
        </li>
      ))}
      {more > 0 ? (
        <li className="flex items-center justify-center rounded-2xl border-2 border-dashed border-input p-3.5 text-sm font-semibold text-link">
          <Link href="/integrations" className="underline underline-offset-4 hover:no-underline">
            +{more} more
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

/* ---------- Sticky call to action ---------- */

export function StickyCta() {
  return (
    <div className="sticky-cta pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink py-2 pr-2 pl-5 text-on-brand shadow-raised">
        <p className="hidden text-sm font-medium sm:block">Paste one conversation. See cited requests.</p>
        <Link
          href="/signup"
          className="inline-flex min-h-10 items-center rounded-full bg-sun px-5 text-sm font-bold text-ink transition-[translate] hover:-translate-y-0.5"
        >
          Start free
        </Link>
      </div>
    </div>
  );
}

