"use client";

import { useActionState } from "react";
import { createNoteAction } from "@/app/(app)/w/[workspaceId]/releases/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function CreateNoteForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(
    createNoteAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">
        <label htmlFor="note-title" className="mb-1 block text-sm font-medium">
          Title
        </label>
        <input
          id="note-title"
          name="title"
          required
          maxLength={200}
          className={field}
          placeholder="What shipped?"
        />
      </div>
      <SubmitButton pendingLabel="Creating…">Start a note</SubmitButton>
      <div className="basis-full">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}
