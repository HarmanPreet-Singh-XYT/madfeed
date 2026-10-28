import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { Send } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { plural } from "@/lib/format";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Messages" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ state?: string }>;
};

const STATE_LABEL: Record<string, string> = {
  drafting: "Being written",
  review: "Waiting for your review",
  approved: "Sending",
  done: "Sent",
  cancelled: "Cancelled",
};

export default function OutreachPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Outreach {...props} />
    </Suspense>
  );
}

async function Outreach({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const q = (await searchParams).state;
  const state = q === "done" || q === "cancelled" ? q : "open";
  const ws = await getWorkspace(workspaceId);
  const { batches } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/outreach", {
      params: { path: { workspaceId: ws.id }, query: { state } },
    }),
  );
  const tabs = [
    ["open", "To review"],
    ["done", "Sent"],
    ["cancelled", "Cancelled"],
  ] as const;

  return (
    <section className="space-y-6">
      <PageHeader
        icon={Send}
        hue="amber"
        title="Messages"
        description="When a request ships, the people who asked get a short personal email in their own words. Nothing goes out until you approve it."
      />
      <Segmented
        label="Messages"
        items={tabs.map(([key, label]) => ({
          href: `/w/${ws.id}/outreach?state=${key}`,
          label,
          active: key === state,
        }))}
      />
      {batches.length === 0 ? (
        <EmptyState
          icon={Send}
          title={
            state === "open"
              ? "Nothing waiting for review."
              : "Nothing here yet."
          }
        >
          {state === "open"
            ? "Move a request to a shipped status and the people who asked will appear here."
            : undefined}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-2xl bg-card shadow-card">
          {batches.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40"
            >
              <Link
                href={`/w/${ws.id}/outreach/${b.id}`}
                className="min-w-0 flex-1 font-medium underline-offset-2 hover:underline"
              >
                {b.requestTitle}
              </Link>
              <p className="text-sm text-muted-foreground">
                {plural(b.messageCount, "person", "people")} ·{" "}
                {STATE_LABEL[b.state] ?? b.state} ·{" "}
                <LocalTime iso={b.createdAt} />
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        <Link href={`/w/${ws.id}/requests`} className={link}>
          Back to requests
        </Link>
      </p>
    </section>
  );
}
