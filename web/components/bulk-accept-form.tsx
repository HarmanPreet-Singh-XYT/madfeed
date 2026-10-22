"use client";

import { useActionState } from "react";
import { bulkAcceptAction } from "@/app/(app)/w/[workspaceId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function BulkAcceptForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(
    bulkAcceptAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="threshold" className="mb-1 block text-sm font-medium">
          Accept everything at or above
        </label>
        <select
          id="threshold"
          name="threshold"
          defaultValue="0.9"
          className={field}
        >
          <option value="0.95">95% confident</option>
          <option value="0.9">90% confident</option>
          <option value="0.8">80% confident</option>
        </select>
      </div>
      <SubmitButton variant="plain" pendingLabel="Accepting…">
        Accept all
      </SubmitButton>
      <p className="basis-full text-sm text-muted">
        Each one becomes a request with its quote as evidence. You can undo any
        of them afterwards.
      </p>
      <FormError message={state?.error} />
    </form>
  );
}
