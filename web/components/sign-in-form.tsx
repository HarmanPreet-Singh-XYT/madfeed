"use client";

import { useActionState } from "react";
import { signIn } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function SignInForm() {
  const [state, action] = useActionState(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <input
          id="name"
          name="name"
          defaultValue="alice"
          required
          maxLength={60}
          autoComplete="off"
          className={field}
          aria-describedby="name-help"
        />
        <p id="name-help" className="mt-1 text-sm text-muted">
          Local development sign-in: the same name always gives the same
          account.
        </p>
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
