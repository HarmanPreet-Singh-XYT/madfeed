import { Suspense } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ActivityRow } from "@/components/app/activity-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { link } from "@/components/ui";

export const metadata = { title: "Activity" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ kind?: string; cursor?: string }>;
};

type Kind =
  | "request"
  | "quote"
  | "message"
  | "conversation"
  | "finding"
  | "release"
  | "survey";

const KINDS = [
  ["", "Everything"],
  ["request", "Requests"],
  ["quote", "Quotes"],
  ["message", "Messages sent"],
  ["conversation", "Support conversations"],
  ["finding", "Findings"],
  ["release", "Release notes"],
  ["survey", "Surveys"],
] as const;

export default function ActivityPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <ActivityLog {...props} />
    </Suspense>
  );
}

async function ActivityLog({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const base = `/w/${ws.id}`;
  const kind = (
    KINDS.some(([value]) => value === sp.kind) ? (sp.kind ?? "") : ""
  ) as Kind | "";
  const cursor = sp.cursor ?? "";
  const { items, nextCursor } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/activity", {
      params: {
        path: { workspaceId: ws.id },
        query: {
          ...(kind ? { kind: kind as Kind } : {}),
          ...(cursor ? { cursor } : {}),
          limit: 30,
        },
      },
    }),
  );

  function href(next: { kind?: string; cursor?: string }) {
    const p = new URLSearchParams();
    if (next.kind) p.set("kind", next.kind);
    if (next.cursor) p.set("cursor", next.cursor);
    const query = p.toString();
    return `${base}/activity${query ? `?${query}` : ""}`;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        back={{ href: base, label: "Overview" }}
        title="Activity"
        description="Every recorded change across the workspace: requests, quotes, messages, conversations, findings, releases and surveys. Newest first."
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="activity-kind" className="sr-only">
            Show
          </label>
          <select
            id="activity-kind"
            name="kind"
            defaultValue={kind}
            className="h-8 rounded-lg border border-input bg-card px-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {KINDS.map(([value, label]) => (
              <option key={value || "all"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
        {kind ? (
          <Button asChild variant="ghost">
            <Link href={href({})}>Clear</Link>
          </Button>
        ) : null}
      </form>

      {items.length === 0 ? (
        <EmptyState icon={Activity} title="Nothing recorded here yet.">
          Activity appears as customers talk, quotes are saved, messages are
          sent and documents are shared.
        </EmptyState>
      ) : (
        <Card asChild className="[--card-spacing:0px] py-0">
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}-${item.at}`}>
                <ActivityRow base={base} item={item} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {nextCursor ? (
        <p>
          <Link
            href={href({ ...(kind ? { kind } : {}), cursor: nextCursor })}
            className={link}
          >
            More activity
          </Link>
        </p>
      ) : null}
    </section>
  );
}
