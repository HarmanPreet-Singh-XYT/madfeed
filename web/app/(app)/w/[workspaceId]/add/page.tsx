import { Suspense } from "react";
import { getWorkspace } from "@/lib/server/queries";
import { PasteForm } from "@/components/paste-form";
import { Loading } from "@/components/loading";

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
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Add feedback</h1>
        <p className="text-muted">
          Paste a customer call, support thread or chat. You&apos;ll review what
          we find before anything is saved.
        </p>
      </div>
      {ws.role === "viewer" ? (
        <p className="rounded-md border border-border p-4">
          Your role in this workspace is viewer, so you can read but not add
          feedback.
        </p>
      ) : (
        <PasteForm workspaceId={ws.id} />
      )}
    </section>
  );
}
