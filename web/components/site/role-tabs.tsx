"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Role = {
  id: string;
  label: string;
  title: string;
  body: string;
  points: string[];
  prompts: { q: string; a: string; refused?: boolean }[];
  visual: ReactNode;
};

// Notion-style "see how it works for people like you": pick a role, get its story, a picture, and the questions
// that role would ask. Server-rendered content passes in as props, so only the tab state is client-side.
export function RoleTabs({ roles }: { roles: Role[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + roles.length) % roles.length;
    setActive(n);
    refs.current[n]?.focus();
  }

  const r = roles[active];
  return (
    <div>
      <div
        role="tablist"
        aria-label="Who is using it"
        className="mx-auto mb-8 flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-secondary p-1.5 sm:w-fit"
      >
        {roles.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`role-tab-${x.id}`}
            aria-selected={i === active}
            aria-controls={`role-panel-${x.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold transition-all",
              i === active
                ? "bg-card text-foreground shadow-card"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div
        key={r.id}
        id={`role-panel-${r.id}`}
        role="tabpanel"
        aria-labelledby={`role-tab-${r.id}`}
        className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
      >
        <div className="grid grid-cols-1 items-center gap-8 rounded-[2rem] bg-tint-blue p-6 sm:p-12 lg:grid-cols-2 lg:gap-14">
          <div className="space-y-5">
            <h3 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              {r.title}
            </h3>
            <p className="text-lg text-muted-foreground">{r.body}</p>
            <ul className="space-y-2">
              {r.points.map((p) => (
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
          <div>{r.visual}</div>
        </div>

        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {r.prompts.map((p) => (
            <li key={p.q} className="space-y-3 rounded-3xl bg-secondary p-5">
              <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-card px-4 py-2.5 text-sm shadow-card">
                {p.q}
              </p>
              <p
                className={cn(
                  "w-fit max-w-[92%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm",
                  p.refused
                    ? "border-2 border-dashed border-input bg-transparent text-muted-foreground"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {p.a}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
