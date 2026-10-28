import Link from "next/link";
import type { ReactNode } from "react";
import { AccountFooter } from "@/components/app/account-footer";

/** A plain frame for screens that sit outside a workspace: the workspace picker, and errors with no workspace. */
export function StandaloneFrame({
  children,
  width = "max-w-4xl",
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <div data-app className="flex min-h-svh flex-col bg-muted/40">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-display text-lg font-bold tracking-tight"
          >
            Feedback
          </Link>
          <AccountFooter />
        </div>
      </header>
      <main id="main" className={`mx-auto w-full flex-1 px-4 py-10 ${width}`}>
        {children}
      </main>
    </div>
  );
}
