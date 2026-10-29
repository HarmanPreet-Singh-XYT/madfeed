import { Suspense } from "react";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { FindingEditor, type EditorBlock } from "@/components/finding-editor";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Findings document" };

type Props = { params: Promise<{ workspaceId: string; docId: string }> };

export default function FindingPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Finding {...props} />
    </Suspense>
  );
}

async function Finding({ params }: Props) {
  const { workspaceId, docId } = await params;
  if (!isUuid(docId)) notFound();
  const ws = await getWorkspace(workspaceId);
  const res = await (
    await api()
  ).GET("/v1/workspaces/{workspaceId}/findings/{docId}", {
    params: { path: { workspaceId: ws.id, docId } },
  });
  if (res.response.status === 404) notFound();
  const d = unwrap(res);
  const initial: EditorBlock[] = d.blocks.map((b) =>
    b.kind === "text" || b.kind === "heading"
      ? { key: b.id, kind: b.kind, body: b.body }
      : {
          key: b.id,
          kind: "quote",
          id: b.id,
          body: b.body,
          quoteKind: b.quoteKind,
          quoteId: b.quoteId,
          removed: b.removed,
          quote: b.quote ?? "",
          sourceTitle: b.sourceTitle ?? "",
          sourceItemId: b.sourceItemId,
          requestTitle: b.requestTitle,
        },
  );
  return (
    <section className="space-y-6">
      <PageHeader
        back={{ href: `/w/${ws.id}/findings`, label: "All documents" }}
        title={<>{d.title}</>}
      />
      <FindingEditor
        workspaceId={ws.id}
        docId={d.id}
        title={d.title}
        state={d.state}
        publicLink={d.publicLink}
        updatedAt={d.updatedAt}
        publishedAt={d.publishedAt}
        shareExpiresAt={d.shareExpiresAt}
        passwordProtected={d.passwordProtected ?? false}
        initial={initial}
        canWrite={ws.role !== "viewer"}
        isAdmin={ws.role === "admin"}
      />
    </section>
  );
}
