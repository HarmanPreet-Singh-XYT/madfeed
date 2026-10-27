import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicNote } from "@/lib/server/public";
import { Loading } from "@/components/loading";
import { Paragraphs } from "@/components/paragraphs";
import { link } from "@/components/ui";
import { isUuid } from "@/lib/text";

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
    <article className="space-y-6">
      <p>
        <Link href={`/r/${slug}`} className={link}>
          ← What&apos;s new at {workspaceName}
        </Link>
      </p>
      <h1 className="text-3xl font-semibold">{note.title}</h1>
      <p className="text-sm text-muted-foreground">
        <time dateTime={note.publishedAt}>
          {new Date(note.publishedAt).toISOString().slice(0, 10)}
        </time>
      </p>
      <Paragraphs text={note.body} />
    </article>
  );
}
