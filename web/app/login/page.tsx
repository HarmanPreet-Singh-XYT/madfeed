import { Suspense } from "react";
import { connection } from "next/server";
import { PasswordSignInForm } from "@/components/password-sign-in-form";
import { SignInForm } from "@/components/sign-in-form";
import { Loading } from "@/components/loading";
import { devAuthEnabled } from "@/lib/server/dev-auth";
import { supabaseConfigured } from "@/lib/server/supabase-auth";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <Suspense fallback={<Loading />}>
        <Form />
      </Suspense>
    </main>
  );
}

// Which form to show depends on the running server's settings, so it is
// decided per request, never frozen into the build. The development sign-in
// only exists when explicitly switched on (and never in production).
async function Form() {
  await connection();
  if (devAuthEnabled()) return <SignInForm />;
  if (supabaseConfigured()) return <PasswordSignInForm />;
  return (
    <p className="text-muted">
      Sign-in isn&apos;t available yet. Please check back soon.
    </p>
  );
}
