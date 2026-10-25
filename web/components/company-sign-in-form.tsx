"use client";

import { useActionState } from "react";
import { startCompanySignIn } from "@/app/login/sso/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { keepForm } from "@/lib/keep-form";
import { field } from "./ui";

export function CompanySignInForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(startCompanySignIn, undefined);
  return (
    <form method="post" onSubmit={keepForm(action)} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <p className="text-sm text-muted-foreground">
        Enter your work email address. You will be sent to your company&apos;s
        own sign-in page and brought back here.
      </p>
      <div>
        <label htmlFor="sso-email" className="mb-1 block text-sm font-medium">
          Work email address
        </label>
        <input
          id="sso-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="username"
          className={field}
        />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Taking you to your company…">
        Continue
      </SubmitButton>
    </form>
  );
}
