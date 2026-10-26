import { Suspense } from "react";
import { connection } from "next/server";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { Loading } from "@/components/loading";
import { supabaseConfigured } from "@/lib/server/supabase-auth";

export const metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <Suspense fallback={<Loading />}>
        <Form />
      </Suspense>
    </main>
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
