"use client";

import { useActionState, useState } from "react";
import { deleteWorkspaceAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { field } from "./ui";

export function DeleteWorkspace({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(
    deleteWorkspaceAction.bind(null, workspaceId),
    undefined,
  );
  const [typed, setTyped] = useState("");
  return (
    <form action={action} className="max-w-md space-y-3">
      <p className="text-sm">
        This permanently deletes <strong>{name}</strong> and everything in it:
        conversations, recordings, requests, people, surveys, messages and
        settings, for every teammate. It can&apos;t be undone, and a download of
        your data (above) is the only copy you&apos;ll have.
      </p>
      <p className="text-sm text-muted-foreground">
        If the workspace has a paid plan, cancel it under Billing first.
      </p>
      <div>
        <label
          htmlFor="confirm-name"
          className="mb-1 block text-sm font-medium"
        >
          Type the workspace name to confirm
        </label>
        <input
          id="confirm-name"
          name="confirmName"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          maxLength={200}
          className={field}
        />
      </div>
      <FormError message={state?.error} />
      <button
        type="submit"
        disabled={pending || typed.trim() !== name}
        className="inline-flex min-h-11 items-center rounded-md bg-destructive px-4 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete this workspace forever"}
      </button>
    </form>
  );
}
