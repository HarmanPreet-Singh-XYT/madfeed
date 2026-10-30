"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { completeReset } from "@/app/login/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { link } from "./ui";
import { PasswordField, PasswordRules } from "@/components/password-field";

export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [state, action] = useActionState(
    completeReset.bind(null, tokenHash),
    undefined,
  );
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error} />
      <div>
        <PasswordField
          id="password"
          name="password"
          label="New password"
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
        label="New password again"
        autoComplete="new-password"
        maxLength={72}
        onChange={(e) => setPw2(e.target.value)}
      />
      <SubmitButton pendingLabel="Saving…" className="w-full">
        Set password and sign in
      </SubmitButton>
      <p className="text-sm text-muted-foreground">
        Link not working?{" "}
        <Link href="/forgot" className={link}>
          Ask for a new one
        </Link>
      </p>
    </form>
  );
}
