import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { AskPanel } from "@/components/ask-panel";
import { Loading } from "@/components/loading";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Ask" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function AskPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Ask {...props} />
    </Suspense>
  );
}

async function Ask({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const [{ answers }, { requests }] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/qa", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
    // Starter questions come from real requests, so they are about this workspace, not a generic demo.
    client
      .GET("/v1/workspaces/{workspaceId}/requests", {
        params: {
          path: { workspaceId: ws.id },
          query: { limit: 4, sort: "value" },
        },
      })
      .then(unwrap),
  ]);
  const suggestions = [
    ...new Set(
      requests.map((r) => {
        const title =
          r.title.length > 70 ? `${r.title.slice(0, 70).trimEnd()}…` : r.title;
        return `What do customers say about “${title}”?`;
      }),
    ),
  ].slice(0, 3);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Ask"
        description="Ask what customers actually said. Every answer quotes them, or says there isn't enough evidence."
      />
      <AskPanel
        workspaceId={ws.id}
        enabled={process.env.QA_ENABLED !== "false"}
        history={answers}
        suggestions={suggestions}
      />
    </section>
  );
}
