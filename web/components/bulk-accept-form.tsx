"use client";

import { useActionState } from "react";
import { bulkAcceptAction } from "@/app/(app)/w/[workspaceId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BulkAcceptForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(
    bulkAcceptAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label
          id="threshold-label"
          htmlFor="threshold"
          className="text-sm text-muted-foreground"
        >
          Accept everything at or above
        </Label>
        <Select name="threshold" defaultValue="0.9">
          <SelectTrigger id="threshold" aria-labelledby="threshold-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0.95">95% confident</SelectItem>
            <SelectItem value="0.9">90% confident</SelectItem>
            <SelectItem value="0.8">80% confident</SelectItem>
          </SelectContent>
        </Select>
        <SubmitButton variant="plain" size="sm" pendingLabel="Accepting…">
          Accept all
        </SubmitButton>
      </div>
      <p className="basis-full text-xs text-muted-foreground">
        Each one becomes a request with its quote as evidence. You can undo any
        of them afterwards.
      </p>
      <FormError message={state?.error} />
    </form>
  );
}
