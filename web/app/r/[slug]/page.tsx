import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicReleases } from "@/lib/server/public";
import { Loading } from "@/components/loading";
import { Paragraphs } from "@/components/paragraphs";
import { link } from "@/components/ui";
import { PublicBody, PublicHero } from "@/components/app/public-hero";
import { Rss, Search } from "lucide-react";
import { NoteKind } from "@/components/note-status";
import { plural } from "@/lib/format";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `What's new · ${slug}` };
}

export default function PublicReleases(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Page {...props} />
    </Suspense>
  );
}

async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const data = await getPublicReleases(slug);
  if (!data) notFound();
  const { workspaceName, notes } = data;
  const q = (sp.q ?? "").slice(0, 100).trim();
  const needle = q.toLowerCase();
  const shown = needle
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(needle) ||
          n.body.toLowerCase().includes(needle),
      )
    : notes;

  return (
    <>
      <PublicHero
        eyebrow="What's new"
        title={<>What&apos;s new at {workspaceName}</>}
      >
        <p>Recent changes and improvements.</p>
      </PublicHero>
      <PublicBody>
        {notes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <form role="search" method="get" className="relative min-w-48 flex-1">
              <label htmlFor="public-q" className="sr-only">
                Search updates
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id="public-q"
                name="q"
                defaultValue={q}
                maxLength={100}
                placeholder="Search updates"
                className="h-9 w-full rounded-lg border border-input bg-card pr-3 pl-8 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              />
            </form>
            <a
              href={`/r/${slug}/feed.xml`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <Rss aria-hidden="true" className="size-3.5" />
              RSS
            </a>
          </div>
        ) : null}

        {q && shown.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing matches “{q}”.{" "}
            <Link href={`/r/${slug}`} className={link}>
              Show everything
            </Link>
          </p>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing has been published yet.
          </p>
        ) : (
          <>
            {q ? (
              <p className="text-sm text-muted-foreground">
                {plural(shown.length, "update")} matching “{q}”
              </p>
            ) : null}
            <ol className="space-y-12">
              {shown.map((n) => (
                <li key={n.id} id={n.id} className="scroll-mt-6 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={n.publishedAt}>
                      {new Date(n.publishedAt).toISOString().slice(0, 10)}
                    </time>
                  </p>
                  <div className="flex gap-4">
                    {n.coverUpdatedAt ? (
                      <img
                        src={`/r/${slug}/${n.id}/cover?v=${encodeURIComponent(n.coverUpdatedAt)}`}
                        alt=""
                        className="h-16 w-24 shrink-0 rounded-lg border border-border object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <NoteKind type={n.type} />
                        <h2 className="font-display text-xl font-semibold text-balance">
                          <Link
                            href={`/r/${slug}/${n.id}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {n.title}
                          </Link>
                        </h2>
                      </div>
                      <Paragraphs text={n.body} />
                    </div>
                  </div>
                  <p className="text-sm">
                    <Link href={`/r/${slug}/${n.id}`} className={link}>
                      Link to this note
                    </Link>
                  </p>
                </li>
              ))}
            </ol>
          </>
        )}
      </PublicBody>
    </>
  );
}
