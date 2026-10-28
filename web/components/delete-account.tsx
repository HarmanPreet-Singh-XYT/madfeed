"use client";

import { useActionState } from "react";
import {
  cancelAccountDeletionAction,
  requestAccountDeletionAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { LocalTime } from "./local-time";
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

export function DeleteAccount({
  workspaceId,
  requestedAt,
}: {
  workspaceId: string;
  /** ISO time of the open request, if there is one. */
  requestedAt?: string;
}) {
  const [askState, ask, asking] = useActionState(
    requestAccountDeletionAction.bind(null, workspaceId),
    undefined,
  );
  const [cancelState, cancel, cancelling] = useActionState(
    cancelAccountDeletionAction.bind(null, workspaceId),
    undefined,
  );
  if (requestedAt)
    return (
      <form action={cancel} className="max-w-md space-y-3">
        <p role="status" className="text-sm">
          You asked for your account to be deleted on{" "}
          <strong>
            <LocalTime iso={requestedAt} />
          </strong>
          . We do this by hand, so it isn&apos;t instant. We&apos;ll remove you
          from your workspaces and delete your sign-in account.
        </p>
        <FormError message={cancelState?.error} />
        <Button type="submit" variant="outline" disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel my request"}
        </Button>
      </form>
    );
  return (
    <form action={ask} className="max-w-md space-y-3">
      <p className="text-sm">
        Ask us to delete your sign-in account. A person on our team does this by
        hand, so it isn&apos;t instant. You&apos;ll be removed from every
        workspace, and the API keys and assistant connections you made stop
        working. What your teammates and customers wrote stays with the
        workspace.
      </p>
      <p className="text-sm text-muted-foreground">
        If you&apos;re the only admin of a workspace others use, make someone
        else an admin first. If you&apos;re the only person in a workspace,
        delete it first (below), or we&apos;ll ask you what to do with it.
      </p>
      <FormError message={askState?.error} />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" disabled={asking}>
            {asking ? "Sending…" : "Ask for my account to be deleted"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Ask for my account to be deleted
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ask for your account to be deleted? You&apos;ll be removed from
              every workspace and can&apos;t sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={asking}
              onClick={() => ask()}
            >
              Ask for my account to be deleted
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
