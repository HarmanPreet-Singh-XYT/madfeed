import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { AddFeedback } from "@/components/add-feedback";
import { Loading } from "@/components/loading";
import { CirclePlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

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
  const options = people.map((p) => ({
    id: p.id,
    label: p.accountName ? `${p.name} (${p.accountName})` : p.name,
  }));
  return (
    <section className="space-y-6">
      <PageHeader
        icon={CirclePlus}
        hue="teal"
        title="Add feedback"
        description="Paste a call, a support thread or a chat, or upload a recording. You review what we find before anything is saved."
      />
      {ws.role === "viewer" ? (
        <Card asChild className="[--card-spacing:0px] p-4">
          <p className="text-sm">
            Your role in this workspace is viewer, so you can read but not add
            feedback.
          </p>
        </Card>
      ) : (
        <AddFeedback
          workspaceId={ws.id}
          people={options}
          recordingPeople={people.map((p) => ({ id: p.id, name: p.name }))}
        />
      )}
    </section>
  );
}
