"use client";

import { useActionState } from "react";
import { startCompanySignIn } from "@/app/login/sso/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { keepForm } from "@/lib/keep-form";
import { Input } from "@/components/ui/input";

export function CompanySignInForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(startCompanySignIn, undefined);
  return (
    <form method="post" onSubmit={keepForm(action)} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormError message={state?.error} />
      <div>
        <label htmlFor="sso-email" className="mb-1 block text-sm font-medium">
          Work email address
        </label>
        <Input
          id="sso-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
        />
        <p className="mt-1 text-sm text-muted-foreground">
          Use the address your company gave you.
        </p>
      </div>
      <SubmitButton pendingLabel="Taking you to your company…" className="w-full">
        Continue
      </SubmitButton>
    </form>
  );
}
