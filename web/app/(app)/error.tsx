"use client";

import { btnPrimary } from "@/components/ui";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="space-y-4 py-8">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted">
        We couldn&apos;t load this page. Nothing you did has been lost. Try
        again, and if it keeps happening let us know.
      </p>
      <button type="button" onClick={reset} className={btnPrimary}>
        Try again
      </button>
    </div>
  );
}
