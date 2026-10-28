import type { CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { GRADIENT } from "@/components/site/landing";

// The two ways of doing the same job, side by side. No competitor is named: the "old way" is memory, spreadsheets
// and a pile of transcripts, which every team recognises.
const ROWS: [old: string, now: string][] = [
  [
    "Read transcripts by hand, one at a time",
    "Paste or forward them. The requests inside are proposed for you",
  ],
  [
    "A summary you cannot check",
    "Every claim links to the exact sentence, verified word for word",
  ],
  [
    "The loudest voice wins",
    "Requests weighed by the value of the accounts asking, each counted once",
  ],
  [
    "Feedback lives in five tools",
    "One review queue for calls, email, chat, surveys and forms",
  ],
  [
    "Customers never hear back",
    "Personal drafts to each person who asked, sent only when you approve",
  ],
  [
    "An AI answer that always sounds sure",
    "Answers that cite quotes, or say there is no evidence",
  ],
];

export function Versus() {
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 overflow-hidden rounded-[2rem] shadow-card md:grid-cols-2">
      <div className="bg-card p-6 sm:p-10">
        <h3 className="font-display text-2xl font-bold tracking-tight text-muted-foreground">
          Memory and spreadsheets
        </h3>
        <ul className="mt-6 space-y-4">
          {ROWS.map(([o], i) => (
            <li
              key={o}
              style={{ "--i": i } as CSSProperties}
              className="reveal flex gap-3 text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted"
              >
                <X className="size-3.5" />
              </span>
              <span>{o}</span>
            </li>
          ))}
        </ul>
      </div>
      <div
        className={cn(
          "relative overflow-hidden p-6 text-on-brand sm:p-10",
          GRADIENT,
        )}
      >
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 size-72 rounded-full bg-hue-sky/40 blur-3xl"
        />
        <h3 className="relative font-display text-2xl font-bold tracking-tight">
          {SITE.name}
        </h3>
        <ul className="relative mt-6 space-y-4">
          {ROWS.map(([, n], i) => (
            <li
              key={n}
              style={{ "--i": i } as CSSProperties}
              className="reveal flex gap-3"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-sun text-ink"
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <span className="font-medium">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
