"use client";

import { btnPrimary } from "@/components/ui";
import { StandaloneFrame } from "@/components/app/standalone-frame";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <StandaloneFrame>
      <div role="alert" className="space-y-4 py-8">
        <h1 className="font-display text-2xl font-bold">
          Something went wrong
        </h1>
        <p className="text-muted-foreground">
          We couldn&apos;t load this page. Nothing you did has been lost. Try
          again, and if it keeps happening let us know.
        </p>
        <button type="button" onClick={reset} className={btnPrimary}>
          Try again
        </button>
      </div>
    </StandaloneFrame>
  );
}
