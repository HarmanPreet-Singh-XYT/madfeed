import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { FindingEditor, type EditorBlock } from "@/components/finding-editor";
import { link } from "@/components/ui";

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
    b.kind === "text"
      ? { key: b.id, kind: "text", body: b.body }
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
        },
  );
  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/findings`} className={link}>
          ← All documents
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{d.title}</h1>
      <FindingEditor
        workspaceId={ws.id}
        docId={d.id}
        title={d.title}
        state={d.state}
        publicLink={d.publicLink}
        initial={initial}
        canWrite={ws.role !== "viewer"}
        isAdmin={ws.role === "admin"}
      />
    </section>
  );
}
