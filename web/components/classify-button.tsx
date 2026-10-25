"use client";

import { useState, useTransition } from "react";
import { classifyAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { FormError } from "./form-message";
import { btn } from "./ui";

export function ClassifyButton({
  workspaceId,
  pending: waiting,
}: {
  workspaceId: string;
  pending: number;
}) {
  const [msg, setMsg] = useState<{ error?: string; message?: string }>();
  const [busy, start] = useTransition();
  if (waiting === 0)
    return <p className="text-sm text-muted-foreground">Every quote has a model label.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {waiting} {waiting === 1 ? "quote has" : "quotes have"} no model label
        yet (quotes you labelled yourself are included, so the two can be
        compared). The model reads up to 200 at a time (20 per request); a model
        run costs money, and quotes are sent to your AI provider.
      </p>
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={() =>
          start(async () => setMsg(await classifyAction(workspaceId)))
        }
      >
        Let the model label up to 200
      </button>
      <FormError message={msg?.error} />
      {msg?.message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {msg.message}
        </p>
      ) : null}
    </div>
  );
}
