import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { PasteForm } from "@/components/paste-form";
import { Loading } from "@/components/loading";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Add feedback" };

export default function AddPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <Add params={params} />
    </Suspense>
  );
}

async function Add({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  // Who said it decides whose company the request is weighted by. Optional.
  const people =
    ws.role === "viewer"
      ? []
      : unwrap(
          await (
            await api()
          ).GET("/v1/workspaces/{workspaceId}/people", {
            params: { path: { workspaceId: ws.id }, query: { limit: 200 } },
          }),
        ).people;
  return (
    <section className="space-y-6">
      <PageHeader
        title="Add feedback"
        description="Paste a customer call, support thread or chat. You'll review what we find before anything is saved."
      />
      {ws.role === "viewer" ? (
        <p className="rounded-lg border border-border p-4 text-[13px]">
          Your role in this workspace is viewer, so you can read but not add
          feedback.
        </p>
      ) : (
        <PasteForm
          workspaceId={ws.id}
          people={people.map((p) => ({
            id: p.id,
            label: p.accountName ? `${p.name} (${p.accountName})` : p.name,
          }))}
        />
      )}
    </section>
  );
}
