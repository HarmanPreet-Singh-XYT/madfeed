import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { OutreachMessage } from "@/components/outreach-message";
import { OutreachApprove } from "@/components/outreach-approve";
import { SourceStatus } from "@/components/source-status";
import { card, link } from "@/components/ui";
import { plural } from "@/lib/format";
import { isUuid } from "@/lib/text";

export const metadata = { title: "Messages to review" };

type Props = { params: Promise<{ workspaceId: string; batchId: string }> };

export default function BatchPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Batch {...props} />
    </Suspense>
  );
}

async function Batch({ params }: Props) {
  const { workspaceId, batchId } = await params;
  const ws = await getWorkspace(workspaceId);
  if (!isUuid(batchId)) notFound();
  const client = await api();
  const res = await client.GET(
    "/v1/workspaces/{workspaceId}/outreach/{batchId}",
    { params: { path: { workspaceId: ws.id, batchId } } },
  );
  if (res.response.status === 404) notFound();
  const b = unwrap(res);
  const settings = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/settings", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const sender = settings.senderName || settings.name;
  const canEdit = ws.role !== "viewer";
  const working = b.state === "drafting" || b.state === "approved";

  // Group by company so the reviewer sees who is at the same place.
  const groups = new Map<string, typeof b.messages>();
  for (const m of b.messages) {
    const key = m.accountName ?? "";
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/outreach`} className={link}>
          ← All messages
        </Link>
      </p>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{b.requestTitle}</h1>
        <p className="text-muted-foreground">
          {b.state === "drafting"
            ? "Writing a personal message for each person who asked…"
            : b.state === "review"
              ? "Read each message, change anything you like, and leave out anyone you don't want to write to. Nothing has been sent."
              : b.state === "approved"
                ? "Approved. The messages are being sent."
                : b.state === "done"
                  ? "All done."
                  : "This batch was cancelled."}
        </p>
      </div>

      <SourceStatus state={working ? "pending" : "done"}>
        {working ? (
          <p className="text-sm text-muted-foreground">
            {b.state === "drafting" ? "Drafting…" : "Sending…"}
          </p>
        ) : null}
      </SourceStatus>

      {b.noEmail > 0 || b.anonymousQuotes > 0 ? (
        <div role="note" className={`${card} space-y-1 text-sm`}>
          <p className="font-medium">People we can&apos;t write to</p>
          {b.noEmail > 0 ? (
            <p className="text-muted-foreground">
              {plural(b.noEmail, "person", "people")} asked for this but we have
              no email address for them.
            </p>
          ) : null}
          {b.anonymousQuotes > 0 ? (
            <p className="text-muted-foreground">
              {plural(b.anonymousQuotes, "quote")} came from someone we
              haven&apos;t recorded, so we can&apos;t tell them.
            </p>
          ) : null}
        </div>
      ) : null}

      {[...groups.entries()].map(([account, messages]) => (
        <div key={account || "none"} className="space-y-3">
          <h2 className="text-lg font-medium">
            {account || "No company recorded"}
          </h2>
          <ul className="space-y-4">
            {messages.map((m) => (
              <OutreachMessage
                key={m.id}
                workspaceId={ws.id}
                batchId={b.id}
                batchState={b.state}
                message={m}
                canEdit={canEdit}
              />
            ))}
          </ul>
        </div>
      ))}

      {b.state === "review" && canEdit ? (
        <OutreachApprove
          workspaceId={ws.id}
          batchId={b.id}
          ready={b.readyToSend}
          senderName={sender}
        />
      ) : null}
    </section>
  );
}
