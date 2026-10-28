import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SITE } from "@/lib/site";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/integrations", label: "Integrations" },
      { href: "/pricing", label: "Pricing" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs/api", label: "API" },
      { href: "/docs/assistants", label: "AI assistants (MCP)" },
      { href: "/faq", label: "FAQ" },
      { href: "/community", label: "Community" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms and conditions" },
      { href: "/cookies", label: "Cookies" },
      { href: "/subprocessors", label: "Subprocessors" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-ink text-on-brand">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 border-b border-on-brand/15 px-4 py-10 sm:flex-row sm:items-center">
        <p className="font-display text-2xl font-bold tracking-tight text-balance">
          Paste one conversation. See cited requests.
        </p>
        <Link
          href="/signup"
          className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-sun px-6 font-bold text-ink transition-[translate] hover:-translate-y-0.5"
        >
          Start free <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 md:grid-cols-5">
        <div className="space-y-2 md:col-span-1">
          <p className="font-display text-xl font-bold">{SITE.name}</p>
          <p className="text-sm text-on-brand/70">
            Turn customer conversations into cited, prioritised requests, and
            tell the people who asked what happened.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title} className="space-y-2">
            <h2 className="font-display text-sm font-semibold">{c.title}</h2>
            <ul className="space-y-1">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-flex min-h-8 items-center text-sm text-on-brand/70 underline-offset-2 hover:text-on-brand hover:underline"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-on-brand/15">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 text-sm text-on-brand/70">
          © {SITE.updated.slice(0, 4)} {SITE.legalName || SITE.name}. All rights
          reserved.
        </p>
      </div>
      <p
        aria-hidden="true"
        data-text={SITE.name}
        className="pointer-events-none -mb-[0.18em] select-none overflow-hidden px-4 text-center font-display text-[clamp(4rem,19vw,16rem)] leading-none font-extrabold tracking-tighter text-on-brand/[0.06] before:content-[attr(data-text)]"
      />
    </footer>
  );
}
