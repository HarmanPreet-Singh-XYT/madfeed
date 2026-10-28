"use client";

import { useActionState } from "react";
import { signIn } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";

export function SignInForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <Input
          id="name"
          name="name"
          defaultValue="alice"
          required
          maxLength={60}
          autoComplete="off"
          aria-describedby="name-help"
        />
        <p id="name-help" className="mt-1 text-sm text-muted-foreground">
          Local development sign-in: the same name always gives the same
          account.
        </p>
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
