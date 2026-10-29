import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { RecordingsList } from "@/components/recordings-list";
import { RecordingUpload } from "@/components/recording-upload";
import { SourceStatus } from "@/components/source-status";
import { Mic } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { link } from "@/components/ui";

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
  const [{ media, nextCursor }, { people }] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/media", {
        params: { path: { workspaceId: ws.id }, query: { limit: 50 } },
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
      <PageHeader
        icon={Mic}
        hue="coral"
        title="Recordings"
        description="Upload an interview or call. We write out what was said, with who said it, and you can play any line, highlight it and tag it. The audio is sent to the transcription service; nothing else about your workspace is."
      />

      {canEdit ? (
        <Panel
          title={media.length === 0 ? "Add a recording" : undefined}
          description={
            media.length === 0
              ? "Up to 25 MB a file (about 90 minutes as MP3 or M4A). Add several at once if you like."
              : undefined
          }
        >
          <RecordingUpload
            workspaceId={ws.id}
            people={names}
            compact={media.length > 0}
          />
          {media.length > 0 ? (
            <p className="pt-3 text-xs">
              <Link
                href={`/w/${ws.id}/add`}
                className={`${link} underline underline-offset-4`}
              >
                Paste a transcript instead
              </Link>
            </p>
          ) : null}
        </Panel>
      ) : null}

      <SourceStatus state={working ? "pending" : "done"}>
        {working ? (
          <p className="text-sm text-muted-foreground">
            Writing transcripts… this usually takes a minute or two.
          </p>
        ) : null}
      </SourceStatus>

      {media.length === 0 ? (
        <EmptyState icon={Mic} title="No recordings yet.">
          {canEdit
            ? "Upload one above to get a transcript you can search, highlight and ask questions about."
            : "Ask an editor to upload one."}
        </EmptyState>
      ) : (
        <RecordingsList
          workspaceId={ws.id}
          items={media}
          nextCursor={nextCursor}
          people={names}
          canEdit={canEdit}
        />
      )}
    </section>
  );
}
