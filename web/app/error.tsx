"use client";

import { Button } from "@/components/ui/button";

// For every page outside the signed-in app (public roadmap, surveys, chat, sign-in, invitations).
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-16"
    >
      <div role="alert" className="space-y-4">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground">
          We couldn&apos;t load this page. Nothing you did has been lost. Try
          again in a moment.
        </p>
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
