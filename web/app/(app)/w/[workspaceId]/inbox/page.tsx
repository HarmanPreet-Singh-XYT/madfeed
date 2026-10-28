import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { AutoRefresh } from "@/components/auto-refresh";
import { link } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { Inbox as InboxIcon } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

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
    <Suspense fallback={<Loading />}>
      <Inbox {...props} />
    </Suspense>
  );
}

async function Inbox({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const view = ["mine", "unassigned", "closed"].includes(one(sp.view))
    ? one(sp.view)
    : "open";
  const afterAt = one(sp.afterAt);
  const afterId = one(sp.afterId);
  const client = await api();
  const path = { workspaceId: ws.id };
  const [statsRes, membersRes] = await Promise.all([
    client.GET("/v1/workspaces/{workspaceId}/inbox/stats", {
      params: { path },
    }),
    client.GET("/v1/workspaces/{workspaceId}/members", { params: { path } }),
  ]);
  const stats = unwrap(statsRes);
  const names = new Map(
    unwrap(membersRes).members.map((m) => [m.userId, m.name]),
  );
  const res = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/conversations", {
      params: {
        path: { workspaceId: ws.id },
        query: {
          state: view === "closed" ? "closed" : "open",
          mine: view === "mine" || undefined,
          unassigned: view === "unassigned" || undefined,
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
  const tabs = [
    ["open", "Open"],
    ["mine", "Mine"],
    ["unassigned", "Nobody's"],
    ["closed", "Closed"],
  ] as const;
  return (
    <section className="space-y-6">
      <AutoRefresh />
      <PageHeader
        icon={InboxIcon}
        hue="blue"
        title="Inbox"
        description="Conversations from your website chat and from email, in one place. Send a customer's message on to the review queue and it can become a request, with the customer's own words attached."
      />
      <div
        className="space-y-1 rounded-lg bg-tint-blue p-3.5 text-sm"
        aria-label="How the desk is doing"
      >
        <p>
          {stats.answered > 0
            ? `First answer in ${minutes(stats.medianMinutes)} typically (nine in ten within ${minutes(stats.p90Minutes)}), over the last ${stats.days} days.`
            : `No conversations answered in the last ${stats.days} days yet.`}
        </p>
        <p>
          {stats.waiting === 0
            ? "Nobody is waiting for an answer."
            : `${stats.waiting} waiting for an answer, the longest for ${minutes(stats.oldestWaitingMinutes)}.`}
          {stats.targetHours > 0 && stats.overTarget > 0
            ? ` ${stats.overTarget} past your ${stats.targetHours}-hour target.`
            : ""}
        </p>
        <p>
          <Link href={`/w/${ws.id}/inbox/desk`} className={link}>
            Your name, saved replies and target
          </Link>
        </p>
      </div>
      <nav
        aria-label="Which conversations"
        className="flex w-fit flex-wrap gap-0.5 rounded-xl bg-secondary p-0.5"
      >
        {tabs.map(([id, label]) => (
          <Link
            key={id}
            href={`/w/${ws.id}/inbox?view=${id}`}
            aria-current={view === id ? "page" : undefined}
            className={`inline-flex min-h-7 items-center rounded px-3 text-sm font-medium transition-all ${view === id ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {res.conversations.length === 0 ? (
        <p className="text-muted-foreground">
          {view === "closed"
            ? "No closed conversations."
            : "Nothing waiting. Turn on the chat or email under Settings to start receiving conversations."}
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Conversations">
          {res.conversations.map((c) => (
            <Card
              key={c.id}
              asChild
              className="[--card-spacing:0px] flex-row gap-3 p-3 transition-colors hover:bg-muted/50"
            >
              <li>
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-link"
                >
                  {(c.customerName || c.customerEmail || "V")
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/w/${ws.id}/inbox/${c.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.customerName || c.customerEmail || "A visitor"}
                    {c.subject ? ` · ${c.subject}` : ""}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {c.channel === "chat" ? "Chat" : "Email"} · {c.messages}{" "}
                    {c.messages === 1 ? "message" : "messages"} ·{" "}
                    <LocalTime iso={c.lastMessageAt} time />
                    {c.assignee
                      ? c.assignedToMe
                        ? " · you have it"
                        : ` · ${names.get(c.assignee) || "a teammate"} has it`
                      : " · nobody has it"}
                  </p>
                  <p className="mt-1 text-sm">{c.preview}</p>
                </div>
              </li>
            </Card>
          ))}
        </ul>
      )}
      {res.next ? (
        <p>
          <Link
            href={`/w/${ws.id}/inbox?view=${view}&afterAt=${encodeURIComponent(res.next.at)}&afterId=${res.next.id}`}
            className={link}
          >
            Older conversations
          </Link>
        </p>
      ) : null}
    </section>
  );
}
