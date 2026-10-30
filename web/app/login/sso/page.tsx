import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CompanySignInForm } from "@/components/company-sign-in-form";
import { Loading } from "@/components/loading";
import { ssoEnabled } from "@/lib/server/sso";
import { safeNext } from "@/lib/next-path";
import { AuthShell } from "@/components/auth-shell";
import { link } from "@/components/ui";

export const metadata = { title: "Sign in with your company", robots: { index: false } };

export default function CompanySignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <AuthShell
      title="Sign in with your company"
      lead="We will take you to your company's own sign-in page and bring you back."
    >
      <Suspense fallback={<Loading />}>
        <Form searchParams={searchParams} />
      </Suspense>
      <p className="text-sm">
        <Link href="/login" className={link}>
          Sign in with a password instead
        </Link>
      </p>
    </AuthShell>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection();
  if (!ssoEnabled()) notFound();
  const next = safeNext((await searchParams).next);
  return <CompanySignInForm next={next === "/" ? "" : next} />;
}
