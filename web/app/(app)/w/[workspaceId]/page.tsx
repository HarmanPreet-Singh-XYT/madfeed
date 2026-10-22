import { Suspense } from "react";
import { redirect } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getProposals, getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";

// Send people where the next useful thing is: things waiting for review,
// otherwise their requests, otherwise the place to add feedback.
export default function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <Route params={params} />
    </Suspense>
  );
}

async function Route({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}): Promise<never> {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  if ((await getProposals(ws.id, "suggested", 1)).length > 0)
    redirect(`/w/${ws.id}/review`);
  const reqs = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/requests", {
      params: { path: { workspaceId: ws.id }, query: { limit: 1 } },
    }),
  );
  redirect(
    reqs.requests.length > 0 ? `/w/${ws.id}/requests` : `/w/${ws.id}/add`,
  );
}
