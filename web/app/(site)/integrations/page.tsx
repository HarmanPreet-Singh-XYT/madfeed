import type { Metadata } from "next";
import Link from "next/link";
import { CallToAction, Page, Section } from "@/components/site/blocks";
import {
  INTEGRATION_GROUPS,
  STATUS_LABEL,
  type Availability,
} from "@/lib/site-data";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "What connects to the platform today, what is coming next, and what is planned: feedback sources, issue trackers, CRMs, webhooks, an API and AI assistants.",
};

// Colour is never the only signal: the label is always written out.
const BADGE: Record<Availability, string> = {
  available: "border-border bg-muted",
  soon: "border-border",
  planned: "border-dashed border-border text-muted-foreground",
};

export default function Integrations() {
  return (
    <Page
      title="Integrations"
      lead="Bring feedback in from where it happens, send work to where it is done, and keep your customers' value in view. Here is what works today, what is on its way, and what is planned."
    >
      <p className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
        <strong>How to read the labels.</strong> <em>Available</em> works for
        everyone now. <em>Coming soon</em> is built and tested and is switched
        on as soon as it has been tried against the real service.{" "}
        <em>Planned</em> is not built yet. Anything that can send a web request
        already works through the inbound endpoint.
      </p>
      {INTEGRATION_GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.intro ? <p className="text-muted-foreground">{g.intro}</p> : null}
          <ul className="grid gap-3 sm:grid-cols-2">
            {g.items.map((i) => (
              <li
                key={i.name}
                className={`space-y-1 rounded-lg border p-4 ${BADGE[i.status]}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{i.name}</h3>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {STATUS_LABEL[i.status]}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{i.what}</p>
              </li>
            ))}
          </ul>
        </Section>
      ))}
      <Section title="Need one that is not here?">
        <p>
          Tell us
          {SITE.contactEmail ? (
            <>
              {" "}
              at{" "}
              <a
                className="text-link underline underline-offset-2"
                href={`mailto:${SITE.contactEmail}`}
              >
                {SITE.contactEmail}
              </a>
            </>
          ) : (
            <> through the contact page</>
          )}
          . The planned list is ordered by what people ask for. If your tool can
          send a web request or a file, it can probably work today; the{" "}
          <Link
            className="text-link underline underline-offset-2"
            href="/docs/sending-feedback"
          >
            sending-feedback guide
          </Link>{" "}
          shows how.
        </p>
      </Section>
      <CallToAction />
    </Page>
  );
}
