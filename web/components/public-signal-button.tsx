"use client";

import { useActionState } from "react";
import { checkPublicSignalAction } from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";

export function PublicSignalButton({
  workspaceId,
  requestId,
  label,
}: {
  workspaceId: string;
  requestId: string;
  label: string;
}) {
  const [state, action] = useActionState(
    () => checkPublicSignalAction(workspaceId, requestId),
    undefined,
  );
  return (
    <form action={action} className="space-y-2">
      <SubmitButton pendingLabel="Searching the web…">{label}</SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
