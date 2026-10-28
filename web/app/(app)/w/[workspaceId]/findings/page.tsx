import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateFindingForm } from "@/components/create-finding-form";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Findings" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function FindingsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Findings {...props} />
    </Suspense>
  );
}

async function Findings({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const { documents } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/findings", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  return (
    <section className="space-y-6">
      <PageHeader
        icon={FileText}
        hue="blue"
        title="Findings"
        description="Write up what you learned. Paragraphs of your own, and cards that show the customer's exact words, always as they are stored, so a quote can never drift from what was said."
      />
      {ws.role !== "viewer" ? (
        <Panel title="Start a document">
          <CreateFindingForm workspaceId={ws.id} />
        </Panel>
      ) : null}
      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet.">
          Start one above to write up what you learned.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-2xl bg-card shadow-card">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40"
            >
              <FileText
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <Link
                href={`/w/${ws.id}/findings/${d.id}`}
                className="min-w-0 flex-1 font-medium underline-offset-2 hover:underline"
              >
                {d.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {d.state === "published" ? "Shared by link" : "Draft"} ·{" "}
                {d.blocks} {d.blocks === 1 ? "block" : "blocks"} · changed{" "}
                <LocalTime iso={d.updatedAt} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
