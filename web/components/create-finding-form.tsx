"use client";

import { useActionState } from "react";
import { createFindingAction } from "@/app/(app)/w/[workspaceId]/findings/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function CreateFindingForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(
    createFindingAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">
        <label htmlFor="doc-title" className="mb-1 block text-sm font-medium">
          Title
        </label>
        <input
          id="doc-title"
          name="title"
          required
          maxLength={200}
          className={field}
          placeholder="For example, What customers say about sign-in"
        />
      </div>
      <SubmitButton pendingLabel="Creating…">Start a document</SubmitButton>
      <div className="basis-full">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}
