"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="max-w-sm space-y-3">
      <div>
        <label htmlFor="current" className="mb-1 block text-sm font-medium">
          Current password
        </label>
        <input
          id="current"
          name="current"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
          className={field}
        />
      </div>
      <div>
        <label
          htmlFor="new-password"
          className="mb-1 block text-sm font-medium"
        >
          New password (at least 10 characters)
        </label>
        <input
          id="new-password"
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={72}
          autoComplete="new-password"
          className={field}
        />
      </div>
      <div>
        <label
          htmlFor="new-password2"
          className="mb-1 block text-sm font-medium"
        >
          New password again
        </label>
        <input
          id="new-password2"
          name="password2"
          type="password"
          required
          maxLength={72}
          autoComplete="new-password"
          className={field}
        />
      </div>
      <FormError message={state?.error} />
      {state?.done ? (
        <p role="status" className="text-sm">
          Your password has been changed.
        </p>
      ) : null}
      <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
    </form>
  );
}
