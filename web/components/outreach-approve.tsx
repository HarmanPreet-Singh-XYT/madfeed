"use client";

import { useState, useTransition } from "react";
import {
  approveAction,
  cancelAction,
} from "@/app/(app)/w/[workspaceId]/outreach/actions";
import { plural } from "@/lib/format";
import { FormError } from "./form-message";
import { btn, btnPrimary, card } from "./ui";

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
    <section aria-labelledby="approve-h" className={`${card} space-y-4`}>
      <h2 id="approve-h" className="text-lg font-medium">
        Send these messages
      </h2>
      {ready === 0 ? (
        <p className="text-muted">
          Nothing is ready to send. Include at least one person, or cancel this
          batch.
        </p>
      ) : (
        <p className="text-muted">
          {plural(ready, "person", "people")} will each get one email from{" "}
          {senderName}. You can&apos;t recall an email once it is sent, so read
          them first. Anyone who has asked not to be emailed is skipped
          automatically.
        </p>
      )}
      {confirming ? (
        <div
          role="group"
          aria-label="Confirm sending"
          className="space-y-3 rounded-md border border-border bg-background p-4"
        >
          <p className="font-medium">Send {plural(ready, "email")} now?</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending}
              onClick={() => run(() => approveAction(workspaceId, batchId))}
            >
              {pending ? "Sending…" : `Yes, send ${plural(ready, "email")}`}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => setConfirming(false)}
            >
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={pending || ready === 0}
            onClick={() => setConfirming(true)}
          >
            Approve and send {plural(ready, "message")}
          </button>
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() => run(() => cancelAction(workspaceId, batchId))}
          >
            Cancel this batch
          </button>
        </div>
      )}
      <FormError message={error} />
    </section>
  );
}
