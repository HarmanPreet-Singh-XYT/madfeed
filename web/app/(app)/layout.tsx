import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { SubmitButton } from "@/components/submit-button";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-semibold"
          >
            Feedback
          </Link>
          <form action={signOut}>
            <SubmitButton variant="plain" pendingLabel="Signing out…">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </>
  );
}
