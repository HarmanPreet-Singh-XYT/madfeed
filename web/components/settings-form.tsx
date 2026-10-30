"use client";

import { useActionState } from "react";
import { saveSettingsAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsForm({
  workspaceId,
  publicSlug,
  senderName,
}: {
  workspaceId: string;
  publicSlug: string;
  senderName: string;
}) {
  const [state, action] = useActionState(
    saveSettingsAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="senderName" className="mb-1 block text-sm font-medium">
          Name that signs messages
        </Label>
        <Input
          id="senderName"
          name="senderName"
          defaultValue={senderName}
          maxLength={100}
          aria-describedby="sender-help"
        />
        <p id="sender-help" className="mt-1 text-sm text-muted-foreground">
          Shown as the sender and at the end of each message, for example “Priya
          from Acme”.
        </p>
      </div>
      <div>
        <Label htmlFor="publicSlug" className="mb-1 block text-sm font-medium">
          Public address for release notes
        </Label>
        <Input
          id="publicSlug"
          name="publicSlug"
          defaultValue={publicSlug}
          maxLength={40}
          pattern="[a-z0-9][a-z0-9\-]{2,39}|"
          aria-describedby="slug-help"
        />
        <p id="slug-help" className="mt-1 text-sm text-muted-foreground">
          3 to 40 lowercase letters, numbers or hyphens. Published notes appear
          at /r/your-address. Leave empty to have no public page.
        </p>
      </div>
      <FormError message={state?.error} />
      {state?.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      ) : null}
      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  );
}
