"use client";

import { useState, useTransition } from "react";
import { confirmUnsubscribe } from "@/app/unsubscribe/actions";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";

export function UnsubscribeForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (done) {
    return (
      <p role="status" className="text-lg">
        You&apos;re unsubscribed. You won&apos;t get any more emails like this.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await confirmUnsubscribe(token);
            if (res.ok) setDone(true);
            else setError(res.error);
          })
        }
      >
        {pending ? "Unsubscribing…" : "Unsubscribe"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
