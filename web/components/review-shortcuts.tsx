"use client";

import { useEffect, useRef } from "react";

const CARD = "[data-proposal-card]";

/** True when the key press belongs to a field, a menu or a dialog rather than to the page. */
function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    Boolean(
      target.closest(
        "input, textarea, select, [role=combobox], [role=listbox], [role=menu], [role=dialog]",
      ),
    )
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground shadow-xs">
      {children}
    </kbd>
  );
}

/**
 * Keyboard triage for the review queue: J and K move between suggestions, A accepts the one in focus, D dismisses it.
 * It only presses the buttons that are already on the page, so every rule the buttons enforce still applies, and
 * nothing happens while a field, menu or dialog has the keyboard.
 */
export function ReviewShortcuts() {
  const index = useRef(-1);

  useEffect(() => {
    const cards = () =>
      Array.from(document.querySelectorAll<HTMLElement>(CARD));
    const show = (i: number) => {
      const all = cards();
      all.forEach((c) => c.removeAttribute("data-active"));
      if (all.length === 0) return;
      index.current = Math.min(Math.max(i, 0), all.length - 1);
      const card = all[index.current];
      card.setAttribute("data-active", "true");
      card.scrollIntoView({ block: "nearest" });
    };
    const press = (label: RegExp) => {
      const card = cards()[index.current];
      const button = Array.from(card?.querySelectorAll("button") ?? []).find(
        (b) => label.test(b.textContent ?? ""),
      );
      button?.click();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      switch (e.key.toLowerCase()) {
        case "j":
          e.preventDefault();
          show(index.current + 1);
          break;
        case "k":
          e.preventDefault();
          show(index.current < 0 ? 0 : index.current - 1);
          break;
        case "a":
          if (index.current < 0) return;
          e.preventDefault();
          press(/^Accept as a request/);
          break;
        case "d":
          if (index.current < 0) return;
          e.preventDefault();
          press(/^Dismiss/);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/70">Shortcuts</span>
      <span className="inline-flex items-center gap-1">
        <Key>J</Key>
        <Key>K</Key>
        move
      </span>
      <span aria-hidden="true" className="text-border">
        ·
      </span>
      <span className="inline-flex items-center gap-1">
        <Key>A</Key>
        accept
      </span>
      <span aria-hidden="true" className="text-border">
        ·
      </span>
      <span className="inline-flex items-center gap-1">
        <Key>D</Key>
        dismiss
      </span>
    </div>
  );
}
