import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/site/blocks";
import { DOCS } from "@/lib/docs-content";
import { card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Guides for getting started, sending feedback in, reviewing, closing the loop, surveys, the API, webhooks and AI assistants.",
};

export default function DocsIndex() {
  return (
    <Page
      title="Documentation"
      lead="Start with the quick start, then read what you need."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {DOCS.map((d) => (
          <li key={d.slug} className={`${card} space-y-1`}>
            <h2 className="font-semibold">
              <Link
                href={`/docs/${d.slug}`}
                className="text-accent underline underline-offset-2 hover:no-underline"
              >
                {d.title}
              </Link>
            </h2>
            <p className="text-sm text-muted">{d.summary}</p>
          </li>
        ))}
      </ul>
    </Page>
  );
}
