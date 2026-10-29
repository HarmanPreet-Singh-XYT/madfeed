import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { Segmented } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { plural } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Send } from "lucide-react";

export const metadata = { title: "Messages" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ state?: string; q?: string; sort?: string }>;
};

const STATE_LABEL: Record<string, string> = {
  drafting: "Being written",
  review: "Waiting for your review",
  approved: "Sending",
  done: "Sent",
  cancelled: "Cancelled",
};

const STATE_TINT: Record<
  string,
  "muted" | "tint-teal" | "tint-amber" | "tint-coral" | "tint-blue"
> = {
  drafting: "tint-blue",
  review: "tint-amber",
  approved: "tint-amber",
  done: "tint-teal",
  cancelled: "muted",
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
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const sort = sp.sort === "oldest" ? "oldest" : "newest";
  const state = sp.state === "done" || sp.state === "cancelled" ? sp.state : "open";
  const ws = await getWorkspace(workspaceId);
  const { batches } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/outreach", {
      params: { path: { workspaceId: ws.id }, query: { state } },
    }),
  );

  const filtered = batches
    .filter(
      (b) =>
        q === "" || b.requestTitle.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => {
      const diff =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === "oldest" ? diff : -diff;
    });

  const tabs = [
    ["open", "Open"],
    ["done", "Sent"],
    ["cancelled", "Cancelled"],
  ] as const;

  function hrefFor(nextState: string) {
    const p = new URLSearchParams();
    p.set("state", nextState);
    if (q) p.set("q", q);
    if (sort !== "newest") p.set("sort", sort);
    return `/w/${ws.id}/outreach?${p.toString()}`;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        icon={Send}
        hue="amber"
        title="Messages"
        description="When a request ships, the people who asked get a short personal email in their own words. Nothing goes out until you approve it."
        actions={
          state === "open" && filtered.length > 0 ? (
            <Button asChild>
              <Link href={`/w/${ws.id}/outreach/${filtered[0].id}`}>
                Review next
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Segmented
        label="Messages"
        items={tabs.map(([key, label]) => ({
          href: hrefFor(key),
          label,
          active: key === state,
        }))}
      />

      <form
        method="get"
        role="search"
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="state" value={state} />
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="messages-q" className="sr-only">
            Search messages by request
          </label>
          <Input
            id="messages-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search by request"
          />
        </div>
        <div>
          <label htmlFor="messages-sort" className="sr-only">
            Sort messages
          </label>
          <select
            id="messages-sort"
            name="sort"
            defaultValue={sort}
            className="h-8 rounded-lg border border-input bg-card px-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {q ? (
          <Button asChild variant="ghost">
            <Link href={hrefFor(state)}>Clear</Link>
          </Button>
        ) : null}
        <p className="ml-auto text-xs text-muted-foreground">
          {plural(filtered.length, "batch", "batches")}
        </p>
      </form>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Send}
          title={
            q
              ? "No batches match."
              : state === "open"
                ? "Nothing waiting for review."
                : state === "done"
                  ? "Nothing sent yet."
                  : "Nothing cancelled."
          }
        >
          {q ? (
            <>
              No request matches “{q}”.{" "}
              <Link href={hrefFor(state)} className={link}>
                Clear the search
              </Link>
            </>
          ) : state === "open" ? (
            <>
              Move a request to a shipped status and the people who asked will
              appear here.{" "}
              <Link href={`/w/${ws.id}/requests`} className={link}>
                Open requests
              </Link>
            </>
          ) : state === "done" ? (
            <>
              Batches you approve will appear here once the emails go out.{" "}
              <Link href={`/w/${ws.id}/requests`} className={link}>
                Open requests
              </Link>
            </>
          ) : (
            <>
              A batch you cancel lands here, and its drafts are discarded.{" "}
              <Link href={`/w/${ws.id}/requests`} className={link}>
                Open requests
              </Link>
            </>
          )}
        </EmptyState>
      ) : (
        <Card asChild className="[--card-spacing:0px] py-0">
          <ul className="divide-y divide-border">
            {filtered.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/w/${ws.id}/outreach/${b.id}`}
                  className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{b.requestTitle}</p>
                    <p className="text-sm text-muted-foreground">
                      {plural(b.messageCount, "person", "people")} ·{" "}
                      {b.readyToSend} ready
                      {b.leftOut > 0 ? ` · ${b.leftOut} left out` : ""}
                      {b.failed > 0 ? (
                        <span className="text-destructive">
                          {` · ${b.failed} failed`}
                        </span>
                      ) : null}
                      {" · "}
                      <LocalTime iso={b.createdAt} />
                    </p>
                  </div>
                  <Badge
                    variant={STATE_TINT[b.state] ?? "muted"}
                    className="h-6 px-2.5"
                  >
                    {STATE_LABEL[b.state] ?? b.state}
                  </Badge>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        <Link href={`/w/${ws.id}/requests`} className={link}>
          Back to requests
        </Link>
      </p>
    </section>
  );
}
