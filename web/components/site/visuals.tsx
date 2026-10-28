import type { CSSProperties, ReactNode } from "react";
import { Check, Circle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Illustrations for the front page. Every figure is drawn from sample numbers (each says so), is described for
// screen readers (a sentence, plus a table where the data matters) and draws itself as it scrolls into view.
// Colours come from the tokens only: chart-1..4 are the categorical series in fixed order, seq-1..5 the one-hue ramp.

const idx = (i: number) => ({ "--i": i }) as CSSProperties;

/** A number that counts up as it scrolls into view. The real value stays in the text for assistive tech. */
export function Count({ to, className }: { to: number; className?: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn("count tabular-nums", className)}
        style={{ "--to": to } as CSSProperties}
      />
      <span className="sr-only">{to}</span>
    </>
  );
}

export function ChartCard({
  title,
  note,
  insight,
  children,
  className,
}: {
  title: string;
  note: string;
  insight?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "flex flex-col gap-4 rounded-3xl bg-card p-6 shadow-card",
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <span className="font-display text-lg font-semibold tracking-tight">
          {title}
        </span>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Sample data
        </span>
      </figcaption>
      <p className="-mt-2 text-sm text-muted-foreground">{note}</p>
      {children}
      {insight ? (
        <p className="mt-auto flex gap-2 rounded-2xl bg-tint-blue px-4 py-3 text-sm">
          <Sparkles
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-link"
          />
          {insight}
        </p>
      ) : null}
    </figure>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ background: i.color }}
          />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
] as const;

/* ---------- Funnel: one hue, longer and darker means more ---------- */

const FUNNEL_RAMP = ["bg-seq-5", "bg-seq-4", "bg-seq-3", "bg-seq-2"];

