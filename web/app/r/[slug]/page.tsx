import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicApi } from "@/lib/server/api";
import { Loading } from "@/components/loading";
import { Paragraphs } from "@/components/paragraphs";
import { link } from "@/components/ui";

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
  const res = await publicApi().GET("/v1/public/releases/{slug}", {
    params: { path: { slug }, query: { limit: 50 } },
    cache: "no-store",
  });
  if (res.response.status === 404 || !res.data) notFound();
  const { workspaceName, notes } = res.data;
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">
          What&apos;s new at {workspaceName}
        </h1>
        <p className="text-muted">Recent changes and improvements.</p>
      </header>
      {notes.length === 0 ? (
        <p className="text-muted">Nothing has been published yet.</p>
      ) : (
        <ol className="space-y-12">
          {notes.map((n) => (
            <li key={n.id} className="space-y-3">
              <h2 className="text-xl font-semibold">
                <Link
                  href={`/r/${slug}/${n.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {n.title}
                </Link>
              </h2>
              <p className="text-sm text-muted">
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
    </div>
  );
}
