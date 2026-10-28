"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { FormError } from "./form-message";
import { btn } from "./ui";

/** A delete that says what will go before it happens. */
export function ConfirmDelete({
  label,
  consequences,
  confirmLabel,
  action,
  thenGo,
  compact = false,
}: {
  label: string;
  consequences: string;
  confirmLabel: string;
  action: () => Promise<{ error?: string }>;
  thenGo?: string;
  /** A small icon button for tight places such as table rows. The full label stays as its name. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (!open && compact)
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-tint-coral hover:text-destructive"
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    );
  if (!open)
    return (
      <button type="button" className={btn} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div
      role="group"
      aria-label={label}
      className="space-y-3 rounded-xl border border-border bg-background p-4"
    >
      <p className="text-sm">{consequences}</p>
      <div className="flex gap-3">
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await action();
              if (r.error) setError(r.error);
              else if (thenGo) router.push(thenGo);
              else router.refresh();
            })
          }
        >
          {pending ? "Deleting…" : confirmLabel}
        </button>
        <button type="button" className={btn} onClick={() => setOpen(false)}>
          Keep it
        </button>
      </div>
      <FormError message={error} />
    </div>
  );
}
