"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field, link } from "./ui";

export function SignUpForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(signUp, undefined);
  const loginHref = next ? `/login?next=${next}` : "/login";
  if (state?.confirm)
    return (
      <div role="status" className="space-y-3">
        <p className="font-medium">Check your email</p>
        <p className="text-muted">
          If that address can be used, we&apos;ve sent a link to confirm it.
          Open the link, then{" "}
          <Link href={loginHref} className={link}>
            sign in
          </Link>
          .
        </p>
      </div>
    );
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
          defaultValue={state?.email ?? ""}
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
          minLength={10}
          maxLength={72}
          autoComplete="new-password"
          className={field}
          aria-describedby="pw-help"
        />
        <p id="pw-help" className="mt-1 text-sm text-muted">
          At least 10 characters.
        </p>
      </div>
      <div>
        <label htmlFor="password2" className="mb-1 block text-sm font-medium">
          Password again
        </label>
        <input
          id="password2"
          name="password2"
          type="password"
          required
          maxLength={72}
          autoComplete="new-password"
          className={field}
        />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Creating your account…">
        Create account
      </SubmitButton>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href={loginHref} className={link}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
