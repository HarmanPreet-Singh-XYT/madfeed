import type { components } from "@/lib/api/schema.gen";

type Counts = components["schemas"]["QualityGroup"]["counts"];

/** The windows the quality page offers. A short one is for a recent change; 30 is the default. */
export const QUALITY_RANGES = [7, 30, 90] as const;
export type QualityRange = (typeof QUALITY_RANGES)[number];

/** Anything else falls back to 30 days rather than passing a surprising value to the API. */
export function parseQualityDays(value: string | undefined): QualityRange {
  const n = Number(value);
  return (QUALITY_RANGES as readonly number[]).includes(n)
    ? (n as QualityRange)
    : 30;
}

export type Outcome = {
  key: "accepted" | "acceptedEdited" | "dismissed" | "stillOpen";
  label: string;
  count: number;
  /** Share of the suggestions a person ruled on; zero for the ones still waiting. */
  percent: number;
  tone: string;
};

/**
 * What happened to the suggestions, in the order a person meets them: accepted
 * as suggested, accepted after an edit, dismissed, and still waiting. Waiting
 * is outside the rates, so its percent is 0 and its bar is measured against the
 * whole pile instead.
 */
export function outcomeSegments(counts: Counts): Outcome[] {
  const decided = counts.accepted + counts.dismissed;
  const total = decided + counts.stillOpen;
  const pctOf = (n: number) =>
    decided > 0 ? Math.round((n * 100) / decided) : 0;
  return [
    {
      key: "accepted",
      label: "Accepted as suggested",
      count: Math.max(0, counts.accepted - counts.acceptedEdited),
      percent: pctOf(Math.max(0, counts.accepted - counts.acceptedEdited)),
      tone: "bg-hue-teal",
    },
    {
      key: "acceptedEdited",
      label: "Accepted after a change",
      count: counts.acceptedEdited,
      percent: pctOf(counts.acceptedEdited),
      tone: "bg-hue-sky",
    },
    {
      key: "dismissed",
      label: "Dismissed",
      count: counts.dismissed,
      percent: pctOf(counts.dismissed),
      tone: "bg-hue-coral",
    },
    {
      key: "stillOpen",
      label: "Waiting for review",
      count: counts.stillOpen,
      percent: total > 0 ? Math.round((counts.stillOpen * 100) / total) : 0,
      tone: "bg-muted-foreground/40",
    },
  ];
}

/** Widths for the stacked bar: decided parts fill the bar; waiting keeps its share of everything. */
export function outcomeWidths(counts: Counts): Record<Outcome["key"], number> {
  const decided = counts.accepted + counts.dismissed;
  const total = decided + counts.stillOpen;
  const share = (n: number) => (total > 0 ? (n * 100) / total : 0);
  return {
    accepted: share(Math.max(0, counts.accepted - counts.acceptedEdited)),
    acceptedEdited: share(counts.acceptedEdited),
    dismissed: share(counts.dismissed),
    stillOpen: share(counts.stillOpen),
  };
}

export type RateDelta = {
  kind: "up" | "down" | "same" | "none";
  /** Percentage points, always positive; the kind carries the direction. */
  points: number;
};

/**
 * Compare a rate with the equally long window before it, in percentage points
 * (not percent change: 21/31 to 25/31 is +9 points, not +19%). A previous
 * window with too few decisions is not compared at all.
 */
export function rateDelta(
  current: number | undefined,
  previous: number | undefined,
  previousDecided: number,
  minDecided: number,
): RateDelta {
  if (
    current === undefined ||
    previous === undefined ||
    previousDecided < minDecided
  ) {
    return { kind: "none", points: 0 };
  }
  const points = Math.round(Math.abs(current - previous) * 100);
  if (points === 0) return { kind: "same", points: 0 };
  return { kind: current > previous ? "up" : "down", points };
}