export function FunnelChart({
  rows,
}: {
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {rows.map((r, i) => (
          <li key={r.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{r.label}</span>
              <span className="font-display text-xl font-bold">
                <Count to={r.value} />
              </span>
            </div>
            <div className="h-3.5 rounded-full bg-muted">
              <div
                className={cn(
                  "grow-x h-full rounded-full",
                  FUNNEL_RAMP[i] ?? "bg-seq-2",
                )}
                style={{
                  ...idx(i),
                  width: `${Math.max(3, (r.value / max) * 100)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ol>
      <table className="sr-only">
        <caption>Sample week, from quotes found to shipped</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Trend: three lines, direct labels, one axis ---------- */

const WEEKS = ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"];
const TREND = [
  { name: "Export to CSV", data: [2, 3, 3, 5, 7, 9, 12, 15] },
  { name: "Single sign-on", data: [6, 6, 7, 7, 8, 8, 9, 9] },
  { name: "Slack alerts", data: [4, 3, 5, 4, 3, 4, 2, 2] },
];

export function TrendChart() {
  const W = 640;
  const H = 270;
  const L = 36;
  const R = 168;
  const T = 14;
  const B = 32;
  const pw = W - L - R;
  const ph = H - T - B;
  const max = 16;
  const x = (i: number) => L + (i * pw) / (WEEKS.length - 1);
  const y = (v: number) => T + ph * (1 - v / max);
  return (
    <div className="space-y-3">
      <Legend
        items={TREND.map((s, i) => ({ name: s.name, color: SERIES[i] }))}
      />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Line chart of mentions per week over eight weeks. Export to CSV climbs from 2 to 15, Single sign-on rises from 6 to 9, Slack alerts falls from 4 to 2."
        className="h-auto w-full"
      >
        {[0, 4, 8, 12, 16].map((t) => (
          <g key={t}>
            <line
              x1={L}
              x2={W - R}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={L - 8}
              y={y(t) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[14px]"
            >
              {t}
            </text>
          </g>
        ))}
        {WEEKS.map((w, i) =>
          i % 2 === 0 ? (
            <text
              key={w}
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[14px]"
            >
              {w}
            </text>
          ) : null,
        )}
        {TREND.map((s, si) => {
          const pts = s.data.map((v, i) => [x(i), y(v)] as const);
          const d = pts
            .map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`)
            .join(" ");
          const len = Math.ceil(
            pts.slice(1).reduce((a, [px, py], i) => {
              const [qx, qy] = pts[i];
              return a + Math.hypot(px - qx, py - qy);
            }, 0),
          );
          const [lx, ly] = pts[pts.length - 1];
          return (
            <g key={s.name}>
              <path
                d={d}
                fill="none"
                stroke={SERIES[si]}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="draw"
                style={{ "--len": len } as CSSProperties}
              />
              <circle
                cx={lx}
                cy={ly}
                r="5"
                fill={SERIES[si]}
                stroke="var(--card)"
                strokeWidth="2"
              />
              <text
                x={lx + 12}
                y={ly + 4}
                className="fill-foreground text-[15px] font-semibold"
              >
                {s.name} {s.data.at(-1)}
              </text>
              {pts.map(([px, py], i) => (
                <circle key={i} cx={px} cy={py} r="9" fill="transparent">
                  <title>{`${s.name}, ${WEEKS[i]}: ${s.data[i]} mentions`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Mentions per week</caption>
        <thead>
          <tr>
            <th scope="col">Request</th>
            {WEEKS.map((w) => (
              <th key={w} scope="col">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TREND.map((s) => (
            <tr key={s.name}>
              <th scope="row">{s.name}</th>
              {s.data.map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Sources: part to whole as stacked bars ---------- */

const SOURCE_NAMES = ["Calls", "Email", "Chat", "Surveys"];
// Text on each segment is picked for contrast on that colour.
const SEGMENT_TEXT = [
  "text-on-brand",
  "text-ink",
  "text-ink",
  "text-on-brand",
];
const SOURCE_ROWS = [
  { label: "Last month", shares: [44, 28, 18, 10] },
  { label: "This month", shares: [38, 27, 21, 14] },
];

export function SourcesChart() {
  return (
    <div className="space-y-4">
      <Legend
        items={SOURCE_NAMES.map((n, i) => ({ name: n, color: SERIES[i] }))}
      />
      <div
        role="img"
        aria-label={`Share of feedback by source. ${SOURCE_ROWS.map(
          (r) =>
            `${r.label}: ${r.shares.map((s, i) => `${SOURCE_NAMES[i]} ${s} percent`).join(", ")}`,
        ).join(". ")}.`}
        className="space-y-4"
      >
        {SOURCE_ROWS.map((r, ri) => (
          <div key={r.label} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {r.label}
            </p>
            <div className="grow-x flex h-11 gap-0.5" style={idx(ri)}>
              {r.shares.map((s, i) => (
                <div
                  key={SOURCE_NAMES[i]}
                  title={`${SOURCE_NAMES[i]}: ${s}%`}
                  className={cn(
                    "flex items-center justify-center text-xs font-bold first:rounded-l-xl last:rounded-r-xl",
                    SEGMENT_TEXT[i],
                  )}
                  style={{ width: `${s}%`, background: SERIES[i] }}
                >
                  {s}%
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Heatmap: tags by week, one hue ---------- */

const HEAT_ROWS = [
  { tag: "Reporting", data: [1, 2, 2, 4, 6, 9, 12, 15] },
  { tag: "Integrations", data: [2, 4, 3, 6, 5, 8, 7, 10] },
  { tag: "Security", data: [3, 3, 4, 4, 5, 5, 6, 6] },
  { tag: "Onboarding", data: [5, 4, 6, 3, 2, 2, 1, 1] },
  { tag: "Billing", data: [0, 1, 0, 2, 1, 1, 3, 2] },
];

function heatClass(v: number) {
  if (v === 0) return "bg-muted";
  if (v <= 2) return "bg-seq-1";
  if (v <= 4) return "bg-seq-2";
  if (v <= 7) return "bg-seq-3";
  if (v <= 10) return "bg-seq-4";
  return "bg-seq-5";
}

export function Heatmap() {
  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label="Heatmap of mentions per tag over eight weeks. Reporting grows from 1 to 15, Integrations from 2 to 10, Security stays near 3 to 6, Onboarding falls from 5 to 1, Billing stays low."
        className="grid grid-cols-[5.5rem_repeat(8,minmax(0,1fr))] items-center gap-0.5 text-[11px]"
      >
        <span />
        {WEEKS.map((w) => (
          <span key={w} className="text-center text-muted-foreground">
            {w}
          </span>
        ))}
        {HEAT_ROWS.map((r, ri) => (
          <div key={r.tag} className="contents">
            <span className="truncate pr-2 text-xs font-medium">{r.tag}</span>
            {r.data.map((v, ci) => (
              <span
                key={ci}
                title={`${r.tag}, ${WEEKS[ci]}: ${v} mentions`}
                className={cn("pop aspect-square rounded-md", heatClass(v))}
                style={idx(ri + ci)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        Fewer
        {["bg-muted", "bg-seq-1", "bg-seq-2", "bg-seq-3", "bg-seq-4", "bg-seq-5"].map(
          (c) => (
            <span
              key={c}
              aria-hidden="true"
              className={cn("size-4 rounded-md", c)}
            />
          ),
        )}
        More mentions
      </div>
    </div>
  );
}

/* ---------- Small pieces used inside the product mocks ---------- */

export function Sparkline({
  data,
  label,
  className,
}: {
  data: number[];
  label: string;
  className?: string;
}) {
  const W = 120;
  const H = 36;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data.map(
    (v, i) =>
      [
        (i * (W - 6)) / (data.length - 1) + 3,
        H - 5 - ((v - min) / Math.max(1, max - min)) * (H - 10),
      ] as const,
  );
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const len = Math.ceil(
    pts.slice(1).reduce((a, [x, y], i) => {
      const [qx, qy] = pts[i];
      return a + Math.hypot(x - qx, y - qy);
    }, 0),
  );
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className={cn("h-9 w-28", className)}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="draw"
        style={{ "--len": len } as CSSProperties}
      />
      <circle
        cx={lx}
        cy={ly}
        r="3.5"
        fill="var(--chart-1)"
        stroke="var(--card)"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Meter({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {value} of {max}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-2.5 rounded-full bg-muted"
      >
        <div
          className="grow-x h-full rounded-full bg-seq-4"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ---------- Product mocks used in the showcase panels ---------- */

export function QuoteProof() {
  return (
    <div
      role="img"
      aria-label="A stored quote with its source sentence highlighted in the original transcript, and a check that it appears word for word"
      className="space-y-3 rounded-2xl bg-card p-5 text-sm shadow-card"
    >
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Call transcript · 12:41</span>
        <span className="rounded-full bg-tint-teal px-2.5 py-0.5 text-foreground">
          Verbatim
        </span>
      </div>
      <p className="leading-relaxed text-muted-foreground">
        …so that part is fine. Honestly the thing that slows us down is{" "}
        <span className="rounded-sm bg-mark px-0.5 text-ink">
          having no way to export the table
        </span>
        , we copy it by hand every Monday…
      </p>
      <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
        <Check
          aria-hidden="true"
          className="size-4 shrink-0 text-hue-teal"
        />
        <span>
          Found word for word at characters{" "}
          <span className="font-mono font-semibold">1,204 to 1,241</span>
        </span>
      </div>
    </div>
  );
}

export function ReviewQueue() {
  const rows: [string, string, string][] = [
    ["Accept", "Export any table to CSV", "bg-tint-teal"],
    ["Merge", "Download usage as a file", "bg-tint-sky"],
    ["Dismiss", "Thanks for the quick reply", "bg-tint-coral"],
  ];
  return (
    <div
      role="img"
      aria-label="A review queue with three suggestions marked accept, merge and dismiss, and a meter showing 37 of 52 reviewed"
      className="space-y-3"
    >
      <ul className="space-y-2 text-sm">
        {rows.map(([a, t, c], i) => (
          <li
            key={t}
            style={idx(i)}
            className="reveal flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 shadow-card"
          >
            <span className="truncate font-medium">{t}</span>
            <span
              className={cn(
                "shrink-0 rounded-full px-3 py-0.5 text-xs font-semibold text-foreground",
                c,
              )}
            >
              {a}
            </span>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-card px-4 py-3 shadow-card">
        <Meter value={37} max={52} label="Reviewed this week" />
      </div>
    </div>
  );
}

export function AskRefuse() {
  return (
    <div
      role="img"
      aria-label="Two sample questions: one answered with three cited quotes, one refused because there is no evidence"
      className="space-y-3 text-sm"
    >
      <div className="space-y-2 rounded-2xl bg-card p-4 shadow-card">
        <p className="font-semibold">Why are trials not converting?</p>
        <p className="text-muted-foreground">
          Five accounts say setup takes too long.
        </p>
        <div className="flex gap-1.5">
          {["1", "2", "3"].map((n) => (
            <span
              key={n}
              className="flex size-6 items-center justify-center rounded-md bg-tint-blue text-xs font-bold text-link"
            >
              {n}
            </span>
          ))}
          <span className="ml-1 self-center text-xs text-muted-foreground">
            quotes cited
          </span>
        </div>
      </div>
      <div className="rounded-2xl border-2 border-dashed border-input bg-card/60 p-4">
        <p className="font-semibold">Do customers want a dark mode?</p>
        <p className="mt-1 text-muted-foreground">
          No evidence in your conversations, so no answer.
        </p>
      </div>
    </div>
  );
}

const PRIORITY: { name: string; value: number; trend: number[] }[] = [
  { name: "Export to CSV", value: 84, trend: [2, 3, 3, 5, 7, 9, 12, 15] },
  { name: "Single sign-on", value: 61, trend: [6, 6, 7, 7, 8, 8, 9, 9] },
  { name: "Slack alerts", value: 27, trend: [4, 3, 5, 4, 3, 4, 2, 2] },
  { name: "Dark mode", value: 9, trend: [1, 1, 2, 1, 1, 2, 1, 1] },
];

export function PriorityChart() {
  return (
    <div
      role="img"
      aria-label="Requests ranked by yearly value of the accounts asking: Export to CSV 84 thousand, Single sign-on 61 thousand, Slack alerts 27 thousand, Dark mode 9 thousand dollars"
      className="space-y-4 rounded-2xl bg-card p-5 shadow-card"
    >
      <p className="text-xs font-medium text-muted-foreground">
        Yearly value of the accounts asking, each counted once
      </p>
      <ul className="space-y-4">
        {PRIORITY.map((p, i) => (
          <li key={p.name} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="font-display font-bold tabular-nums">
                ${p.value}k
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-3 flex-1 rounded-full bg-muted">
                <div
                  className="grow-x h-full rounded-full bg-chart-1"
                  style={{ ...idx(i), width: `${(p.value / 84) * 100}%` }}
                />
              </div>
              <Sparkline
                data={p.trend}
                label={`${p.name}, mentions per week`}
                className="hidden w-20 sm:block"
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShipTimeline() {
  const steps: [string, boolean][] = [
    ["Marked shipped", true],
    ["3 drafts ready", true],
    ["You approve", false],
    ["Sent", false],
  ];
  return (
    <div
      role="img"
      aria-label="A draft message to a customer waiting for approval, and a four step timeline: marked shipped and drafts ready are done, you approve and sent are still to come"
      className="space-y-3"
    >
      <div className="space-y-3 rounded-2xl bg-card p-5 text-sm shadow-card">
        <p className="text-xs font-medium text-muted-foreground">
          Draft to Priya · uses her own words
        </p>
        <p className="leading-relaxed">
          You told us the Monday report took two hours. Export to CSV is live
          today.
        </p>
        <div className="flex gap-2 pt-1">
          <span className="pulse-ring rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow">
            Approve
          </span>
          <span className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium">
            Edit
          </span>
        </div>
      </div>
      <ol className="flex items-center justify-between gap-1 rounded-2xl bg-card px-4 py-3 text-xs shadow-card">
        {steps.map(([t, done], i) => (
          <li key={t} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                done
                  ? "bg-hue-teal text-on-brand"
                  : "border-2 border-input text-muted-foreground",
              )}
            >
              {done ? (
                <Check aria-hidden="true" className="size-3" />
              ) : (
                <Circle aria-hidden="true" className="size-2" />
              )}
            </span>
            <span className={cn("truncate", done ? "font-medium" : "")}>
              {t}
            </span>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="hidden h-px flex-1 bg-border sm:block"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
