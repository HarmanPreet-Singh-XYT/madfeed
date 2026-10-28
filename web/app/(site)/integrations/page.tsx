import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { INTEGRATION_GROUPS, STATUS_LABEL, type Availability } from "@/lib/site-data";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/site/landing";
import { CtaCard, PageHero, ghostButton, sunButton } from "@/components/site/page-kit";
import { CodeTabs } from "@/components/site/code-tabs";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "What connects to the platform today, what is coming next, and what is planned: feedback sources, issue trackers, CRMs, webhooks, an API and AI assistants.",
};

// Colour is never the only signal: the label is always written out.
const CHIP: Record<Availability, string> = {
  available: "bg-tint-teal text-foreground",
  soon: "bg-tint-sky text-foreground",
  planned: "border border-dashed border-input text-muted-foreground",
};
const HUES = ["bg-hue-blue", "bg-hue-teal", "bg-hue-amber", "bg-hue-coral", "bg-hue-sky"];

export default function Integrations() {
  const counts = INTEGRATION_GROUPS.flatMap((g) => g.items).reduce(
    (a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }),
    {} as Record<Availability, number>,
  );
  let n = 0;
  return (
    <>
      <PageHero
        eyebrow="Integrations"
        title="Fits the tools you already use"
        lead="Bring feedback in from where it happens, send work to where it is done, and keep your customers' value in view."
        actions={
          <>
            <Button asChild size="lg" className={sunButton}>
              <Link href="/signup">Start free</Link>
            </Button>
            <Button asChild size="lg" className={ghostButton}>
              <a href="#web-request">
                Build your own <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </>
        }
        ticks={[
          `${counts.available ?? 0} available now`,
          `${counts.soon ?? 0} built and coming soon`,
          "Anything that can send a web request already works",
        ]}
      />

      <div className="mx-auto w-full max-w-6xl space-y-14 px-4 py-12 sm:py-16">
        <div
          role="note"
          className="reveal rounded-3xl bg-tint-blue p-6 text-sm sm:p-8"
        >
          <p className="font-display text-base font-bold">How to read the labels</p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {(["available", "soon", "planned"] as Availability[]).map((s) => (
              <li key={s} className="space-y-1">
                <span className={cn("inline-block rounded-full px-3 py-0.5 text-xs font-semibold", CHIP[s])}>
                  {STATUS_LABEL[s]}
                </span>
                <p className="text-muted-foreground">
                  {s === "available"
                    ? "Works for everyone now."
                    : s === "soon"
                      ? "Built and tested, switched on as soon as it has been tried against the real service."
                      : "Not built yet."}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {INTEGRATION_GROUPS.map((g, gi) => (
          <section key={g.title} aria-labelledby={`g${gi}-h`} className="space-y-5">
            <div className="max-w-2xl space-y-1.5">
              <h2 id={`g${gi}-h`} className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {g.title}
              </h2>
              {g.intro ? <p className="text-muted-foreground">{g.intro}</p> : null}
            </div>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((i, k) => {
                const hue = HUES[n++ % HUES.length];
                return (
                  <li
                    key={i.name}
                    style={{ "--i": k % 3 } as React.CSSProperties}
                    className="reveal group flex gap-4 rounded-3xl bg-card p-5 shadow-card transition-[translate,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-raised"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl font-display text-lg font-bold text-on-brand",
                        hue,
                        i.status === "planned" && "opacity-50",
                      )}
                    >
                      {i.name[0]}
                    </span>
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display font-semibold">{i.name}</h3>
                        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", CHIP[i.status])}>
                          {STATUS_LABEL[i.status]}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{i.what}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <section
          id="web-request"
          aria-labelledby="web-h"
          className="reveal scroll-mt-28 grid grid-cols-1 items-center gap-8 rounded-[2rem] bg-tint-amber p-6 sm:p-12 lg:grid-cols-2 lg:gap-14"
        >
          <div className="space-y-4">
            <p className="text-xs font-semibold tracking-widest text-link uppercase">Not on the list?</p>
            <h2 id="web-h" className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              If it can send a web request, it already works
            </h2>
            <p className="text-lg text-muted-foreground">
              Help desks, form tools, automation services and call-recording tools post notes and transcripts through
              one endpoint, and a retry never stores one twice.
            </p>
            <p className="flex flex-wrap gap-x-6 gap-y-2">
              <TextLink href="/docs/sending-feedback">Sending-feedback guide</TextLink>
              <TextLink href="/docs/api">API reference</TextLink>
            </p>
          </div>
          <div className="min-w-0">
            <CodeTabs />
          </div>
        </section>

        <CtaCard
          title="Need one that is not here?"
          text={`The planned list is ordered by what people ask for, so asking genuinely moves things. ${
            SITE.contactEmail ? "Write to us or use the contact page." : "Tell us through the contact page."
          }`}
          primary={{ href: "/contact", label: "Request an integration" }}
          secondary={{ href: "/signup", label: "Start free" }}
        />
      </div>
    </>
  );
}
