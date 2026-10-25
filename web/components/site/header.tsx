import Link from "next/link";
import { NAV, SITE } from "@/lib/site";
import { btn, btnPrimary } from "@/components/ui";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-lg font-semibold"
        >
          {SITE.name}
        </Link>
        <nav
          aria-label="Main"
          className="order-last w-full md:order-none md:w-auto"
        >
          <ul className="flex flex-wrap gap-x-1 gap-y-0">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-muted"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className={btn}>
            Sign in
          </Link>
          <Link href="/signup" className={btnPrimary}>
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
