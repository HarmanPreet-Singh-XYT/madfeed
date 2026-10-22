import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { ReleaseEditor } from "@/components/release-editor";
import { link } from "@/components/ui";
import { isUuid } from "@/lib/text";

export const metadata = { title: "Release note" };

type Props = { params: Promise<{ workspaceId: string; noteId: string }> };

export default function NotePage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Note {...props} />
    </Suspense>
  );
}

async function Note({ params }: Props) {
  const { workspaceId, noteId } = await params;
  const ws = await getWorkspace(workspaceId);
  if (!isUuid(noteId)) notFound();
  const client = await api();
  const res = await client.GET(
    "/v1/workspaces/{workspaceId}/release-notes/{noteId}",
    { params: { path: { workspaceId: ws.id, noteId } } },
  );
  if (res.response.status === 404) notFound();
  const note = unwrap(res);
  const settings = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/settings", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const { requests } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/requests", {
      params: { path: { workspaceId: ws.id }, query: { limit: 100 } },
    }),
  );
  // Requests already linked stay in the list even if they are older than the most recent 100.
  const known = new Map(requests.map((r) => [r.id, r.title]));
  for (const r of note.requests) known.set(r.id, r.title);

  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/releases`} className={link}>
          ← All release notes
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{note.title}</h1>
      <ReleaseEditor
        workspaceId={ws.id}
        note={note}
        requests={[...known].map(([id, title]) => ({ id, title }))}
        publicPath={
          settings.publicSlug
            ? `/r/${settings.publicSlug}/${note.id}`
            : undefined
        }
        canEdit={ws.role !== "viewer"}
      />
    </section>
  );
}
