"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Circle } from "lucide-react";
import { signUp } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field, link } from "./ui";

export function SignUpForm({ next = "" }: { next?: string }) {
  const [state, action] = useActionState(signUp, undefined);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  if (state?.confirm)
    return (
      <div role="status" className="space-y-3">
        <p className="font-medium">Check your email</p>
        <p className="text-muted-foreground">
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
          onChange={(e) => setPw(e.target.value)}
        />
        <ul id="pw-help" aria-live="polite" className="mt-2 space-y-1 text-sm">
          {[
            ["At least 10 characters", pw.length >= 10],
            ["Both passwords match", pw.length > 0 && pw === pw2],
          ].map(([label, ok]) => (
            <li
              key={label as string}
              className={
                ok
                  ? "flex items-center gap-2 text-foreground"
                  : "flex items-center gap-2 text-muted-foreground"
              }
            >
              {ok ? (
                <Check aria-hidden="true" className="size-4 text-hue-teal" />
              ) : (
                <Circle aria-hidden="true" className="size-4" />
              )}
              {label as string}
              <span className="sr-only">{ok ? " (done)" : " (not yet)"}</span>
            </li>
          ))}
        </ul>
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
          onChange={(e) => setPw2(e.target.value)}
        />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Creating your account…">
        Create account
      </SubmitButton>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={loginHref} className={link}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
