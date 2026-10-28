"use client";

import { useState } from "react";

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
      className="rounded-lg border border-border px-4 py-2"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-8 cursor-pointer text-[13px] font-medium">
        Import from a spreadsheet
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
