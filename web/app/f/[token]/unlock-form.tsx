"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { unlockFindingAction } from "./actions";
import { FormError } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function UnlockForm({ token }: { token: string }) {
  const [state, action] = useActionState(
    unlockFindingAction.bind(null, token),
    undefined,
  );
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Lock aria-hidden="true" className="size-4 text-link" />
        <p className="text-sm font-medium">This link is password protected</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Enter the password you were given to read these findings.
      </p>
      <form action={action} className="space-y-3">
        <div>
          <Label
            htmlFor="finding-password"
            className="mb-1 block text-sm font-medium"
          >
            Password
          </Label>
          <Input
            id="finding-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </div>
        <FormError message={state?.error} />
        <SubmitButton pendingLabel="Checking…">Open findings</SubmitButton>
      </form>
    </div>
  );
}
