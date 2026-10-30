"use client";

import { useSyncExternalStore } from "react";
import { CHANGE_EVENT, readFlag } from "@/lib/onboarding";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * A remembered flag. It is `undefined` on the server and for the first client render (so nothing is drawn that
 * could disagree with the server's HTML), then the stored value or `null`.
 */
export function useFlag(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readFlag(key),
    () => undefined,
  );
}
