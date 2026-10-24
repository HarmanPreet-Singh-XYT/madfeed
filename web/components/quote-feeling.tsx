"use client";

import { useState, useTransition } from "react";
import { setSentimentAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { FEELINGS } from "@/lib/feelings";
import { FormError } from "./form-message";
import { field } from "./ui";

type Label = keyof typeof FEELINGS;

/** How a quote feels: shows who said so (a person or the model) and lets a person decide. */
export function QuoteFeeling({
  workspaceId,
  kind,
  id,
  value,
  source,
  canWrite,
}: {
  workspaceId: string;
  kind: "evidence" | "highlight";
  id: string;
  value?: Label;
  source?: "human" | "model";
  canWrite: boolean;
}) {
  const [current, setCurrent] = useState<{ v?: Label; s?: "human" | "model" }>({
    v: value,
    s: source,
  });
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (!canWrite)
    return (
      <span className="text-sm">
        {current.v ? FEELINGS[current.v] : "Not labelled"}
        {current.v && current.s === "model" ? " (model)" : ""}
      </span>
    );
  return (
    <span className="inline-flex flex-col gap-1">
      <label htmlFor={`f-${id}`} className="sr-only">
        How this quote feels
      </label>
      <select
        id={`f-${id}`}
        className={`${field} !w-auto !py-1 text-sm`}
        disabled={pending}
        value={current.v ?? "none"}
        onChange={(e) => {
          const next = e.target.value as Label | "none";
          start(async () => {
            const r = await setSentimentAction(workspaceId, kind, id, next);
            setError(r?.error);
            if (!r?.error)
              setCurrent(
                next === "none"
                  ? {
                      v: value && source === "model" ? value : undefined,
                      s: source === "model" ? "model" : undefined,
                    }
                  : { v: next, s: "human" },
              );
          });
        }}
      >
        <option value="none">
          {current.s === "model" && current.v
            ? `${FEELINGS[current.v]} (model)`
            : "Not labelled"}
        </option>
        {(Object.keys(FEELINGS) as Label[]).map((l) => (
          <option key={l} value={l}>
            {FEELINGS[l]}
            {current.s === "human" && current.v === l ? " (you)" : ""}
          </option>
        ))}
      </select>
      <FormError message={error} />
    </span>
  );
}
