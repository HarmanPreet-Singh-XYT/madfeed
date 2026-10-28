import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { formatValue, impactLine } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Map } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatusPill } from "@/components/app/status-pill";

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
  { bucket: "open", title: "New", dot: "bg-hue-blue", well: "bg-tint-blue" },
  {
    bucket: "active",
    title: "In progress",
    dot: "bg-hue-amber",
    well: "bg-tint-amber",
  },
  {
    bucket: "done",
    title: "Shipped",
    dot: "bg-hue-teal",
    well: "bg-tint-teal",
  },
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
      <PageHeader
        icon={Map}
        hue="sky"
        title="Roadmap"
        description="Your requests by stage, most valuable first. Open a request to choose what visitors can see on the public roadmap; nothing is public until you decide."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((c) => {
          const items = requests.filter((r) => r.status.bucket === c.bucket);
          return (
            <div
              key={c.bucket}
              className={cn("space-y-2 rounded-lg p-2", c.well)}
            >
              <h2 className="flex items-center gap-2 px-1.5 pt-1 text-sm">
                <span
                  aria-hidden="true"
                  className={cn("size-2.5 rounded-full", c.dot)}
                />
                {c.title}
                <span className="text-sm font-normal text-muted-foreground">
                  ({items.length})
                </span>
              </h2>
              {items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-input/60 px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {items.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={`/w/${ws.id}/requests/${r.id}`}
                        className="group block space-y-1.5 rounded-xl bg-card p-3 shadow-card transition-shadow duration-150 hover:shadow-raised"
                      >
                        <span className="block text-sm font-medium underline-offset-2 group-hover:text-link group-hover:underline">
                          {r.title}
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusPill
                            name={r.status.name}
                            bucket={r.status.bucket}
                          />
                          {r.impact.accountsWithValue > 0 ? (
                            <span className="text-xs font-semibold tabular-nums">
                              {formatValue(r.impact.totalValue)} revenue
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {impactLine(r.impact)}
                        </span>
                      </Link>
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
