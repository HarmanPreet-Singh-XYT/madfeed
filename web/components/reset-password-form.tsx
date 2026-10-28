"use client";

import Link from "next/link";
import { useActionState } from "react";
import { completeReset } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { link } from "./ui";
import { Input } from "@/components/ui/input";

export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [state, action] = useActionState(
    completeReset.bind(null, tokenHash),
    undefined,
  );
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={72}
          autoComplete="new-password"
          aria-describedby="pw-help"
        />
        <p id="pw-help" className="mt-1 text-sm text-muted-foreground">
          At least 10 characters.
        </p>
      </div>
      <div>
        <label htmlFor="password2" className="mb-1 block text-sm font-medium">
          New password again
        </label>
        <Input
          id="password2"
          name="password2"
          type="password"
          required
          maxLength={72}
          autoComplete="new-password"
        />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Saving…">
        Set password and sign in
      </SubmitButton>
      <p className="text-sm text-muted-foreground">
        Link not working?{" "}
        <Link href="/forgot" className={link}>
          Ask for a new one
        </Link>
      </p>
    </form>
  );
}
