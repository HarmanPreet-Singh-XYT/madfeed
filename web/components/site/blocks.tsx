import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { CtaCard, PageHero, PlainHero } from "@/components/site/page-kit";

/**
 * A page's hero and width, and its one h1. Marketing pages ask for the gradient hero (tone="brand");
 * reading pages (legal, docs) keep the quiet one.
 */
export function Page({
  title,
  lead,
  eyebrow,
  tone = "plain",
  children,
}: {
  title: string;
  lead?: ReactNode;
  eyebrow?: string;
  tone?: "brand" | "plain";
  children: ReactNode;
}) {
  return (
    <>
      {tone === "brand" ? (
        <PageHero eyebrow={eyebrow} title={title} lead={lead} />
      ) : (
        <PlainHero title={title} lead={lead} />
      )}
      <div className="mx-auto w-full max-w-4xl space-y-10 px-4 py-12 sm:py-16">
        {children}
      </div>
    </>
  );
}

export function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      aria-labelledby={id ? `${id}-h` : undefined}
      id={id}
      className="scroll-mt-28 space-y-4 rounded-3xl bg-card p-6 shadow-card sm:p-8"
    >
      <h2
        id={id ? `${id}-h` : undefined}
        className="font-display text-2xl font-bold tracking-tight"
      >
        {title}
      </h2>
      <div className="space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export function Cards({
  items,
}: {
  items: { title: string; body: ReactNode }[];
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <li
          key={i.title}
          className="space-y-2 rounded-3xl bg-card p-6 shadow-card"
        >
          <h3 className="font-display font-semibold">{i.title}</h3>
          <div className="text-sm text-muted-foreground">{i.body}</div>
        </li>
      ))}
    </ul>
  );
}

export function Bullets({
  items,
  className,
}: {
  items: ReactNode[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5">
          <Check
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-link"
          />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function CallToAction({
  title = "See it with your own conversations",
  text = "Paste a customer conversation and get cited requests in minutes. No setup first.",
}: {
  title?: string;
  text?: string;
}) {
  return <CtaCard title={title} text={text} />;
}

/** Shown on the legal pages until a lawyer has read them. */
export function DraftNotice() {
  if (SITE.legalReviewed) return null;
  return (
    <p role="note" className="rounded-2xl bg-tint-amber px-4 py-3 text-sm">
      <strong>Draft.</strong> This text describes what the service does today
      and has not yet been reviewed by a lawyer. Names, addresses and anything
      in [square brackets] are filled in before launch.
    </p>
  );
}

export function Fact({ value, fallback }: { value: string; fallback: string }) {
  return value ? <>{value}</> : <>[{fallback}]</>;
}

export function Updated() {
  return (
    <p className="text-sm text-muted-foreground">
      Last updated {SITE.updated}.
    </p>
  );
}

/** A wide table that scrolls sideways on a phone, reachable and scrollable from the keyboard. */
export function ScrollBox({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto"
    >
      {children}
    </div>
  );
}
