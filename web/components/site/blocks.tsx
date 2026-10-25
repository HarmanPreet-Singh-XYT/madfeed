import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/site";
import { btn, btnPrimary, card } from "@/components/ui";

/** A page's width and top spacing, and its one h1. */
export function Page({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-12">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        {lead ? <p className="text-lg text-muted">{lead}</p> : null}
      </div>
      {children}
    </div>
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
      className="space-y-3"
    >
      <h2 id={id ? `${id}-h` : undefined} className="text-2xl font-semibold">
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
        <li key={i.title} className={`${card} space-y-2`}>
          <h3 className="font-semibold">{i.title}</h3>
          <div className="text-sm text-muted">{i.body}</div>
        </li>
      ))}
    </ul>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-6">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
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
  return (
    <section
      aria-label="Get started"
      className="rounded-lg border border-border bg-surface p-8 text-center"
    >
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">{text}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/signup" className={btnPrimary}>
          Get started
        </Link>
        <Link href="/docs/getting-started" className={btn}>
          Read the quick start
        </Link>
      </div>
    </section>
  );
}

/** Shown on the legal pages until a lawyer has read them. */
export function DraftNotice() {
  if (SITE.legalReviewed) return null;
  return (
    <p
      role="note"
      className="rounded-md border border-border bg-surface px-4 py-3 text-sm"
    >
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
  return <p className="text-sm text-muted">Last updated {SITE.updated}.</p>;
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
