import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { AutoRefresh } from "@/components/auto-refresh";
import { ReplyBox } from "@/components/reply-box";
import {
  ConversationControls,
  MessageActions,
} from "@/components/conversation-controls";
import { card, link } from "@/components/ui";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Conversation" };

type Props = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};

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
  const [membersRes, cannedRes] = await Promise.all([
    client.GET("/v1/workspaces/{workspaceId}/members", { params: { path } }),
    client.GET("/v1/workspaces/{workspaceId}/inbox/canned-replies", {
      params: { path },
    }),
  ]);
  const members = unwrap(membersRes).members;
  const nameOf = (id?: string) =>
    members.find((m) => m.userId === id)?.name ?? "";
  const teammates = members.filter(
    (m) => m.role !== "viewer" && m.userId !== c.assignee,
  );
  const cards = new Map(c.cards.map((x) => [x.messageId, x]));
  const who = c.customerName || c.customerEmail || "A visitor";
  return (
    <section className="space-y-6">
      <AutoRefresh />
      <p>
        <Link href={`/w/${ws.id}/inbox`} className={link}>
          ← Inbox
        </Link>
      </p>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{c.subject || who}</h1>
        <p className="text-muted-foreground">
          {who}
          {c.customerEmail && c.customerName
            ? ` · ${c.customerEmail}`
            : ""} · {c.channel === "chat" ? "website chat" : "email"} ·{" "}
          {c.state === "open" ? "open" : "closed"}
        </p>
      </div>
      <div className={`${card} space-y-2`}>
        <h2 className="text-lg font-medium">This conversation</h2>
        <ConversationControls
          workspaceId={ws.id}
          conversationId={c.id}
          state={c.state}
          assignee={c.assignee}
          mine={c.assignedToMe}
          isAdmin={ws.role === "admin"}
          canWrite={c.canReply}
          assigneeName={nameOf(c.assignee)}
          teammates={teammates.map((m) => ({ userId: m.userId, name: m.name }))}
        />
      </div>
      <ol className="space-y-4" aria-label="Messages">
        {c.thread.map((m) => {
          const cardOf = cards.get(m.id);
          const files = m.files ?? [];
          return (
            <li
              key={m.id}
              className={`space-y-2 rounded-md border p-3 ${m.direction === "note" ? "border-dashed border-border bg-muted" : m.direction === "out" ? "border-border ml-6" : "border-border"}`}
            >
              <p className="text-sm font-medium">
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
                <p className="whitespace-pre-wrap">{m.body}</p>
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
                        ({Math.max(1, Math.round(f.size / 1024))} KB, downloads
                        to your computer)
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
              {m.direction === "out" && m.state === "failed" && c.canReply ? (
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
                  className="rounded-md border border-border bg-background p-3 text-sm"
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
      {c.canReply ? (
        <div className={card}>
          <ReplyBox
            workspaceId={ws.id}
            conversationId={c.id}
            lastMessageId={c.lastMessageId}
            channel={c.channel}
            canned={unwrap(cannedRes).replies}
          />
        </div>
      ) : (
        <p className="text-muted-foreground">
          Viewers can read conversations but not answer them.
        </p>
      )}
    </section>
  );
}
