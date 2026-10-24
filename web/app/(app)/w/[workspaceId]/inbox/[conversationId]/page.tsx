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
  const res = await (
    await api()
  ).GET("/v1/workspaces/{workspaceId}/conversations/{conversationId}", {
    params: { path: { workspaceId: ws.id, conversationId } },
  });
  if (res.response.status === 404) notFound();
  const c = unwrap(res);
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
        <p className="text-muted">
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
        />
      </div>
      <ol className="space-y-4" aria-label="Messages">
        {c.thread.map((m) => {
          const cardOf = cards.get(m.id);
          return (
            <li
              key={m.id}
              className={`space-y-2 rounded-md border p-3 ${m.direction === "note" ? "border-dashed border-border bg-surface" : m.direction === "out" ? "border-border ml-6" : "border-border"}`}
            >
              <p className="text-sm font-medium">
                {m.direction === "in"
                  ? who
                  : m.direction === "out"
                    ? "Your team"
                    : "Note for the team"}
                <span className="font-normal text-muted">
                  {" "}
                  · {new Date(m.at).toLocaleString()}
                </span>
                {m.direction === "out" && m.state !== "sent" ? (
                  <span className="font-normal text-muted">
                    {" "}
                    ·{" "}
                    {m.state === "queued" || m.state === "sending"
                      ? "on its way"
                      : "not sent"}
                  </span>
                ) : null}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
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
                          <span className="text-muted">
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
          />
        </div>
      ) : (
        <p className="text-muted">
          Viewers can read conversations but not answer them.
        </p>
      )}
    </section>
  );
}
