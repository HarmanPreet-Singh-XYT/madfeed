import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { impactLine } from "@/lib/format";

export const metadata = { title: "Roadmap" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function RoadmapPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Roadmap {...props} />
    </Suspense>
  );
}

const columns = [
  { bucket: "open", title: "New" },
  { bucket: "active", title: "In progress" },
  { bucket: "done", title: "Shipped" },
] as const;

async function Roadmap({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const { requests } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/requests", {
      params: {
        path: { workspaceId: ws.id },
        query: { limit: 100, sort: "value" },
      },
    }),
  );
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Roadmap</h1>
        <p className="text-muted-foreground">
          Your requests by stage, most valuable first. Open a request to choose
          what visitors can see on the public roadmap; nothing is public until
          you decide.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((c) => {
          const items = requests.filter((r) => r.status.bucket === c.bucket);
          return (
            <div key={c.bucket} className={`${card} space-y-3`}>
              <h2 className="text-lg font-medium">
                {c.title}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({items.length})
                </span>
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing here.</p>
              ) : (
                <ul className="space-y-3">
                  {items.map((r) => (
                    <li key={r.id} className="space-y-0.5">
                      <Link
                        href={`/w/${ws.id}/requests/${r.id}`}
                        className={link}
                      >
                        {r.title}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {r.status.name} · {impactLine(r.impact)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
