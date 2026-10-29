import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicReleases } from "@/lib/server/public";
import { Loading } from "@/components/loading";
import { Paragraphs } from "@/components/paragraphs";
import { link } from "@/components/ui";
import { PublicBody, PublicHero } from "@/components/app/public-hero";

type Props = { params: Promise<{ slug: string }> };

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

async function Page({ params }: Props) {
  const { slug } = await params;
  const data = await getPublicReleases(slug);
  if (!data) notFound();
  const { workspaceName, notes } = data;
  return (
    <>
      <PublicHero
        eyebrow="What's new"
        title={<>What&apos;s new at {workspaceName}</>}
      >
        <p>Recent changes and improvements.</p>
      </PublicHero>
      <PublicBody>
        {notes.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing has been published yet.
          </p>
        ) : (
          <ol className="space-y-12">
            {notes.map((n) => (
              <li key={n.id} className="space-y-3">
                <h2 className="font-display text-xl font-semibold">
                  <Link
                    href={`/r/${slug}/${n.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {n.title}
                  </Link>
                </h2>
                <p className="text-sm text-muted-foreground">
                  <time dateTime={n.publishedAt}>
                    {new Date(n.publishedAt).toISOString().slice(0, 10)}
                  </time>
                </p>
                <Paragraphs text={n.body} />
                <p className="text-sm">
                  <Link href={`/r/${slug}/${n.id}`} className={link}>
                    Link to this note
                  </Link>
                </p>
              </li>
            ))}
          </ol>
        )}
      </PublicBody>
    </>
  );
}
