import Link from "next/link";
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
    <footer className="border-t border-border">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 md:grid-cols-5">
        <div className="space-y-2 md:col-span-1">
          <p className="font-semibold">{SITE.name}</p>
          <p className="text-sm text-muted-foreground">
            Turn customer conversations into cited, prioritised requests, and
            tell the people who asked what happened.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title} className="space-y-2">
            <h2 className="text-sm font-semibold">{c.title}</h2>
            <ul className="space-y-1">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-flex min-h-8 items-center text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto w-full max-w-6xl px-4 py-4 text-sm text-muted-foreground">
          © {SITE.updated.slice(0, 4)} {SITE.legalName || SITE.name}. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
}
