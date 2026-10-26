import Link from "next/link";
import { link } from "@/components/ui";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-3 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">
        This page could not be found.
      </h1>
      <p className="text-muted-foreground">
        The address may be wrong, or the page may have been removed or turned
        off.
      </p>
      <Link href="/" className={link}>
        Go to the home page
      </Link>
    </main>
  );
}
