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
        <p>
          You are invited to join <strong>{workspace}</strong> as {role}, but
          the invitation was sent to <strong>{email}</strong>. You are signed in
          with a different address, or one that has not been confirmed yet.
        </p>
        <p className="text-sm text-muted-foreground">
          Sign out, then sign in or create an account with {email} (and confirm
          it from the email we send) to join.
        </p>
        <form action={signOut}>
          <SubmitButton variant="plain" pendingLabel="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <p>
        You are invited to join <strong>{workspace}</strong> as {role}, using{" "}
        {email}.
      </p>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Joining…">Join {workspace}</SubmitButton>
    </form>
  );
}
