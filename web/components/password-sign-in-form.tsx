"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInWithEmail } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { link } from "./ui";
import { Input } from "@/components/ui/input";

export function PasswordSignInForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(signInWithEmail, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
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
          defaultValue={state?.email ?? ""}
          autoComplete="username"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
        />
      </div>
      <p className="text-sm">
        <Link href="/forgot" className={link}>
          Forgot your password?
        </Link>
      </p>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className={link}
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
