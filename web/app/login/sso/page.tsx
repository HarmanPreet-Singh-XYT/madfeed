import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CompanySignInForm } from "@/components/company-sign-in-form";
import { Loading } from "@/components/loading";
import { ssoEnabled } from "@/lib/server/sso";
import { safeNext } from "@/lib/next-path";
import { link } from "@/components/ui";

export const metadata = { title: "Sign in with your company" };

export default function CompanySignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Sign in with your company</h1>
      <Suspense fallback={<Loading />}>
        <Form searchParams={searchParams} />
      </Suspense>
      <p className="text-sm">
        <Link href="/login" className={link}>
          Sign in with a password instead
        </Link>
      </p>
    </main>
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
