"use client";

import { useState, useTransition } from "react";
import { confirmDigestUnsubscribe } from "@/app/digest/unsubscribe/actions";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";

export function DigestUnsubscribeForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (done) {
    return (
      <p role="status" className="text-lg">
        Done. You won&apos;t get the weekly digest any more.
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
            const res = await confirmDigestUnsubscribe(token);
            if (res.ok) setDone(true);
            else setError(res.error);
          })
        }
      >
        {pending ? "Stopping…" : "Stop the digest"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
