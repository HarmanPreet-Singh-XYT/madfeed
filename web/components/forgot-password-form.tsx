"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestReset } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { link } from "./ui";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestReset, undefined);
  if (state?.sent)
    return (
      <div role="status" className="space-y-3">
        <p className="font-medium">Check your email</p>
        <p className="text-muted-foreground">
          If that address has an account, we&apos;ve sent a link to choose a new
          password. It works once and expires soon.
        </p>
        <Link href="/login" className={link}>
          Back to sign in
        </Link>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email address
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="username"
        />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
      <p className="text-sm">
        <Link href="/login" className={link}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
