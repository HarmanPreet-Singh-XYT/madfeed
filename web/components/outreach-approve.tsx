"use client";

import { useState, useTransition } from "react";
import { Check, Minus } from "lucide-react";
import {
  approveAction,
  cancelAction,
} from "@/app/(app)/w/[workspaceId]/outreach/actions";
import { plural } from "@/lib/format";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The last step before anything leaves: what will happen, checked off in plain words, and one clear action. Sending
 * asks once more in a dialog, because an email can't be recalled. (The send itself refuses anything not approved.)
 */
export function OutreachApprove({
  workspaceId,
  batchId,
  ready,
  left = 0,
  senderName,
}: {
  workspaceId: string;
  batchId: string;
  ready: number;
  /** People in this batch who won't get an email (left out, or asked not to be emailed). */
  left?: number;
  senderName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string } | undefined>) {
    setError(undefined);
    start(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      setConfirming(false);
      setCancelling(false);
    });
  }

  const checks: { ok: boolean; text: string }[] = [
    {
      ok: ready > 0,
      text:
        ready > 0
          ? `${plural(ready, "person", "people")} will each get one email from ${senderName}.`
          : "Nobody is ready to send to yet. Include at least one person.",
    },
    {
      ok: true,
      text: "Each message is based on that person's own words, shown beside it.",
    },
    {
      ok: true,
      text: "Anyone who asked not to be emailed is skipped automatically, and every email ends with a link to stop updates.",
    },
    {
      ok: left === 0,
      text:
        left === 0
          ? "Nobody has been left out."
          : `${plural(left, "person", "people")} will not be emailed.`,
    },
  ];

  return (
    <Card asChild className="[--card-spacing:0px] p-0">
      <section aria-labelledby="approve-h">
        <div className="border-b border-border px-5 py-3">
          <h2 id="approve-h" className="text-base font-semibold">
            Ready to send?
          </h2>
          <p className="text-sm text-muted-foreground">
            You can&apos;t recall an email once it is sent, so read them first.
          </p>
        </div>
        <ul className="divide-y divide-border px-5">
          {checks.map((c) => (
            <li key={c.text} className="flex items-start gap-3 py-3 text-sm">
              <span
                aria-hidden="true"
                className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full ${c.ok ? "bg-tint-teal text-hue-teal" : "bg-tint-amber text-hue-amber"}`}
              >
                {c.ok ? (
                  <Check className="size-3" />
                ) : (
                  <Minus className="size-3" />
                )}
              </span>
              <span>
                <span className="sr-only">{c.ok ? "OK: " : "Note: "}</span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/50 px-5 py-3">
          <Button
            type="button"
            disabled={pending || ready === 0}
            onClick={() => setConfirming(true)}
          >
            Approve and send {plural(ready, "message")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setCancelling(true)}
          >
            Cancel this batch
          </Button>
        </div>
        <FormError message={error} />

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Send {plural(ready, "email")} now?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {plural(ready, "person", "people")} will each get one email from{" "}
                {senderName}. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  run(() => approveAction(workspaceId, batchId));
                }}
              >
                {pending ? "Sending…" : `Yes, send ${plural(ready, "email")}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={cancelling} onOpenChange={setCancelling}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this batch?</AlertDialogTitle>
              <AlertDialogDescription>
                No emails will be sent and the drafts are discarded. The request
                is not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                Keep the batch
              </AlertDialogCancel>
              <AlertDialogAction
                variant="danger"
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  run(() => cancelAction(workspaceId, batchId));
                }}
              >
                {pending ? "Cancelling…" : "Yes, cancel it"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </Card>
  );
}
