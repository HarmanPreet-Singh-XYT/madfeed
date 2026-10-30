"use client";

import { useActionState } from "react";
import { renameWorkspaceAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** What everyone in the workspace sees it called, and what appears in the sidebar. */
export function WorkspaceNameForm({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  const [state, action] = useActionState(
    renameWorkspaceAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="workspace-name-field" className="mb-1 block text-sm font-medium">
          Workspace name
        </Label>
        <Input
          id="workspace-name-field"
          name="name"
          defaultValue={name}
          maxLength={80}
          required
          aria-describedby="workspace-name-help"
        />
        <p id="workspace-name-help" className="mt-1 text-sm text-muted-foreground">
          Shown to everyone in the workspace and in the sidebar. This is not the
          name that signs messages to customers: that is on the Customers tab.
        </p>
      </div>
      <FormError message={state?.error} />
      {state?.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Saving…">Save name</SubmitButton>
    </form>
  );
}
