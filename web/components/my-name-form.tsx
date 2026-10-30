"use client";

import { useActionState } from "react";
import { saveMyNameAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The name teammates see on conversations you take and messages you write. */
export function MyNameForm({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  const [state, action] = useActionState(
    saveMyNameAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="my-name" className="mb-1 block text-sm font-medium">
          Your name
        </Label>
        <Input
          id="my-name"
          name="name"
          defaultValue={name}
          maxLength={80}
          aria-describedby="my-name-help"
        />
        <p id="my-name-help" className="mt-1 text-sm text-muted-foreground">
          What teammates see when you take a conversation. Leave it empty and
          they see “a teammate”.
        </p>
      </div>
      <FormError message={state?.error} />
      {state?.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Saving…">Save my name</SubmitButton>
    </form>
  );
}
