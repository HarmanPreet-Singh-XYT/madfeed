import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GRADIENT, Wave } from "@/components/site/landing";

// Shared building blocks for the inner marketing pages, so they look like one product with the front page.

export const sunButton =
  "h-12 rounded-xl bg-sun px-7 text-base font-bold text-ink shadow-raised transition-[translate,background-color] hover:-translate-y-0.5 hover:bg-sun/90";
export const ghostButton =
  "h-12 rounded-xl border border-on-brand/40 bg-on-brand/10 px-7 text-base font-semibold text-on-brand shadow-none backdrop-blur transition-[translate,background-color] hover:-translate-y-0.5 hover:bg-on-brand/20";

/** The gradient band at the top of a marketing page: one h1, a lead, and the actions. */
export function PageHero({
  eyebrow,
  title,
  lead,
  actions,
  ticks,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  ticks?: string[];
}) {
  return (
    <section
      aria-labelledby="page-h"
      className={cn(
        "relative overflow-hidden px-4 pt-14 pb-24 sm:pt-20 sm:pb-32",
        GRADIENT,
      )}
    >
      <div
        aria-hidden="true"
        className="drift absolute -top-32 -left-32 size-[26rem] rounded-full bg-hue-sky/45 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="drift absolute top-24 -right-32 size-[26rem] rounded-full bg-hue-teal/55 blur-3xl"
      />
      <div className="relative mx-auto max-w-4xl space-y-6 text-center text-on-brand">
        {eyebrow ? (
          <p className="inline-flex rounded-full bg-on-brand/15 px-4 py-1.5 text-xs font-semibold tracking-wider uppercase backdrop-blur">
            {eyebrow}
          </p>
        ) : null}
        <h1
          id="page-h"
          className="text-fade font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-6xl"
        >
          {title}
        </h1>
        {lead ? (
          <p className="mx-auto max-w-2xl text-lg text-pretty text-on-brand/90 sm:text-xl">
            {lead}
          </p>
        ) : null}
        {actions ? (
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            {actions}
          </div>
        ) : null}
        {ticks ? (
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-on-brand/90">
            {ticks.map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check aria-hidden="true" className="size-4 text-sun" />
                {t}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Wave />
    </section>
  );
}

/** The quiet header for reading pages (legal, docs): a tinted band, no gradient. */
export function PlainHero({
  title,
  lead,
}: {
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <header
      aria-labelledby="page-h"
      className="border-b border-border bg-tint-blue px-4 py-12 sm:py-16"
    >
      <div className="mx-auto max-w-4xl space-y-3">
        <h1
          id="page-h"
          className="font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl"
        >
          {title}
        </h1>
        {lead ? (
          <p className="text-lg text-pretty text-muted-foreground">{lead}</p>
        ) : null}
      </div>
    </header>
  );
}

/** A dark inset card that asks once, clearly. */
export function CtaCard({
  title = "See it with your own conversations",
  text = "Paste a customer conversation and get cited requests in minutes. No setup first.",
  primary = { href: "/signup", label: "Start free" },
  secondary = { href: "/docs/getting-started", label: "Read the quick start" },
  className,
}: {
  title?: string;
  text?: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string } | null;
  className?: string;
}) {
  return (
    <section
      aria-label="Get started"
      className={cn(
        "relative overflow-hidden rounded-[2rem] bg-ink p-8 text-on-brand sm:p-12",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute -top-24 -right-16 size-72 rounded-full bg-hue-teal/40 blur-3xl"
      />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl space-y-2">
          <h2 className="font-display text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
            {title}
          </h2>
          <p className="text-on-brand/75">{text}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className={sunButton}>
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
          {secondary ? (
            <Button asChild size="lg" className={ghostButton}>
              <Link href={secondary.href}>
                {secondary.label} <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
