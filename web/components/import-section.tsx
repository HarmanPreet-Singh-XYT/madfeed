"use client";

import { useState } from "react";
import { card } from "./ui";

// The section starts open when there is nothing to show yet, but after that it
// belongs to the person: a page refresh (for example right after an import
// finishes) must never close it and hide the result.
export function ImportSection({
  initiallyOpen,
  children,
}: {
  initiallyOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      className={card}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer font-medium">
        Import from a spreadsheet
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
