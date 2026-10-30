"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FormError } from "./form-message";

/**
 * Disconnecting stops the connection and forgets the stored token, so it asks
 * first. What was already sent and stored stays where it is.
 */
export function DisconnectButton({
  what,
  disabled,
  srSuffix,
  onConfirm,
}: {
  /** "Slack", "GitHub", "Sam's assistant": what is being disconnected. */
  what: string;
  disabled?: boolean;
  /** Extra context for a screen reader, such as which assistant. */
  srSuffix?: string;
  onConfirm: () => Promise<{ error?: string } | undefined> | void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled || pending}>
            Disconnect
            {srSuffix ? <span className="sr-only"> {srSuffix}</span> : null}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {what}?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing already sent to {what} is removed, and you can connect
              again whenever you like. The stored key or token is forgotten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormError message={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                start(async () => {
                  const r = await onConfirm();
                  if (r && "error" in r && r.error) {
                    setError(r.error);
                    return;
                  }
                  setOpen(false);
                });
              }}
            >
              {pending ? "Disconnecting…" : "Yes, disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
