import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { connection } from "next/server";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { Loading } from "@/components/loading";
import { supabaseConfigured } from "@/lib/server/supabase-auth";

export const metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPage() {
  return (
    <AuthShell
      title="Reset your password"
      lead="Enter the email on your account and we'll send you a link."
    >
      <Suspense fallback={<Loading />}>
        <Form />
      </Suspense>
    </AuthShell>
  );
}

async function Form() {
  await connection();
  if (!supabaseConfigured())
    return (
      <p className="text-muted-foreground">
        Password reset isn&apos;t available yet. Please check back soon.
      </p>
    );
  return <ForgotPasswordForm />;
}
