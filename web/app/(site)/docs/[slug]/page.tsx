import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Loading } from "@/components/loading";
import { DOCS, docBySlug } from "@/lib/docs-content";

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const d = docBySlug((await params).slug);
  return d ? { title: d.title, description: d.summary } : {};
}

type Props = { params: Promise<{ slug: string }> };

// The page's shell does not depend on which guide it is, so reading the address happens inside the boundary.
export default function DocPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Doc params={params} />
    </Suspense>
  );
}

async function Doc({ params }: Props) {
  const doc = docBySlug((await params).slug);
  if (!doc) notFound();
  const i = DOCS.findIndex((d) => d.slug === doc.slug);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 md:grid-cols-[14rem_1fr]">
      <nav
        aria-label="Documentation"
        className="md:sticky md:top-4 md:self-start"
      >
        <p className="mb-2 text-sm font-semibold">
          <Link href="/docs" className="hover:underline">
            Documentation
          </Link>
        </p>
        <ul className="space-y-0.5">
          {DOCS.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/docs/${d.slug}`}
                aria-current={d.slug === doc.slug ? "page" : undefined}
                className={`inline-flex min-h-9 w-full items-center rounded-md px-2 text-sm hover:bg-muted ${d.slug === doc.slug ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="min-w-0 space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="text-lg text-muted-foreground">{doc.summary}</p>
        {doc.body}
        <nav
          aria-label="More guides"
          className="flex justify-between gap-4 border-t border-border pt-4 text-sm"
        >
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="text-link underline underline-offset-2 hover:no-underline"
            >
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="text-link underline underline-offset-2 hover:no-underline"
            >
              {next.title} →
            </Link>
          ) : null}
        </nav>
      </article>
    </div>
  );
}
