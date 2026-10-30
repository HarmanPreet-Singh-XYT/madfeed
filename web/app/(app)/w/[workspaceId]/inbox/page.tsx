import { Suspense } from "react";
import Link from "next/link";
import { Inbox as InboxIcon } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { isUuid } from "@/lib/text";
import { getWorkspace } from "@/lib/server/queries";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConversationList } from "@/components/conversation-list";
import { InboxFilters } from "@/components/inbox-filters";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { link } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "Inbox" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";

function minutes(m: number) {
  if (m < 1) return "under a minute";
  if (m < 90) return `${Math.round(m)} minutes`;
  if (m < 60 * 36) return `${Math.round(m / 60)} hours`;
  return `${Math.round(m / 1440)} days`;
}

export default function InboxPage(props: Props) {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <Inbox {...props} />
    </Suspense>
  );
}

async function Inbox({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const view = ["unread", "mine", "unassigned", "closed"].includes(one(sp.view))
    ? one(sp.view)
    : "open";
  const q = one(sp.q).trim().slice(0, 100);
  const channel: "chat" | "email" | undefined = ["chat", "email"].includes(
    one(sp.channel),
  )
    ? (one(sp.channel) as "chat" | "email")
    : undefined;
  const assigneeParam = one(sp.assignee);
  const assigneeId = isUuid(assigneeParam) ? assigneeParam : undefined;
  const nobody = assigneeParam === "nobody";
  const afterAt = one(sp.afterAt);
  const afterId = one(sp.afterId);
  const client = await api();
  const path = { workspaceId: ws.id };
  const [statsRes, membersRes] = await Promise.all([
    client.GET("/v1/workspaces/{workspaceId}/inbox/stats", {
      params: {
        path,
        query: { ...(channel ? { channel } : {}), ...(assigneeId ? { assignee: assigneeId } : {}) },
      },
    }),
    client.GET("/v1/workspaces/{workspaceId}/members", { params: { path } }),
  ]);
  const stats = unwrap(statsRes);
  const members = unwrap(membersRes).members;
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const res = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/conversations", {
      params: {
        path: { workspaceId: ws.id },
        query: {
          state: view === "closed" ? "closed" : "open",
          mine: view === "mine" || undefined,
          unassigned: view === "unassigned" || nobody || undefined,
          unread: view === "unread" || undefined,
          ...(channel ? { channel } : {}),
          ...(assigneeId ? { assignee: assigneeId } : {}),
          ...(q ? { q } : {}),
          limit: 30,
          ...(afterAt &&
          /^[0-9a-f-]{36}$/.test(afterId) &&
          !Number.isNaN(Date.parse(afterAt))
            ? { afterAt: new Date(afterAt).toISOString(), afterId }
            : {}),
        },
      },
    }),
  );

  const base = `/w/${ws.id}/inbox`;
  /** A link that keeps the search, so switching tabs does not silently widen it. */
  const href = (next: { view?: string; q?: string; cursor?: boolean }) => {
    const p = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== "open") p.set("view", v);
    const words = next.q ?? q;
    if (words) p.set("q", words);
    if (channel) p.set("channel", channel);
    if (assigneeParam) p.set("assignee", assigneeParam);
    if (next.cursor && res.next) {
      p.set("afterAt", res.next.at);
      p.set("afterId", res.next.id);
    }
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  const tabs = [
    ["open", "Open", stats.open],
    ["unread", "Unread", stats.unread],
    ["mine", "Mine", stats.mine],
    ["unassigned", "Nobody's", stats.unassigned],
    ["closed", "Closed", stats.closed],
  ] as const;
  const inTab = tabs.find(([id]) => id === view)?.[2] ?? 0;
  const tab =
    "inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors";

  return (
    <section className="space-y-4">
      <AutoRefresh />
      <PageHeader
        title="Inbox"
        description="Conversations from your website chat and from email, in one place. Send a customer's message on to the review queue and it can become a request, with the customer's own words attached."
      />
      <Card asChild className="[--card-spacing:0px] p-0">
        <dl
          aria-label="How the desk is doing"
          className="grid grid-cols-2 divide-border sm:grid-cols-3 sm:divide-x"
        >
          <div className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">
              Typical first answer
            </dt>
            <dd className="text-lg font-semibold tracking-tight">
              {stats.answered > 0 ? minutes(stats.medianMinutes) : "—"}
            </dd>
            <dd className="hidden text-xs text-muted-foreground sm:block">
              {stats.answered > 0
                ? `First answer in ${minutes(stats.medianMinutes)} typically (nine in ten within ${minutes(stats.p90Minutes)}), over the last ${stats.days} days.`
                : `No conversations answered in the last ${stats.days} days yet.`}
            </dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">
              Waiting for an answer
            </dt>
            <dd className="text-lg font-semibold tracking-tight tabular-nums">
              {stats.waiting}
            </dd>
            <dd className="hidden text-xs text-muted-foreground sm:block">
              {stats.waiting === 0
                ? "Nobody is waiting for an answer."
                : `${stats.waiting} waiting for an answer, the longest for ${minutes(stats.oldestWaitingMinutes)}.`}
              {stats.targetHours > 0 && stats.overTarget > 0
                ? ` ${stats.overTarget} past your ${stats.targetHours}-hour target.`
                : ""}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col justify-center border-t border-border px-4 py-3 text-sm sm:col-span-1 sm:border-t-0">
            <dt className="sr-only">Desk settings</dt>
            <dd>
              <Link href={`${base}/desk`} className={link}>
                Your name, saved replies and target
              </Link>
            </dd>
          </div>
        </dl>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
      <form
        action={base}
        method="get"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
      >
        {view !== "open" ? (
          <input type="hidden" name="view" value={view} />
        ) : null}
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search people and messages"
          aria-label="Search conversations"
          className="min-h-11 min-w-0 flex-1 sm:max-w-64"
        />
        <Button type="submit" variant="outline" className="min-h-11">
          Search
        </Button>
        {q ? (
          <Button asChild variant="ghost" className="min-h-11">
            <Link href={href({ q: "" })}>Clear</Link>
          </Button>
        ) : null}
        {q ? (
          <span className="text-sm text-muted-foreground">
            {res.conversations.length} of {inTab}
          </span>
        ) : null}
      </form>
      <InboxFilters
        base={base}
        view={view}
        q={q}
        channel={channel ?? ""}
        assignee={assigneeParam}
        members={members.map((m) => ({ id: m.userId, name: m.name }))}
      />
      </div>

      <nav aria-label="Which conversations">
        <ul className="flex flex-wrap items-center gap-x-1 border-b border-border">
          {tabs.map(([id, label, count]) => (
            <li key={id}>
              <Link
                href={href({ view: id })}
                aria-current={view === id ? "page" : undefined}
                className={`${tab} ${view === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {label}
                <span
                  className={`rounded-full px-1.5 text-xs tabular-nums ${view === id ? "bg-tint-blue text-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {res.conversations.length === 0 ? (
        <Empty
          q={q}
          view={view}
          base={base}
          clearHref={href({ q: "" })}
          settingsHref={`/w/${ws.id}/settings?tab=customers#inbox-website-chat-and-email`}
        />
      ) : (
        <ConversationList
          workspaceId={ws.id}
          conversations={res.conversations}
          names={Object.fromEntries(names)}
          canWrite={ws.role !== "viewer"}
        />
      )}

      {res.next ? (
        <Button asChild variant="outline">
          <Link href={href({ cursor: true })}>Older conversations</Link>
        </Button>
      ) : null}
    </section>
  );
}

function Empty({
  q,
  view,
  base,
  clearHref,
  settingsHref,
}: {
  q: string;
  view: string;
  base: string;
  clearHref: string;
  settingsHref: string;
}) {
  if (q) {
    return (
      <EmptyState
        icon={InboxIcon}
        title={`No conversations match “${q}”.`}
        actions={
          <Button asChild variant="outline">
            <Link href={clearHref}>Clear the search</Link>
          </Button>
        }
      >
        The words in the customer, the subject and the newest message are
        searched.
      </EmptyState>
    );
  }
  if (view === "unread") {
    return (
      <EmptyState
        icon={InboxIcon}
        title="Nothing unread."
        actions={
          <Button asChild variant="outline">
            <Link href={base}>Show everything open</Link>
          </Button>
        }
      >
        You have seen the newest message in every open conversation.
      </EmptyState>
    );
  }
  if (view === "closed") {
    return (
      <EmptyState
        icon={InboxIcon}
        title="No closed conversations."
        actions={
          <Button asChild variant="outline">
            <Link href={base}>Show what is open</Link>
          </Button>
        }
      >
        Closing a conversation keeps it here, with its whole thread.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={InboxIcon}
      title="Nothing waiting."
      actions={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={settingsHref}>Turn on chat or email</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${base}/desk`}>Desk setup</Link>
          </Button>
        </div>
      }
    >
      Conversations from your website chat and your support address show up
      here. Turn on a channel under Settings to start receiving them.
    </EmptyState>
  );
}

function InboxSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading the inbox">
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-11 w-72 rounded-md" />
      <div className="space-y-px">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-3 border-b border-border px-4 py-3"
          >
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
