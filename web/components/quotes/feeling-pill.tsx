"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { setSentimentAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FEELING_LOOK, feelingOf, type Feeling } from "./types";

const ORDER: Feeling[] = ["positive", "neutral", "negative", "mixed", "none"];

/**
 * How a quote feels, as a compact pill that opens a short list. The colour is a
 * hint; the word is always there. People who cannot write see the word only.
 */
export function FeelingPill({
  workspaceId,
  kind,
  id,
  value,
  source,
  canWrite,
  quote,
  size = "sm",
}: {
  workspaceId: string;
  kind: "evidence" | "highlight";
  id: string;
  value?: string;
  source?: string;
  canWrite: boolean;
  quote?: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<Feeling>(feelingOf(value));
  const [seen, setSeen] = useState(value);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  if (seen !== value) {
    setSeen(value);
    setCurrent(feelingOf(value));
  }
  const look = FEELING_LOOK[current];
  const label = `${look.label}${current !== "none" && source === "model" ? " (model)" : ""}`;
  const name = `How this quote feels${quote ? `: “${quote}”` : ""}. Now ${label.toLowerCase()}`;

  const badge = (
    <Badge
      variant={look.variant}
      className={cn(
        "gap-1.5 font-medium",
        size === "md" ? "h-6 px-2.5 text-xs" : "h-5 px-2",
        canWrite && "cursor-pointer",
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", look.dot)} />
      {label}
    </Badge>
  );

  if (!canWrite) return badge;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={name}
          title="Change how this quote feels"
          disabled={pending}
          className="rounded-4xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        <ul className="text-sm">
          {ORDER.map((f) => (
            <li key={f}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  const before = current;
                  setCurrent(f);
                  start(async () => {
                    const r = await setSentimentAction(workspaceId, kind, id, f);
                    if (r?.error) {
                      setCurrent(before);
                      toast.error(r.error);
                      return;
                    }
                    toast.success(
                      f === "none" ? "Feeling cleared." : `Marked ${FEELING_LOOK[f].label.toLowerCase()}.`,
                      {
                        action: {
                          label: "Undo",
                          onClick: () => {
                            setCurrent(before);
                            void setSentimentAction(workspaceId, kind, id, before).then(() => router.refresh());
                          },
                        },
                      },
                    );
                    router.refresh();
                  });
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span aria-hidden="true" className="flex size-4 items-center justify-center">
                  {current === f ? <Check className="size-3.5" /> : null}
                </span>
                <span aria-hidden="true" className={cn("size-2 rounded-full", FEELING_LOOK[f].dot)} />
                {FEELING_LOOK[f].label}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
