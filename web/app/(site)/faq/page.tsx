import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, MessageCircleQuestion } from "lucide-react";
import { FAQS } from "@/lib/site-data";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/site/landing";
import { PageHero } from "@/components/site/page-kit";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about trust, privacy, AI, integrations, deleting data, assistants and cost.",
};

export default function Faq() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Short, direct answers"
        lead="What it does, whether you can trust it, who sees your data, and what it costs."
      />
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1fr_20rem] lg:gap-14">
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <details
              key={f.q}
              style={{ "--i": i % 4 } as React.CSSProperties}
              className="reveal group rounded-2xl bg-card p-5 shadow-card transition-colors open:bg-tint-blue"
            >
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 font-display font-semibold">
                {f.q}
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-link transition-transform duration-300 group-open:rotate-180"
                />
              </summary>
              <p className="mt-2 leading-relaxed text-muted-foreground">
                {f.a}
              </p>
            </details>
          ))}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4 rounded-3xl bg-ink p-7 text-on-brand shadow-raised">
            <MessageCircleQuestion
              aria-hidden="true"
              className="size-8 text-sun"
            />
            <h2 className="font-display text-2xl font-bold tracking-tight">
              Easier to see than to read
            </h2>
            <p className="text-sm text-on-brand/75">
              Paste one conversation and watch it become cited requests. It
              takes a few minutes and needs no setup.
            </p>
            <Button
              asChild
              size="lg"
              className="h-12 w-full rounded-xl bg-sun text-base font-bold text-ink shadow-raised hover:bg-sun/90"
            >
              <Link href="/signup">Start free</Link>
            </Button>
            <p className="text-sm text-on-brand/75">
              Still stuck? Read the{" "}
              <Link
                href="/docs"
                className="font-semibold text-on-brand underline underline-offset-4 hover:no-underline"
              >
                documentation
              </Link>{" "}
              or{" "}
              <Link
                href="/contact"
                className="font-semibold text-on-brand underline underline-offset-4 hover:no-underline"
              >
                contact us
              </Link>
              .
            </p>
          </div>
          <p className="mt-4 text-sm">
            <TextLink href="/pricing">See what each plan includes</TextLink>
          </p>
        </aside>
      </div>
    </>
  );
}
