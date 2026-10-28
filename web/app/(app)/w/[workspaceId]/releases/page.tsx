import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateNoteForm } from "@/components/create-note-form";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";

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
      <PageHeader
        title="Release notes"
        description="Tell everyone what changed. Publish now or schedule it, and link the requests it closes."
      />
      {ws.role !== "viewer" ? (
        <Panel title="Start a note">
          <CreateNoteForm workspaceId={ws.id} />
        </Panel>
      ) : null}
      {notes.length === 0 ? (
        <EmptyState icon={Megaphone} title="No release notes yet.">
          Start one above to tell customers what changed.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {notes.map((n) => (
            <li
              key={n.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40"
            >
              <Link
                href={`/w/${ws.id}/releases/${n.id}`}
                className="min-w-0 flex-1 font-medium underline-offset-2 hover:underline"
              >
                {n.title}
              </Link>
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-full",
                    n.state === "published"
                      ? "bg-hue-teal"
                      : n.state === "scheduled"
                        ? "bg-hue-blue"
                        : "bg-input",
                  )}
                />
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
