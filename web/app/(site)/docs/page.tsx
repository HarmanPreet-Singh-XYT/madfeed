import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/site/blocks";
import { DOCS } from "@/lib/docs-content";
import { Card } from "@/components/ui/card";

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
          <Card key={d.slug} asChild className="[--card-spacing:0px] p-5">
            <li className="space-y-1">
              <h2 className="font-semibold">
                <Link
                  href={`/docs/${d.slug}`}
                  className="text-link underline underline-offset-2 hover:no-underline"
                >
                  {d.title}
                </Link>
              </h2>
              <p className="text-sm text-muted-foreground">{d.summary}</p>
            </li>
          </Card>
        ))}
      </ul>
    </Page>
  );
}
