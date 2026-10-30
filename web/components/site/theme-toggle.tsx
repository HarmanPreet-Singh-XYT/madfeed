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

/** Switch between light and dark, and remember the choice (the palette's "Switch to dark mode" uses this too). */
export function setDarkMode(dark: boolean) {
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    // Private mode: the choice just lasts until the page closes.
  }
}

export const darkModeOn = isDark;

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  const toggle = () => setDarkMode(!dark);

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
