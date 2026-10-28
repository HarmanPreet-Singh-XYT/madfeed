"use client";

import { useEffect, useState } from "react";
import { Command, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// A command palette that types its own questions: two answered with quotes, one refused for lack of evidence.
// Sample text only. It is decoration, so assistive tech gets one plain sentence instead of the animation.

type Answer =
  | { kind: "cited"; lead: string; rows: { who: string; note: string }[] }
  | { kind: "refused"; lead: string };

const QUERIES: { q: string; a: Answer }[] = [
  {
    q: "why are trials not converting?",
    a: {
      kind: "cited",
      lead: "Five accounts say setup takes too long.",
      rows: [
        { who: "Dana K.", note: "“took us a week to connect everything”" },
        { who: "Luis M.", note: "“we gave up on the import twice”" },
        { who: "Aya S.", note: "“needed a call just to get started”" },
      ],
    },
  },
  {
    q: "who asked for single sign-on?",
    a: {
      kind: "cited",
      lead: "3 accounts, $61k a year in total.",
      rows: [
        { who: "Northwind Logistics", note: "$24k · 2 quotes" },
        { who: "Brightside Health", note: "$21k · 1 quote" },
        { who: "Tallow & Finch", note: "$16k · 1 quote" },
      ],
    },
  },
  {
    q: "do customers want a dark mode?",
    a: { kind: "refused", lead: "No evidence in your conversations, so no answer." },
  },
];

const TYPE_MS = 45;
const HOLD_MS = 4200;

export function AskPalette() {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(QUERIES[0].q.length); // finished until the browser starts typing
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const ok = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = requestAnimationFrame(() => setAnimate(ok));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!animate) return;
    const q = QUERIES[i].q;
    let n = 0;
    let hold: ReturnType<typeof setTimeout>;
    const typing = setInterval(() => {
      n += 1;
      setTyped(n);
      if (n >= q.length) {
        clearInterval(typing);
        hold = setTimeout(() => {
          setTyped(0);
          setI((v) => (v + 1) % QUERIES.length);
        }, HOLD_MS);
      }
    }, TYPE_MS);
    return () => {
      clearInterval(typing);
      clearTimeout(hold);
    };
  }, [i, animate]);

  const { q, a } = QUERIES[i];
  const answered = typed >= q.length;

  return (
    <div>
      <p className="sr-only">
        Example: type a question such as “{QUERIES[0].q}” and get an answer with the quotes behind it, or a plain
        statement that there is no evidence.
      </p>
      <div aria-hidden="true" className="overflow-hidden rounded-2xl bg-ink text-on-brand shadow-raised">
        <div className="flex items-center gap-2 border-b border-on-brand/15 px-4 py-3">
          <Command className="size-4 text-on-brand/60" />
          <span className={cn("flex-1 text-sm", !answered && "caret")}>{q.slice(0, typed)}</span>
          <kbd className="rounded-md border border-on-brand/25 px-1.5 py-0.5 font-mono text-[11px] text-on-brand/70">
            ⌘K
          </kbd>
        </div>
        <div className="min-h-44 space-y-2 p-4 text-sm">
          {answered ? (
            a.kind === "cited" ? (
              <>
                <p className="font-semibold">{a.lead}</p>
                <ul className="space-y-1.5">
                  {a.rows.map((r, n) => (
                    <li
                      key={r.who}
                      className="flex items-center gap-2 rounded-lg bg-on-brand/8 px-3 py-2 text-[13px]"
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-sun text-[11px] font-bold text-ink">
                        {n + 1}
                      </span>
                      <span className="font-medium">{r.who}</span>
                      <span className="ml-auto truncate text-on-brand/70">{r.note}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-on-brand/30 p-4">
                <p className="font-semibold">{a.lead}</p>
                <p className="mt-1 text-on-brand/70">It would rather say so than guess.</p>
              </div>
            )
          ) : (
            <p className="flex items-center gap-2 text-on-brand/60">
              <CornerDownLeft className="size-4" /> Searching your quotes…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
