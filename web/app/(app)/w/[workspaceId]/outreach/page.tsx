import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { plural } from "@/lib/format";

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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="text-muted-foreground">
          When a request ships, the people who asked get a short personal email
          in their own words. Nothing goes out until you approve it.
        </p>
      </div>
      <nav aria-label="Messages" className="flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/w/${ws.id}/outreach?state=${key}`}
            aria-current={key === state ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${key === state ? "border-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {batches.length === 0 ? (
        <div className={card}>
          <p className="font-medium">
            {state === "open"
              ? "Nothing waiting for review."
              : "Nothing here yet."}
          </p>
          {state === "open" ? (
            <p className="mt-1 text-muted-foreground">
              Move a request to a shipped status and the people who asked will
              appear here.
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => (
            <li key={b.id} className={card}>
              <Link
                href={`/w/${ws.id}/outreach/${b.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {b.requestTitle}
              </Link>
              <p className="text-sm text-muted-foreground">
                {plural(b.messageCount, "person", "people")} ·{" "}
                {STATE_LABEL[b.state] ?? b.state} ·{" "}
                {new Date(b.createdAt).toLocaleDateString()}
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
