import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicNote, getPublicReleases } from "@/lib/server/public";
import { Loading } from "@/components/loading";
import { Paragraphs } from "@/components/paragraphs";
import { link } from "@/components/ui";
import { PublicBody, PublicHero } from "@/components/app/public-hero";
import { isUuid } from "@/lib/text";
import { NOTE_KIND_LABEL } from "@/components/note-status";
import { PublicNoteActions } from "@/components/public-note-actions";

type Props = { params: Promise<{ slug: string; noteId: string }> };

/** A date people read, not an ISO string. The locale is fixed so the server and a share preview agree. */
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export async function generateMetadata({ params }: Props) {
  const { slug, noteId } = await params;
  if (!isUuid(noteId)) return { title: "Not found" };
  const data = await getPublicNote(slug, noteId);
  if (!data) return { title: "Not found" };
  const description = data.note.body.replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    title: `${data.note.title} · ${data.workspaceName}`,
    description: description || undefined,
    openGraph: {
      type: "article",
      title: data.note.title,
      description: description || undefined,
      publishedTime: data.note.publishedAt,
    },
  };
}

export default function PublicNote(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Page {...props} />
    </Suspense>
  );
}

async function Page({ params }: Props) {
  const { slug, noteId } = await params;
  if (!isUuid(noteId)) notFound();
  const [data, page] = await Promise.all([
    getPublicNote(slug, noteId),
    getPublicReleases(slug),
  ]);
  if (!data) notFound();
  const { note, workspaceName } = data;
  // Neighbours for a reader who wants the next change without going back to the list.
  const notes = page?.notes ?? [];
  const at = notes.findIndex((n) => n.id === note.id);
  const newer = at > 0 ? notes[at - 1] : undefined;
  const older = at >= 0 && at < notes.length - 1 ? notes[at + 1] : undefined;
  return (
    <>
      <PublicHero eyebrow="Release note" title={note.title}>
        <p className="text-sm">
          {NOTE_KIND_LABEL[note.type] ? `${NOTE_KIND_LABEL[note.type]} · ` : ""}
          <time dateTime={note.publishedAt}>{longDate(note.publishedAt)}</time>
        </p>
      </PublicHero>
      <PublicBody>
        <article className="space-y-6">
          <p>
            <Link href={`/r/${slug}`} className={link}>
              ← What&apos;s new at {workspaceName}
            </Link>
          </p>
          {note.coverUpdatedAt ? (
            <img
              src={`/r/${slug}/${note.id}/cover?v=${encodeURIComponent(note.coverUpdatedAt)}`}
              alt=""
              className="aspect-[2/1] w-full rounded-xl border border-border object-cover"
            />
          ) : null}
          <Paragraphs text={note.body} />
          <PublicNoteActions slug={slug} />
          {newer || older ? (
            <nav
              aria-label="More updates"
              className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
            >
              {newer ? (
                <Link
                  href={`/r/${slug}/${newer.id}`}
                  className="rounded-xl border border-border px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <span className="block text-xs text-muted-foreground">
                    Newer
                  </span>
                  <span className="block truncate font-medium">
                    {newer.title}
                  </span>
                </Link>
              ) : null}
              {older ? (
                <Link
                  href={`/r/${slug}/${older.id}`}
                  className={`rounded-xl border border-border px-3 py-2 transition-colors hover:bg-muted/50 ${newer ? "sm:text-right" : "sm:col-span-2"}`}
                >
                  <span className="block text-xs text-muted-foreground">
                    Older
                  </span>
                  <span className="block truncate font-medium">
                    {older.title}
                  </span>
                </Link>
              ) : null}
            </nav>
          ) : null}
        </article>
      </PublicBody>
    </>
  );
}
