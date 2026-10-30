"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInWithEmail } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { link } from "./ui";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/password-field";

export function PasswordSignInForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(signInWithEmail, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormError message={state?.error} />
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
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          enterKeyHint="next"
        />
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <Link href="/forgot" className="text-sm text-link underline underline-offset-2 hover:no-underline">
            Forgot?
          </Link>
        </div>
        <PasswordField
          id="password"
          name="password"
          label=""
          autoComplete="current-password"
          maxLength={200}
        />
      </div>
      <SubmitButton pendingLabel="Signing in…" className="w-full">
        Sign in
      </SubmitButton>
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
