import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { Map } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { RoadmapBoard } from "@/components/roadmap-board";

export const metadata = { title: "Roadmap" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function RoadmapPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Roadmap {...props} />
    </Suspense>
  );
}

async function Roadmap({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const [res, settings, statusRes] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/requests", {
        params: {
          path: { workspaceId: ws.id },
          query: { limit: 100, sort: "value" },
        },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/settings", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/statuses", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
  ]);
  const slug = settings.publicSlug ?? undefined;
  return (
    <section className="space-y-6">
      <PageHeader
        icon={Map}
        hue="sky"
        title="Roadmap"
        description="What you are building next, by stage. Each card carries the people and revenue behind it; open a request to choose what the public roadmap shows."
      />
      <RoadmapBoard
        workspaceId={ws.id}
        requests={res.requests}
        publicHref={slug ? `/r/${slug}/roadmap` : undefined}
        statuses={statusRes.statuses}
        canEdit={ws.role !== "viewer"}
      />
    </section>
  );
}
