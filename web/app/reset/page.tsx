import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import Link from "next/link";
import { connection } from "next/server";
import { Loading } from "@/components/loading";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { link } from "@/components/ui";
import { supabaseConfigured } from "@/lib/server/supabase-auth";

export const metadata = { title: "Choose a new password", robots: { index: false } };

const TOKEN_HASH = /^[A-Za-z0-9_-]{8,200}$/;

export default function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  return (
    <AuthShell title="Choose a new password">
      <Suspense fallback={<Loading />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

// The code in the link is only used when the form is submitted, never when the page opens, so a mail
// scanner that follows the link cannot use it up.
async function Form({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  await connection();
  const { token_hash } = await searchParams;
  if (!supabaseConfigured())
    return (
      <p className="text-muted-foreground">
        Password reset isn&apos;t available yet. Please check back soon.
      </p>
    );
  if (!token_hash || !TOKEN_HASH.test(token_hash))
    return (
      <p className="text-muted-foreground">
        This reset link isn&apos;t valid.{" "}
        <Link href="/forgot" className={link}>
          Ask for a new one
        </Link>
        .
      </p>
    );
  return <ResetPasswordForm tokenHash={token_hash} />;
}
