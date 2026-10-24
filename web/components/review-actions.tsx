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
  existing = [],
  suggestion,
}: {
  workspaceId: string;
  proposalId: string;
  title: string;
  existing?: { id: string; title: string }[];
  /** A guess that this is about a request that already exists; a person decides. */
  suggestion?: { requestId: string; requestTitle: string; reason: string };
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
      {suggestion ? (
        <form
          action={accept}
          aria-labelledby={`looks-${proposalId}`}
          className="space-y-2 rounded-md border border-border bg-surface px-3 py-3 text-sm"
        >
          <p id={`looks-${proposalId}`}>
            <span className="font-medium">This may be the same as:</span>{" "}
            {suggestion.requestTitle}
          </p>
          {suggestion.reason ? (
            <p className="text-muted">{suggestion.reason}</p>
          ) : null}
          <input type="hidden" name="title" value={title} />
          <input
            type="hidden"
            name="targetRequestId"
            value={suggestion.requestId}
          />
          <SubmitButton variant="plain" pendingLabel="Adding…">
            Add it to that request
          </SubmitButton>
        </form>
      ) : null}
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
        {existing.length > 0 ? (
          <div>
            <label
              htmlFor={`target-${proposalId}`}
              className="mb-1 block text-sm font-medium"
            >
              Add it to
            </label>
            <select
              id={`target-${proposalId}`}
              name="targetRequestId"
              defaultValue=""
              className={field}
            >
              <option value="">A new request (using the title above)</option>
              {existing.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}
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
