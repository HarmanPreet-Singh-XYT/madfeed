import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { GRADIENT } from "@/components/site/landing";

// The page around every sign-in style form: the form on one side, and on wide screens a panel that says what the
// person is about to get. Nothing here changes how the forms work; it only wraps them.
export function AuthShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main" className="grid min-h-svh flex-1 md:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <Link
          href="/"
          className="w-fit font-display text-xl font-bold tracking-tight"
        >
          {SITE.name}
        </Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center space-y-6 py-10">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to home
          </Link>
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-bold tracking-tight text-balance">
              {title}
            </h1>
            {lead ? <p className="text-muted-foreground">{lead}</p> : null}
          </div>
          {children}
        </div>
        <p className="text-xs text-muted-foreground">
          <Link
            href="/privacy"
            className="underline underline-offset-4 hover:no-underline"
          >
            Privacy
          </Link>
          <span aria-hidden="true"> · </span>
          <Link
            href="/terms"
            className="underline underline-offset-4 hover:no-underline"
          >
            Terms
          </Link>
        </p>
      </div>

      <aside
        aria-label="What you get"
        className={cn(
          "relative hidden flex-col justify-center overflow-hidden p-12 text-on-brand md:flex",
          GRADIENT,
        )}
      >
        <div
          aria-hidden="true"
          className="drift absolute -top-24 -right-24 size-96 rounded-full bg-hue-sky/45 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="drift absolute -bottom-24 -left-24 size-96 rounded-full bg-hue-teal/55 blur-3xl"
        />
        <div className="relative mx-auto w-full max-w-md space-y-8">
          <p className="font-display text-3xl leading-tight font-extrabold tracking-tight text-balance">
            Know what your customers are asking for, and prove it.
          </p>
          <ul className="space-y-3 text-on-brand/90">
            {[
              "Paste one conversation and see cited requests in minutes",
              "Nothing is sent to a customer without your approval",
              "Export or delete your data any time",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-sun"
                />
                {t}
              </li>
            ))}
          </ul>
          <div className="space-y-3 rounded-3xl bg-card p-5 text-card-foreground shadow-raised">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Call with Priya · sample</span>
              <span className="flex items-center gap-1 rounded-full bg-tint-teal px-2.5 py-0.5 text-foreground">
                <ShieldCheck
                  aria-hidden="true"
                  className="size-3 text-hue-teal"
                />
                Verbatim
              </span>
            </div>
            <p className="text-sm leading-relaxed">
              “We rebuild this report in a spreadsheet every Monday.{" "}
              <span className="rounded-sm bg-mark px-0.5 text-ink">
                If I could just export it, that is two hours back.
              </span>
              ”
            </p>
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              Request found:{" "}
              <span className="font-semibold text-foreground">
                Export any table to CSV
              </span>
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}
