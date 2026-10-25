import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateFindingForm } from "@/components/create-finding-form";
import { card } from "@/components/ui";

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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Findings</h1>
        <p className="text-muted-foreground">
          Write up what you learned. Paragraphs of your own, and cards that show
          the customer&apos;s exact words, always as they are stored, so a quote
          can never drift from what was said.
        </p>
      </div>
      {ws.role !== "viewer" ? (
        <div className={card}>
          <h2 className="mb-3 font-medium">Start a document</h2>
          <CreateFindingForm workspaceId={ws.id} />
        </div>
      ) : null}
      {documents.length === 0 ? (
        <p className="text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="space-y-3">
          {documents.map((d) => (
            <li key={d.id} className={card}>
              <Link
                href={`/w/${ws.id}/findings/${d.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {d.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {d.state === "published" ? "Shared by link" : "Draft"} ·{" "}
                {d.blocks} {d.blocks === 1 ? "block" : "blocks"} · changed{" "}
                {new Date(d.updatedAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
