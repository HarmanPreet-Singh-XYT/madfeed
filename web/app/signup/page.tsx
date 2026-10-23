import { Suspense } from "react";
import { connection } from "next/server";
import { Loading } from "@/components/loading";
import { SignUpForm } from "@/components/sign-up-form";
import { safeNext } from "@/lib/next-path";
import { supabaseConfigured } from "@/lib/server/supabase-auth";

export const metadata = { title: "Create an account" };

export default function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <Suspense fallback={<Loading />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Decided per request, never frozen into the build: sign-up only exists when the identity
// service is configured.
async function Form({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection();
  const next = safeNext((await searchParams).next);
  if (!supabaseConfigured())
    return (
      <p className="text-muted">
        Creating an account isn&apos;t available yet. Please check back soon.
      </p>
    );
  return <SignUpForm next={next === "/" ? "" : next} />;
}
