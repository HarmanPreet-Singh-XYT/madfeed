import type { components } from "@/lib/api/schema.gen";

export type QuoteRow = components["schemas"]["QuoteRow"];
export type QuoteView = components["schemas"]["QuoteView"];
export type TagLite = { id: string; name: string; color: string };

export type Feeling = "positive" | "neutral" | "negative" | "mixed" | "none";

export const FEELING_LOOK: Record<
  Feeling,
  { label: string; variant: "tint-teal" | "muted" | "tint-coral" | "tint-amber" | "outline"; dot: string }
> = {
  positive: { label: "Positive", variant: "tint-teal", dot: "bg-hue-teal" },
  neutral: { label: "Neutral", variant: "muted", dot: "bg-input" },
  negative: { label: "Negative", variant: "tint-coral", dot: "bg-hue-coral" },
  mixed: { label: "Mixed", variant: "tint-amber", dot: "bg-hue-amber" },
  none: { label: "Not labelled", variant: "outline", dot: "bg-border" },
};

export const SOURCE_LABEL: Record<string, string> = {
  paste: "Pasted",
  recording: "Recording",
  form: "Website form",
  api: "API",
  chat: "Chat",
  survey: "Survey",
};

export const SOURCES = ["paste", "recording", "form", "api", "chat", "survey"] as const;

export function feelingOf(value?: string): Feeling {
  return value === "positive" || value === "negative" || value === "mixed" || value === "neutral"
    ? value
    : "none";
}

export function quoteKey(q: { kind: string; id: string }) {
  return `${q.kind}:${q.id}`;
}

/** One line of a quote, for tab titles and screen-reader names. */
export function snippet(text: string, n = 60) {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

export function daysWord(days: number) {
  return days === 7 ? "Last 7 days" : days === 30 ? "Last 30 days" : days === 90 ? "Last 90 days" : "";
}
