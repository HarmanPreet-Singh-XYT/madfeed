import { Suspense } from "react";
import Link from "next/link";
import { getProposals, getSource, getWorkspace } from "@/lib/server/queries";
import { SourceStatus } from "@/components/source-status";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { api, unwrap } from "@/lib/server/api";
import { HighlightableText } from "@/components/highlightable-text";

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

  const client = await api();
  const marks = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/highlights", {
      params: {
        path: { workspaceId: ws.id },
        query: { sourceItemId: src.id, limit: 100 },
      },
    }),
  ).highlights.map((h) => ({ id: h.id, start: h.spanStart, end: h.spanEnd }));
  const { tags } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/tags", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const start = Number(s);
  const end = Number(e);
  const focus =
    s !== undefined &&
    e !== undefined &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    end > start
      ? { start, end }
      : undefined;

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

      <HighlightableText
        workspaceId={ws.id}
        sourceItemId={src.id}
        text={src.text}
        marks={marks}
        focus={focus}
        tags={tags.filter((t) => !t.archived)}
        canEdit={ws.role !== "viewer" && src.state !== "pending"}
      />
    </section>
  );
}
