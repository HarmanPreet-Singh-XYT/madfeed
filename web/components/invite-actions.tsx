"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/app/invite/actions";
import { signOut } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";

export function InviteActions({
  token,
  workspace,
  role,
  email,
  canAccept,
}: {
  token: string;
  workspace: string;
  role: string;
  email: string;
  canAccept: boolean;
}) {
  const [state, action] = useActionState(
    acceptInviteAction.bind(null, token),
    undefined,
  );
  if (!canAccept)
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Invitation
          </p>
          <p className="font-display text-xl font-semibold tracking-tight">
            {workspace}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            as {role.charAt(0).toUpperCase() + role.slice(1)} · {email}
          </p>
        </div>
        <p>
          This invitation was sent to <strong>{email}</strong>, but you are
          signed in with a different address, or one that has not been confirmed
          yet.
        </p>
        <p className="text-sm text-muted-foreground">
          Sign out, then sign in or create an account with {email} (and confirm
          it from the email we send) to join.
        </p>
        <form action={signOut}>
          <SubmitButton variant="plain" pendingLabel="Signing out…" className="w-full">
            Sign out
          </SubmitButton>
        </form>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Invitation
        </p>
        <p className="font-display text-xl font-semibold tracking-tight">
          {workspace}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          as {role.charAt(0).toUpperCase() + role.slice(1)} · {email}
        </p>
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Joining…" className="w-full">
        Join {workspace}
      </SubmitButton>
    </form>
  );
}
