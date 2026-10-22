import { SignInForm } from "@/components/sign-in-form";
import { devAuthEnabled } from "@/lib/server/dev-auth";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {devAuthEnabled() ? (
        <SignInForm />
      ) : (
        <p className="text-muted">
          Sign-in isn&apos;t available yet. Please check back soon.
        </p>
      )}
    </main>
  );
}
