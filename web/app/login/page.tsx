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
import { Button } from "@/components/ui/button";
import { safeNext } from "@/lib/next-path";
import { Building2, KeyRound } from "lucide-react";

export const metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sso?: string }>;
}) {
  return (
    <AuthShell
      title="Sign in"
      lead="Welcome back. Sign in to pick up where you left off."
    >
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
          <>
            <div className="flex items-center gap-3 py-1">
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                or
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <section
              aria-labelledby="company-heading"
              className="space-y-2"
            >
              <h2 id="company-heading" className="text-sm font-medium">
                Sign in with your company
              </h2>
              <p className="text-sm text-muted-foreground">
                We&apos;ll take you to your company&apos;s own sign-in page and
                bring you back.
              </p>
              <Button asChild variant="outline" className="w-full justify-start gap-2">
                <Link
                  href={
                    hidden
                      ? `/login/sso?next=${encodeURIComponent(hidden)}`
                      : "/login/sso"
                  }
                >
                  <Building2 aria-hidden="true" /> Use my work email
                </Link>
              </Button>
              {ssoProviders().map((p) => (
                <form key={p} action={startProviderSignIn}>
                  <input type="hidden" name="provider" value={p} />
                  <input type="hidden" name="next" value={hidden} />
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full justify-start gap-2"
                  >
                    <KeyRound aria-hidden="true" /> Continue with{" "}
                    {KNOWN_PROVIDERS[p]}
                  </Button>
                </form>
              ))}
            </section>
          </>
        ) : null}
      </>
    );
  return (
    <p className="text-muted-foreground">
      Sign-in isn&apos;t available yet. Please check back soon.
    </p>
  );
}
