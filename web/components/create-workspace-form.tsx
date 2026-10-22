"use client";

import { useActionState } from "react";
import { createWorkspace } from "@/app/(app)/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function CreateWorkspaceForm() {
  const [state, action] = useActionState(createWorkspace, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Workspace name
        </label>
        <input
          id="name"
          name="name"
          defaultValue="My team"
          required
          maxLength={200}
          className={field}
        />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Creating…">Create workspace</SubmitButton>
    </form>
  );
}
