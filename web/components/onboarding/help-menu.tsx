"use client";

import { useState } from "react";
import {
  BookOpen,
  CircleHelp,
  Keyboard,
  Lightbulb,
  LightbulbOff,
  Route,
} from "lucide-react";
import { KEYS, resetTips, writeFlag } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { START_TOUR_EVENT } from "./product-tour";
import { useFlag } from "./use-flag";

const SHORTCUTS: { where: string; keys: [string, string][] }[] = [
  {
    where: "Anywhere",
    keys: [["⌘K or Ctrl K", "Search, or jump to any screen"]],
  },
  {
    where: "Review",
    keys: [
      ["J / K", "Next or previous suggestion"],
      ["A", "Accept the suggestion in focus"],
      ["D", "Dismiss it"],
    ],
  },
  {
    where: "Quotes and People",
    keys: [
      ["J / K or ↓ / ↑", "Move down or up the list"],
      ["X", "Select the row in focus"],
      ["Enter", "Open it (Quotes)"],
      ["/", "Focus the search box (People)"],
      ["Esc", "Close what is open"],
    ],
  },
  {
    where: "Findings and Inbox",
    keys: [
      ["⌘S or Ctrl S", "Save a finding"],
      ["⌘Enter or Ctrl Enter", "Send a reply"],
    ],
  },
];

/**
 * The Help button in the top bar: replay the tour, see the keyboard shortcuts, open the guides, and switch the
 * one-line tips on each screen off or back on. `className` styles the button where the bar is not white.
 */
export function HelpMenu({ className }: { className?: string }) {
  const [shortcuts, setShortcuts] = useState(false);
  const tipsOff = useFlag(KEYS.hints) === "off";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-tour="help"
            className={className}
          >
            <CircleHelp aria-hidden="true" />
            <span className="sr-only">Help</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Help</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}
          >
            <Route aria-hidden="true" />
            Take the product tour
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcuts(true)}>
            <Keyboard aria-hidden="true" />
            Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/docs" target="_blank" rel="noopener">
              <BookOpen aria-hidden="true" />
              Read the guides
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              if (tipsOff) {
                // Back on means every tip, including the ones closed one by one before.
                resetTips();
              } else {
                writeFlag(KEYS.hints, "off");
              }
            }}
          >
            {tipsOff ? (
              <Lightbulb aria-hidden="true" />
            ) : (
              <LightbulbOff aria-hidden="true" />
            )}
            {tipsOff ? "Show tips on each screen" : "Hide tips on each screen"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              They only work when you are not typing in a field.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {SHORTCUTS.map((s) => (
              <section key={s.where} aria-label={s.where}>
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {s.where}
                </h3>
                <dl className="divide-y divide-border rounded-lg border border-border">
                  {s.keys.map(([k, d]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                    >
                      <dt>
                        <kbd
                          className={cn(
                            "rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs",
                          )}
                        >
                          {k}
                        </kbd>
                      </dt>
                      <dd className="text-right text-muted-foreground">{d}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
