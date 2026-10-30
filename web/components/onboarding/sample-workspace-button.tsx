"use client";

import { useActionState } from "react";
import { FlaskConical } from "lucide-react";
import { createSampleWorkspace } from "@/app/(app)/actions";
import { FormError } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

/** Opens a separate workspace with example data, for people who want to look around before adding their own. */
export function SampleWorkspaceButton({
  label = "Explore a sample workspace",
}: {
  label?: string;
}) {
  const [state, action] = useActionState(createSampleWorkspace, undefined);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="plain" pendingLabel="Setting up the sample…">
        <FlaskConical aria-hidden="true" />
        {label}
      </SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
