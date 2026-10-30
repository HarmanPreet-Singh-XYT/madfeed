"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signUp } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { link } from "./ui";
import { Input } from "@/components/ui/input";
import { PasswordField, PasswordRules } from "@/components/password-field";

export function SignUpForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(signUp, undefined);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  if (state?.confirm)
    return (
      <div role="status" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <p className="font-medium">Check your email</p>
        <p className="text-muted-foreground">
          If that address can be used, we&apos;ve sent a link to confirm it.
          Open the link, then{" "}
          <Link href={loginHref} className={link}>
            sign in
          </Link>
          .
        </p>
        <Link href={loginHref} className={link}>
          Back to sign in
        </Link>
      </div>
    );
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
          defaultValue={state?.email ?? ""}
          required
          maxLength={320}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
        />
      </div>
      <div>
        <PasswordField
          id="password"
          name="password"
          label="Password"
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
          describedBy="pw-help"
          onChange={(e) => setPw(e.target.value)}
        />
        <PasswordRules id="pw-help" password={pw} again={pw2} />
      </div>
      <PasswordField
        id="password2"
        name="password2"
        label="Password again"
        autoComplete="new-password"
        maxLength={72}
        onChange={(e) => setPw2(e.target.value)}
      />
      <SubmitButton pendingLabel="Creating your account…" className="w-full">
        Create account
      </SubmitButton>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={loginHref} className={link}>
          Sign in
        </Link>
      </p>
      <p className="text-xs text-muted-foreground">
        By creating an account you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:no-underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:no-underline">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
