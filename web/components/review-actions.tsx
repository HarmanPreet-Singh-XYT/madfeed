"use client";

import { useActionState } from "react";
import {
  acceptAction,
  dismissAction,
  undoAction,
} from "@/app/(app)/w/[workspaceId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function SuggestedActions({
  workspaceId,
  proposalId,
  title,
}: {
  workspaceId: string;
  proposalId: string;
  title: string;
}) {
  const [acceptState, accept] = useActionState(
    acceptAction.bind(null, workspaceId, proposalId),
    undefined,
  );
  const [dismissState, dismiss] = useActionState(
    () => dismissAction(workspaceId, proposalId),
    undefined,
  );
  const error = acceptState?.error ?? dismissState?.error;
  return (
    <div className="space-y-3">
      <form action={accept} className="space-y-3">
        <div>
          <label
            htmlFor={`title-${proposalId}`}
            className="mb-1 block text-sm font-medium"
          >
            Request title
          </label>
          <input
            id={`title-${proposalId}`}
            name="title"
            defaultValue={title}
            maxLength={200}
            required
            className={field}
          />
        </div>
        <SubmitButton pendingLabel="Accepting…">
          Accept as a request
        </SubmitButton>
      </form>
      <form action={dismiss}>
        <SubmitButton variant="plain" pendingLabel="Dismissing…">
          Dismiss
        </SubmitButton>
      </form>
      <FormError message={error} />
    </div>
  );
}

export function UndoAction({
  workspaceId,
  proposalId,
}: {
  workspaceId: string;
  proposalId: string;
}) {
  const [state, undo] = useActionState(
    () => undoAction(workspaceId, proposalId),
    undefined,
  );
  return (
    <form action={undo} className="space-y-2">
      <SubmitButton variant="plain" pendingLabel="Undoing…">
        Undo
      </SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
