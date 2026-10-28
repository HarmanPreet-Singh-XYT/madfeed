"use client";

import { useActionState, useState } from "react";
import {
  acceptAction,
  dismissAction,
  undoAction,
} from "@/app/(app)/w/[workspaceId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A Radix Select cannot use an empty string as a value; this stands in for "a new request". */
const ANY = "__any";

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
  const [target, setTarget] = useState("");
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
          className="space-y-2 rounded-xl border border-border bg-muted px-3 py-3 text-sm"
        >
          <p id={`looks-${proposalId}`}>
            <span className="font-medium">This may be the same as:</span>{" "}
            {suggestion.requestTitle}
          </p>
          {suggestion.reason ? (
            <p className="text-muted-foreground">{suggestion.reason}</p>
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
          <Input
            id={`title-${proposalId}`}
            name="title"
            defaultValue={title}
            maxLength={200}
            required
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
            <input type="hidden" name="targetRequestId" value={target} />
            <Select
              value={target || ANY}
              onValueChange={(v) => setTarget(v === ANY ? "" : v)}
            >
              <SelectTrigger id={`target-${proposalId}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>
                  A new request (using the title above)
                </SelectItem>
                {existing.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
