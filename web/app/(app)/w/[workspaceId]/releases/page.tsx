import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateNoteForm } from "@/components/create-note-form";
import { card } from "@/components/ui";

export const metadata = { title: "Release notes" };

type Props = { params: Promise<{ workspaceId: string }> };

const STATE: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  unpublished: "Taken down",
};

export default function ReleasesPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Releases {...props} />
    </Suspense>
  );
}

async function Releases({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const { notes } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/release-notes", {
      params: { path: { workspaceId: ws.id }, query: { limit: 50 } },
    }),
  );
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Release notes</h1>
        <p className="text-muted-foreground">
          Tell everyone what changed. Publish now or schedule it, and link the
          requests it closes.
        </p>
      </div>
      {ws.role !== "viewer" ? (
        <div className={card}>
          <h2 className="mb-3 font-medium">Start a note</h2>
          <CreateNoteForm workspaceId={ws.id} />
        </div>
      ) : null}
      {notes.length === 0 ? (
        <p className="text-muted-foreground">No release notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className={card}>
              <Link
                href={`/w/${ws.id}/releases/${n.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {n.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {STATE[n.state] ?? n.state}
                {n.scheduledFor && n.state === "scheduled"
                  ? ` for ${n.scheduledFor.replace("T", " ").slice(0, 16)} UTC`
                  : ""}
                {n.requests.length > 0
                  ? ` · closes ${n.requests.length} ${n.requests.length === 1 ? "request" : "requests"}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
