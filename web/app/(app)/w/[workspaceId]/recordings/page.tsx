import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { RecordingsList } from "@/components/recordings-list";
import { RecordingUpload } from "@/components/recording-upload";
import { SourceStatus } from "@/components/source-status";
import { card } from "@/components/ui";

export const metadata = { title: "Recordings" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function RecordingsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Recordings {...props} />
    </Suspense>
  );
}

async function Recordings({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const [{ media }, { people }] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/media", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/people", {
        params: { path: { workspaceId: ws.id }, query: { limit: 200 } },
      })
      .then(unwrap),
  ]);
  const working = media.some(
    (m) => m.state === "uploaded" || m.state === "transcribing",
  );
  const canEdit = ws.role !== "viewer";
  const names = people.map((p) => ({ id: p.id, name: p.name }));

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Recordings</h1>
        <p className="text-muted">
          Upload an interview or call. We write out what was said, with who said
          it, and you can play any line, highlight it and tag it. The audio is
          sent to the transcription service; nothing else about your workspace
          is.
        </p>
      </div>

      {canEdit ? (
        <div className={card}>
          <h2 className="mb-3 text-lg font-medium">Upload a recording</h2>
          <RecordingUpload workspaceId={ws.id} people={names} />
        </div>
      ) : null}

      <SourceStatus state={working ? "pending" : "done"}>
        {working ? (
          <p className="text-sm text-muted">
            Writing transcripts… this usually takes a minute or two.
          </p>
        ) : null}
      </SourceStatus>

      {media.length === 0 ? (
        <div className={card}>
          <p className="font-medium">No recordings yet.</p>
          <p className="mt-1 text-muted">
            {canEdit
              ? "Upload one above to get a transcript you can search, highlight and ask questions about."
              : "Ask an editor to upload one."}
          </p>
        </div>
      ) : (
        <RecordingsList
          workspaceId={ws.id}
          items={media}
          people={names}
          canEdit={canEdit}
        />
      )}
    </section>
  );
}
