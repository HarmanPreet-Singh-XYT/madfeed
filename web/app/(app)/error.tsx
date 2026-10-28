"use client";

import { StandaloneFrame } from "@/components/app/standalone-frame";
import { Button } from "@/components/ui/button";

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
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </div>
    </StandaloneFrame>
  );
}
