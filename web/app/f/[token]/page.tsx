import { Suspense } from "react";
import { notFound } from "next/navigation";
import { publicApi } from "@/lib/server/api";
import { Loading } from "@/components/loading";

export const metadata = {
  title: "Findings",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

const TOKEN = /^[A-Za-z0-9._-]{20,200}$/;

export default function SharedFindingPage({ params }: Props) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-12"
    >
      <Suspense fallback={<Loading />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

async function Body({ params }: Props) {
  const { token } = await params;
  if (!TOKEN.test(token)) notFound();
  const res = await publicApi().GET("/v1/public/findings/{token}", {
    params: { path: { token } },
    cache: "no-store",
  });
  if (res.response.status === 404 || !res.data) notFound();
  const d = res.data;
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold">{d.title}</h1>
      {d.blocks.map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="whitespace-pre-wrap">
            {b.text}
          </p>
        ) : (
          <figure key={i} className="space-y-2 border-l-4 border-border pl-4">
            <blockquote className="text-lg">“{b.text}”</blockquote>
            {b.note ? (
              <figcaption className="text-sm text-muted">{b.note}</figcaption>
            ) : null}
          </figure>
        ),
      )}
    </article>
  );
}
