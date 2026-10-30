"use client";

import { usePathname } from "next/navigation";
import { Lightbulb, X } from "lucide-react";
import { KEYS, hintFor, writeFlag } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { useFlag } from "./use-flag";

/**
 * A short, closable explanation at the top of a tool's page the first time someone opens it: what the screen is for
 * and two or three things worth knowing. Closing it remembers that in this browser; the Help menu can bring the
 * tips back or switch them all off. Nothing shows on detail pages or the overview, and nothing shows until the
 * browser has said what was already closed, so a closed tip never flashes.
 */
export function PageHint({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const hint = hintFor(pathname, `/w/${workspaceId}`);
  const allOff = useFlag(KEYS.hints);
  const closed = useFlag(hint ? KEYS.hint(hint.id) : KEYS.hints);
  if (!hint || allOff === undefined || closed === undefined) return null;
  if (allOff === "off" || closed === "seen") return null;
  return (
    <section
      aria-label="Tip"
      data-onboarding-hint={hint.id}
      className="mb-4 rounded-lg border border-border bg-tint-blue p-4 text-sm text-foreground"
    >
      <div className="flex items-start gap-3">
        <Lightbulb
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-link"
        />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">{hint.title}</p>
          <p className="mt-0.5 text-muted-foreground">{hint.body}</p>
          {hint.tips.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {hint.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => writeFlag(KEYS.hint(hint.id), "seen")}
            >
              Got it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => writeFlag(KEYS.hints, "off")}
            >
              Hide all tips
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => writeFlag(KEYS.hint(hint.id), "seen")}
        >
          <X aria-hidden="true" />
          <span className="sr-only">Close this tip</span>
        </Button>
      </div>
    </section>
  );
}
