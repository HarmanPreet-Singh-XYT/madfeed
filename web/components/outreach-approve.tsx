"use client";

import { useState, useTransition } from "react";
import {
  approveAction,
  cancelAction,
} from "@/app/(app)/w/[workspaceId]/outreach/actions";
import { plural } from "@/lib/format";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function OutreachApprove({
  workspaceId,
  batchId,
  ready,
  senderName,
}: {
  workspaceId: string;
  batchId: string;
  ready: number;
  senderName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string } | undefined>) {
    setError(undefined);
    start(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      setConfirming(false);
    });
  }

  return (
    <Card asChild className="[--card-spacing:0px] space-y-4 p-5">
      <section aria-labelledby="approve-h">
        <h2 id="approve-h" className="text-lg font-medium">
          Send these messages
        </h2>
        {ready === 0 ? (
          <p className="text-muted-foreground">
            Nothing is ready to send. Include at least one person, or cancel
            this batch.
          </p>
        ) : (
          <p className="text-muted-foreground">
            {plural(ready, "person", "people")} will each get one email from{" "}
            {senderName}. You can&apos;t recall an email once it is sent, so
            read them first. Anyone who has asked not to be emailed is skipped
            automatically.
          </p>
        )}
        {confirming ? (
          <div
            role="group"
            aria-label="Confirm sending"
            className="space-y-3 rounded-xl border border-border bg-background p-4"
          >
            <p className="font-medium">Send {plural(ready, "email")} now?</p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={pending}
                onClick={() => run(() => approveAction(workspaceId, batchId))}
              >
                {pending ? "Sending…" : `Yes, send ${plural(ready, "email")}`}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Not yet
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={pending || ready === 0}
              onClick={() => setConfirming(true)}
            >
              Approve and send {plural(ready, "message")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => cancelAction(workspaceId, batchId))}
            >
              Cancel this batch
            </Button>
          </div>
        )}
        <FormError message={error} />
      </section>
    </Card>
  );
}
