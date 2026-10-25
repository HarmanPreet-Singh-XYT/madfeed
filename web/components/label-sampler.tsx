"use client";

import { useState, useTransition } from "react";
import { setSentimentAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { FormError } from "./form-message";
import { FEELINGS } from "@/lib/feelings";
import { btn, card } from "./ui";

type Item = { kind: "evidence" | "highlight"; id: string; text: string };

/** One quote at a time, judged on its words alone (the model's label is never shown here). */
export function LabelSampler({
  workspaceId,
  items,
  labelled,
}: {
  workspaceId: string;
  items: Item[];
  labelled: number;
}) {
  const [left, setLeft] = useState(items);
  const [done, setDone] = useState(labelled);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const now = left[0];
  if (!now)
    return (
      <p role="status" className="text-muted-foreground">
        That is all of this batch. You have labelled {done} quotes in total.
      </p>
    );
  const choose = (label: keyof typeof FEELINGS) =>
    start(async () => {
      const r = await setSentimentAction(workspaceId, now.kind, now.id, label);
      setError(r?.error);
      if (!r?.error) {
        setLeft(left.slice(1));
        setDone(done + 1);
      }
    });
  return (
    <div className={`${card} space-y-4`}>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {done} labelled so far · {left.length} left in this batch
      </p>
      <blockquote className="text-lg">“{now.text}”</blockquote>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          How does the person feel about the product?
        </legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FEELINGS) as (keyof typeof FEELINGS)[]).map((l) => (
            <button
              key={l}
              type="button"
              className={btn}
              disabled={pending}
              onClick={() => choose(l)}
            >
              {FEELINGS[l]}
            </button>
          ))}
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() => setLeft(left.slice(1))}
          >
            Skip
          </button>
        </div>
      </fieldset>
      <FormError message={error} />
    </div>
  );
}
