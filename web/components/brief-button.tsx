"use client";

import { useActionState } from "react";
import { requestBriefAction } from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";

export function BriefButton({
  workspaceId,
  requestId,
  label,
}: {
  workspaceId: string;
  requestId: string;
  label: string;
}) {
  const [state, action] = useActionState(
    () => requestBriefAction(workspaceId, requestId),
    undefined,
  );
  return (
    <form action={action} className="space-y-2">
      <SubmitButton pendingLabel="Starting…">{label}</SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
