import type { Metadata } from "next";
import Link from "next/link";
import { CallToAction, Page } from "@/components/site/blocks";
import { FAQS } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about trust, privacy, AI, integrations, deleting data, assistants and cost.",
};

export default function Faq() {
  return (
    <Page
      title="Frequently asked questions"
      lead="Short, direct answers. If yours is not here, ask us."
    >
      <div className="divide-y divide-border rounded-lg border border-border">
        {FAQS.map((f) => (
          <details key={f.q} className="group p-4">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 font-medium">
              {f.q}
            </summary>
            <p className="mt-2 leading-relaxed text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
      <p>
        Still stuck? Read the{" "}
        <Link
          href="/docs"
          className="text-link underline underline-offset-2 hover:no-underline"
        >
          documentation
        </Link>{" "}
        or{" "}
        <Link
          href="/contact"
          className="text-link underline underline-offset-2 hover:no-underline"
        >
          contact us
        </Link>
        .
      </p>
      <CallToAction />
    </Page>
  );
}
