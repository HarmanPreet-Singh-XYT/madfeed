import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { SITE } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { DesktopNav, MobileNav } from "@/components/site/site-nav";

/** One honest line above the header. It scrolls away; the header below stays. */
export function AnnouncementBar() {
  return (
    <div className="bg-ink px-4 py-2 text-center text-sm text-on-brand">
      <Link href="/features" className="group inline-flex flex-wrap items-center justify-center gap-x-2">
        <Sparkles aria-hidden="true" className="size-4 text-sun" />
        <span>Ask your quotes anything. It cites, or it refuses.</span>
        <span className="inline-flex items-center gap-1 font-semibold underline underline-offset-4 group-hover:no-underline">
          See how
          <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-x-4 px-4 py-2">
        <Link href="/" className="inline-flex min-h-11 items-center font-display text-xl font-bold tracking-tight">
          {SITE.name}
        </Link>
        <DesktopNav />
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="lg" className="hidden md:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" className="rounded-lg px-4">
            <Link href="/signup">Get started</Link>
          </Button>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
