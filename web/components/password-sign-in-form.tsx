"use client";

import { useActionState } from "react";
import { signInWithEmail } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function PasswordSignInForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(signInWithEmail, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="username"
          className={field}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
          className={field}
        />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
