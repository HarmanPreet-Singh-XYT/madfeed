"use client";

import { useActionState } from "react";
import { saveViewAction } from "@/app/(app)/w/[workspaceId]/requests/view-actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

/** Saves whatever filters are on screen under a name everyone in the workspace can use. */
export function SaveViewForm({
  workspaceId,
  status,
  tag,
  q,
  sort,
}: {
  workspaceId: string;
  status: string;
  tag: string;
  q: string;
  sort: string;
}) {
  const [state, action] = useActionState(
    saveViewAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="tag" value={tag} />
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="sort" value={sort} />
      <div>
        <label htmlFor="view-name" className="mb-1 block text-sm font-medium">
          Save this view as
        </label>
        <input
          id="view-name"
          name="name"
          required
          maxLength={60}
          className={field}
        />
      </div>
      <SubmitButton variant="plain" pendingLabel="Saving…">
        Save view
      </SubmitButton>
      <FormError message={state?.error} />
      {state && "notice" in state && state.notice ? (
        <p role="status" className="text-sm text-muted">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
