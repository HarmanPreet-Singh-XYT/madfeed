"use client";

import { useActionState } from "react";
import {
  cancelAccountDeletionAction,
  requestAccountDeletionAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { btn } from "./ui";
import { LocalTime } from "./local-time";

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
        <button type="submit" className={btn} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel my request"}
        </button>
      </form>
    );
  return (
    <form
      action={ask}
      className="max-w-md space-y-3"
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Ask for your account to be deleted? You'll be removed from every workspace and can't sign in again.",
          )
        )
          e.preventDefault();
      }}
    >
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
      <button type="submit" className={btn} disabled={asking}>
        {asking ? "Sending…" : "Ask for my account to be deleted"}
      </button>
    </form>
  );
}
