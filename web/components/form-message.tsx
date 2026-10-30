"use client";

import { useEffect, useRef } from "react";

/**
 * Announced to screen readers when it appears, and focused, so a keyboard or
 * screen-reader user lands on the reason a save was refused instead of being
 * left on a button with nothing to explain it.
 */
export function FormError({ message }: { message?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-lg border border-destructive bg-card px-3 py-2 text-sm text-destructive focus:outline-none"
    >
      {message}
    </p>
  );
}
