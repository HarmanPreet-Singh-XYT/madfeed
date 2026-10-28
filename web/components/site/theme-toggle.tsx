"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

// The theme lives on <html data-theme>. Light is the default; "dark" is saved in localStorage and restored before
// first paint by a script in the root layout.
function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => obs.disconnect();
}

const isDark = () => document.documentElement.dataset.theme === "dark";

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = dark ? "light" : "dark";
    if (next === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode: the choice just lasts until the page closes.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={dark}
      onClick={toggle}
      className="rounded-lg"
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      <span className="sr-only">Dark mode</span>
    </Button>
  );
}
