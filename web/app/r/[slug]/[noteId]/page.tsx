import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicNote } from "@/lib/server/public";
import { Loading } from "@/components/loading";
import { Paragraphs } from "@/components/paragraphs";
import { link } from "@/components/ui";
import { PublicBody, PublicHero } from "@/components/app/public-hero";
import { isUuid } from "@/lib/text";
import { NoteKind } from "@/components/note-status";

type Props = { params: Promise<{ slug: string; noteId: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug, noteId } = await params;
  if (!isUuid(noteId)) return { title: "Not found" };
  const data = await getPublicNote(slug, noteId);
  return {
    title: data ? `${data.note.title} · ${data.workspaceName}` : "Not found",
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
  const data = await getPublicNote(slug, noteId);
  if (!data) notFound();
  const { note, workspaceName } = data;
  return (
    <>
      <PublicHero eyebrow="Release note" title={note.title}>
        <p className="text-sm">
          <time dateTime={note.publishedAt}>
            {new Date(note.publishedAt).toISOString().slice(0, 10)}
          </time>
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
          <NoteKind type={note.type} />
          <Paragraphs text={note.body} />
        </article>
      </PublicBody>
    </>
  );
}
