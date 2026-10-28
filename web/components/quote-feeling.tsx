"use client";

import { useState, useTransition } from "react";
import { setSentimentAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { FEELINGS } from "@/lib/feelings";
import { FormError } from "./form-message";
// The local `Label` type below already names a feeling, so the primitive is aliased.
import { Label as FieldLabel } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      <FieldLabel htmlFor={`f-${id}`} className="sr-only">
        How this quote feels
      </FieldLabel>
      <Select
        value={current.v ?? "none"}
        onValueChange={(nextValue) => {
          const next = nextValue as Label | "none";
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
        <SelectTrigger
          id={`f-${id}`}
          className="!h-auto !w-auto !py-1 text-sm"
          disabled={pending}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            {current.s === "model" && current.v
              ? `${FEELINGS[current.v]} (model)`
              : "Not labelled"}
          </SelectItem>
          {(Object.keys(FEELINGS) as Label[]).map((l) => (
            <SelectItem key={l} value={l}>
              {FEELINGS[l]}
              {current.s === "human" && current.v === l ? " (you)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FormError message={error} />
    </span>
  );
}
