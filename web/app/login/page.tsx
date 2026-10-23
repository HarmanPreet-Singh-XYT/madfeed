import { Suspense } from "react";
import { connection } from "next/server";
import { PasswordSignInForm } from "@/components/password-sign-in-form";
import { SignInForm } from "@/components/sign-in-form";
import { Loading } from "@/components/loading";
import { devAuthEnabled } from "@/lib/server/dev-auth";
import { supabaseConfigured } from "@/lib/server/supabase-auth";
import { safeNext } from "@/lib/next-path";

export const metadata = { title: "Sign in" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <Suspense fallback={<Loading />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Which form to show depends on the running server's settings, so it is
// decided per request, never frozen into the build. The development sign-in
// only exists when explicitly switched on (and never in production).
async function Form({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection();
  const next = safeNext((await searchParams).next);
  const hidden = next === "/" ? "" : next;
  if (devAuthEnabled()) return <SignInForm next={hidden} />;
  if (supabaseConfigured()) return <PasswordSignInForm next={hidden} />;
  return (
    <p className="text-muted">
      Sign-in isn&apos;t available yet. Please check back soon.
    </p>
  );
}
