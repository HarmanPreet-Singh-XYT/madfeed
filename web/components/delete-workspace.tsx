"use client";

import { useActionState, useState } from "react";
import { deleteWorkspaceAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
        <Input
          id="confirm-name"
          name="confirmName"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          maxLength={200}
        />
      </div>
      <FormError message={state?.error} />
      <Button
        type="submit"
        variant="destructive"
        disabled={pending || typed.trim() !== name}
      >
        {pending ? "Deleting…" : "Delete this workspace forever"}
      </Button>
    </form>
  );
}
