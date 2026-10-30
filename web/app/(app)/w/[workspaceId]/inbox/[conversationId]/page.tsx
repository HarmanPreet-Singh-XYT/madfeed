import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { AutoRefresh } from "@/components/auto-refresh";
import { ReplyBox } from "@/components/reply-box";
import { MarkRead } from "@/components/mark-read";
import { ConversationSwitcher } from "@/components/conversation-switcher";
import { PersonContext } from "@/components/person-context";
import {
  ConversationControls,
  MessageActions,
} from "@/components/conversation-controls";
import { link } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Conversation" };

type Props = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

const CUSTOMER_FALLBACK =
  "Not in People yet. Import people and they are matched by email.";

const STAGE: Record<string, string> = {
  processing: "Being read for requests…",
  nothing: "Read; no request was suggested from it.",
  waiting: "Suggestions are waiting for a person to review them.",
  linked: "Became feedback on:",
};

export default function ConversationPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Conversation {...props} />
    </Suspense>
  );
}

async function Conversation({ params }: Props) {
  const { workspaceId, conversationId } = await params;
  if (!isUuid(conversationId)) notFound();
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const res = await client.GET(
    "/v1/workspaces/{workspaceId}/conversations/{conversationId}",
    {
      params: { path: { workspaceId: ws.id, conversationId } },
    },
  );
  if (res.response.status === 404) notFound();
  const c = unwrap(res);
  const path = { workspaceId: ws.id };
  const [membersRes, cannedRes, listRes] = await Promise.all([
    client.GET("/v1/workspaces/{workspaceId}/members", { params: { path } }),
    client.GET("/v1/workspaces/{workspaceId}/inbox/canned-replies", {
      params: { path },
    }),
    client.GET("/v1/workspaces/{workspaceId}/conversations", {
      params: { path, query: { state: "open", limit: 20 } },
    }),
  ]);
  const others = listRes.data?.conversations ?? [];
  const person = c.personId
    ? unwrap(
        await client.GET("/v1/workspaces/{workspaceId}/people/{personId}", {
          params: { path: { workspaceId: ws.id, personId: c.personId } },
        }),
      )
    : undefined;
  const theirOtherConversations = c.personId
    ? unwrap(
        await client.GET("/v1/workspaces/{workspaceId}/conversations", {
          params: { path, query: { personId: c.personId, limit: 6 } },
        }),
      ).conversations.filter((x) => x.id !== c.id)
    : [];
  const members = unwrap(membersRes).members;
  const nameOf = (id?: string) =>
    members.find((m) => m.userId === id)?.name ?? "";
  const teammates = members.filter(
    (m) => m.role !== "viewer" && m.userId !== c.assignee,
  );
  const cards = new Map(c.cards.map((x) => [x.messageId, x]));
  const who = c.customerName || c.customerEmail || "A visitor";
  const customerFallback = c.customerEmail
    ? CUSTOMER_FALLBACK
    : "A chat visitor who has not given an email address.";
  return (
    <section className="space-y-4">
      <AutoRefresh />
      <PageHeader
        back={{ href: `/w/${ws.id}/inbox`, label: "Inbox" }}
        title={<>{c.subject || who}</>}
        description={
          <>
            {who}
            {c.customerEmail && c.customerName
              ? ` · ${c.customerEmail}`
              : ""} · {c.channel === "chat" ? "website chat" : "email"} ·{" "}
            {c.state === "open" ? "open" : "closed"}
          </>
        }
        actions={
          <ConversationSwitcher
            workspaceId={ws.id}
            currentId={c.id}
            conversations={others.map((o) => ({
              id: o.id,
              name: o.customerName || o.customerEmail || "A visitor",
              line: o.subject || o.preview,
              unassigned: !o.assignee,
            }))}
          />
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-[13rem_minmax(0,1fr)_16rem]">
        <nav
          aria-label="Open conversations"
          className="hidden lg:order-1 lg:sticky lg:top-0 lg:block"
        >
          <p className="px-2 pb-1.5 text-xs font-semibold text-muted-foreground">
            Open conversations
          </p>
          <ul className="space-y-0.5">
            {others.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/w/${ws.id}/inbox/${o.id}`}
                  aria-current={o.id === c.id ? "page" : undefined}
                  className={`block rounded-lg px-2.5 py-2 text-sm transition-colors ${o.id === c.id ? "bg-card font-medium shadow-xs" : "text-muted-foreground hover:bg-card/70 hover:text-foreground"}`}
                >
                  <span className="flex items-center gap-1.5">
                    {o.assignee ? null : (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-hue-amber"
                      />
                    )}
                    <span className="truncate">
                      {o.customerName || o.customerEmail || "A visitor"}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {o.subject || o.preview}
                  </span>
                  {o.assignee ? null : (
                    <span className="sr-only">nobody has it</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={`/w/${ws.id}/inbox`}
            className="mt-2 block px-2 text-xs text-link underline-offset-2 hover:underline"
          >
            All conversations
          </Link>
        </nav>
        <aside className="order-1 space-y-4 lg:order-3 lg:sticky lg:top-0">
        <Card className="[--card-spacing:0px] p-4">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">This conversation</h2>
            <ConversationControls
              workspaceId={ws.id}
              conversationId={c.id}
              state={c.state}
              assignee={c.assignee}
              mine={c.assignedToMe}
              isAdmin={ws.role === "admin"}
              canWrite={c.canReply}
              assigneeName={nameOf(c.assignee)}
              teammates={teammates.map((m) => ({
                userId: m.userId,
                name: m.name,
              }))}
            />
          </div>
        </Card>

        <Card className="hidden [--card-spacing:0px] space-y-3 p-4 lg:block">
          <h2 className="text-sm font-semibold">Who this is</h2>
          <PersonContext
            workspaceId={ws.id}
            person={person}
            conversations={theirOtherConversations}
            fallback={customerFallback}
          />
        </Card>
        <details className="rounded-xl border border-border bg-card p-4 lg:hidden">
          <summary className="cursor-pointer text-sm font-semibold">
            Who this is
          </summary>
          <div className="mt-3">
            <PersonContext
              workspaceId={ws.id}
              person={person}
              conversations={theirOtherConversations}
              fallback={customerFallback}
            />
          </div>
        </details>
        </aside>
        <div className="order-2 min-w-0 space-y-4 lg:order-2">
          <ol className="space-y-3" aria-label="Messages">
            {c.thread.map((m) => {
              const cardOf = cards.get(m.id);
              const files = m.files ?? [];
              return (
                <li
                  key={m.id}
                  className={`space-y-2 rounded-lg p-3 text-sm ${m.direction === "note" ? "border border-dashed border-input bg-tint-amber" : m.direction === "out" ? "ml-8 border border-transparent bg-tint-blue" : "mr-8 border border-border bg-card"}`}
                >
                  <p className="text-xs font-semibold">
                    {m.direction === "in"
                      ? who
                      : m.direction === "out"
                        ? "Your team"
                        : "Note for the team"}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · <LocalTime iso={m.at} time />
                    </span>
                    {m.direction === "out" && m.state !== "sent" ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        ·{" "}
                        {m.state === "queued" || m.state === "sending"
                          ? "on its way"
                          : "not sent"}
                      </span>
                    ) : null}
                  </p>
                  {files.length > 0 && m.body === "(sent a file)" ? null : (
                    <p className="whitespace-pre-wrap text-[0.9375rem]">
                      {m.body}
                    </p>
                  )}
                  {files.length > 0 ? (
                    <ul className="space-y-1 text-sm" aria-label="Files">
                      {files.map((f) => (
                        <li key={f.id}>
                          <a
                            href={`/api/files/${ws.id}/${c.id}/${f.id}`}
                            className={link}
                          >
                            {f.name}
                          </a>{" "}
                          <span className="text-muted-foreground">
                            ({Math.max(1, Math.round(f.size / 1024))} KB,
                            downloads to your computer)
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.direction === "in" && c.canReply ? (
                    <MessageActions
                      workspaceId={ws.id}
                      conversationId={c.id}
                      messageId={m.id}
                      kind="customer"
                      sentOn={m.sentOn}
                    />
                  ) : null}
                  {m.direction === "out" &&
                  m.state === "failed" &&
                  c.canReply ? (
                    <MessageActions
                      workspaceId={ws.id}
                      conversationId={c.id}
                      messageId={m.id}
                      kind="failed"
                      sentOn={false}
                      error={m.error}
                    />
                  ) : null}
                  {cardOf ? (
                    <div
                      role="group"
                      aria-label="Where this feedback stands"
                      className="rounded-xl border border-border bg-background p-3 text-sm"
                    >
                      <p>{STAGE[cardOf.stage]}</p>
                      {cardOf.stage === "waiting" ? (
                        <Link href={`/w/${ws.id}/review`} className={link}>
                          Open the review queue
                        </Link>
                      ) : null}
                      {cardOf.requests.length > 0 ? (
                        <ul className="mt-1 space-y-1">
                          {cardOf.requests.map((r) => (
                            <li key={r.id}>
                              <Link
                                href={`/w/${ws.id}/requests/${r.id}`}
                                className={link}
                              >
                                {r.title}
                              </Link>{" "}
                              <span className="text-muted-foreground">
                                · status: {r.status || "none yet"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <MarkRead
            workspaceId={ws.id}
            conversationId={c.id}
            lastMessageId={c.lastMessageId}
          />
          {c.canReply ? (
            <Card className="[--card-spacing:0px] p-3">
              <ReplyBox
                workspaceId={ws.id}
                conversationId={c.id}
                lastMessageId={c.lastMessageId}
                channel={c.channel}
                canned={unwrap(cannedRes).replies}
              />
            </Card>
          ) : (
            <p className="text-muted-foreground">
              Viewers can read conversations but not answer them.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
