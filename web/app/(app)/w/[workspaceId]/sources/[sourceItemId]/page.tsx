import { Suspense } from "react";
import Link from "next/link";
import { getProposals, getSource, getWorkspace } from "@/lib/server/queries";
import { SourceStatus } from "@/components/source-status";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { spanContext } from "@/lib/text";

export const metadata = { title: "Conversation" };

type Props = {
  params: Promise<{ workspaceId: string; sourceItemId: string }>;
  searchParams: Promise<{ s?: string; e?: string }>;
};

export default function SourcePage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Source {...props} />
    </Suspense>
  );
}

async function Source({ params, searchParams }: Props) {
  const { workspaceId, sourceItemId } = await params;
  const { s, e } = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const src = await getSource(ws.id, sourceItemId);
  const ready =
    src.state === "done"
      ? (await getProposals(ws.id, "suggested", 200)).filter(
          (p) => p.sourceItemId === src.id,
        ).length
      : 0;

  const start = Number(s);
  const end = Number(e);
  const hl =
    s !== undefined && e !== undefined
      ? spanContext(src.text, start, end, src.text.length)
      : null;

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {src.title || "Conversation"}
        </h1>
        <p className="text-sm text-muted">
          Added {new Date(src.createdAt).toLocaleString()}
        </p>
      </div>

      <SourceStatus state={src.state}>
        {src.state === "pending" || src.state === "processing" ? (
          <p>
            Reading the conversation and finding requests… this usually takes
            under a minute.
          </p>
        ) : src.state === "failed" ? (
          <p className="text-danger">
            We couldn&apos;t finish reading this one
            {src.failureReason ? ` (${src.failureReason})` : ""}. Try pasting it
            again.
          </p>
        ) : ready > 0 ? (
          <p>
            Found {ready} {ready === 1 ? "request" : "requests"} to review.{" "}
            <Link href={`/w/${ws.id}/review`} className={link}>
              Review them
            </Link>
          </p>
        ) : (
          <p>
            Done. We didn&apos;t find anything that looked like a customer
            request in this conversation.
          </p>
        )}
      </SourceStatus>

      <article
        aria-label="Original text"
        className="rounded-lg border border-border p-4 leading-7 whitespace-pre-wrap"
      >
        {hl ? (
          <>
            {hl.before}
            <mark id="quote">{hl.quote}</mark>
            {hl.after}
          </>
        ) : (
          src.text
        )}
      </article>
    </section>
  );
}
