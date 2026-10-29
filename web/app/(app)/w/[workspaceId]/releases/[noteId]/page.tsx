import { Suspense } from "react";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { ReleaseEditor } from "@/components/release-editor";
import { ReleaseActions } from "@/components/release-actions";
import { isUuid } from "@/lib/text";
import { PageHeader } from "@/components/app/page-header";
import {
  NOTE_KIND_LABEL,
  NOTE_STATE_LABEL,
} from "@/components/note-status";
import { LocalTime } from "@/components/local-time";

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
  // Who is behind a request is what decides which ones a note should close, so the picker shows it.
  const known = new Map(
    requests.map((r) => [r.id, { title: r.title, people: r.impact.peopleCount }]),
  );
  for (const r of note.requests) {
    if (!known.has(r.id)) known.set(r.id, { title: r.title, people: 0 });
  }
  const pickable = [...known]
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => b.people - a.people || a.title.localeCompare(b.title));
  const publicPath = settings.publicSlug
    ? `/r/${settings.publicSlug}/${note.id}`
    : undefined;

  return (
    <section className="space-y-6">
      <PageHeader
        back={{ href: `/w/${ws.id}/releases`, label: "All release notes" }}
        title={<>{note.title}</>}
        description={
          <>
            {NOTE_STATE_LABEL[note.state] ?? note.state}
            {note.type ? ` · ${NOTE_KIND_LABEL[note.type] ?? note.type}` : ""}
            {" · edited "}
            <LocalTime iso={note.updatedAt} time relative />
          </>
        }
        actions={
          <ReleaseActions
            workspaceId={ws.id}
            note={{
              id: note.id,
              title: note.title,
              body: note.body,
              state: note.state,
              liveNow: note.liveNow,
              publishedAt: note.publishedAt,
              scheduledFor: note.scheduledFor,
              requests: note.requests,
            }}
            publicPath={publicPath}
            coverUrl={
              note.coverUpdatedAt
                ? `/api/covers/${ws.id}/${note.id}?v=${encodeURIComponent(note.coverUpdatedAt)}`
                : undefined
            }
            canEdit={ws.role !== "viewer"}
          />
        }
      />
      <ReleaseEditor
        key={note.updatedAt}
        workspaceId={ws.id}
        note={note}
        requests={pickable}
        publicPath={publicPath}
        canEdit={ws.role !== "viewer"}
      />
    </section>
  );
}
