import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { connection } from "next/server";
import { PasswordSignInForm } from "@/components/password-sign-in-form";
import { SignInForm } from "@/components/sign-in-form";
import { Loading } from "@/components/loading";
import { devAuthEnabled } from "@/lib/server/dev-auth";
import { supabaseConfigured } from "@/lib/server/supabase-auth";
import { ssoEnabled, ssoProviders } from "@/lib/server/sso";
import { startProviderSignIn } from "@/app/login/sso/actions";
import { KNOWN_PROVIDERS } from "@/lib/sso";
import Link from "next/link";
import { btn, link } from "@/components/ui";
import { safeNext } from "@/lib/next-path";

export const metadata = { title: "Sign in" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sso?: string }>;
}) {
  return (
    <AuthShell title="Sign in">
      <Suspense fallback={<Loading />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

// Which form to show depends on the running server's settings, so it is
// decided per request, never frozen into the build. The development sign-in
// only exists when explicitly switched on (and never in production).
async function Form({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sso?: string }>;
}) {
  await connection();
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const hidden = next === "/" ? "" : next;
  if (devAuthEnabled()) return <SignInForm next={hidden} />;
  if (supabaseConfigured())
    return (
      <>
        {sp.sso === "failed" ? (
          <p role="alert" className="text-sm text-destructive">
            We couldn&apos;t finish signing you in with your company account.
            Please try again.
          </p>
        ) : null}
        <PasswordSignInForm next={hidden} />
        {ssoEnabled() ? (
          <section
            aria-labelledby="company-heading"
            className="space-y-3 border-t border-border pt-4"
          >
            <h2 id="company-heading" className="text-base font-medium">
              Or sign in with your company
            </h2>
            <p className="text-sm">
              <Link
                href={hidden ? `/login/sso?next=${encodeURIComponent(hidden)}` : "/login/sso"}
                className={link}
              >
                Use my work email address
              </Link>
            </p>
            {ssoProviders().map((p) => (
              <form key={p} action={startProviderSignIn}>
                <input type="hidden" name="provider" value={p} />
                <input type="hidden" name="next" value={hidden} />
                <button type="submit" className={btn}>
                  Continue with {KNOWN_PROVIDERS[p]}
                </button>
              </form>
            ))}
          </section>
        ) : null}
      </>
    );
  return (
    <p className="text-muted-foreground">
      Sign-in isn&apos;t available yet. Please check back soon.
    </p>
  );
}
