import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { OutreachReview } from "@/components/outreach-review";
import { SourceStatus } from "@/components/source-status";
import { plural } from "@/lib/format";
import { isUuid } from "@/lib/text";
import { PageHeader } from "@/components/app/page-header";

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
  const companies = new Set(
    b.messages.map((m) => m.accountName).filter(Boolean),
  ).size;
  const sent = b.messages.filter((m) => m.state === "sent").length;
  const failed = b.messages.filter((m) => m.state === "failed").length;

  return (
    <section className="space-y-5">
      <PageHeader
        back={{ href: `/w/${ws.id}/outreach`, label: "All messages" }}
        title={
          <Link
            href={`/w/${ws.id}/requests/${b.requestId}`}
            className="underline-offset-4 hover:underline"
          >
            {b.requestTitle}
          </Link>
        }
        description={
          <>
            {b.state === "drafting"
              ? "Writing a personal message for each person who asked…"
              : b.state === "review"
                ? "Read each message, change anything you like, and leave out anyone you don't want to write to. Nothing has been sent."
                : b.state === "approved"
                  ? "Approved. The messages are being sent."
                  : b.state === "done"
                    ? "All done."
                    : "This batch was cancelled."}
            <span className="mt-1 block text-sm text-on-brand/90">
              {plural(b.messages.length, "person", "people")}
              {companies > 0
                ? ` · ${plural(companies, "company", "companies")}`
                : ""}
              {sent > 0 ? ` · ${sent} sent` : ""}
              {failed > 0 ? ` · ${failed} failed` : ""}
            </span>
          </>
        }
      />

      <SourceStatus state={working ? "pending" : "done"}>
        {working ? (
          <p className="text-sm text-muted-foreground">
            {b.state === "drafting" ? "Drafting…" : "Sending…"}
          </p>
        ) : null}
      </SourceStatus>

      <OutreachReview
        workspaceId={ws.id}
        batch={b}
        canEdit={canEdit}
        senderName={sender}
        senderAddress={settings.senderAddress}
        replyTo={settings.replyTo}
        emailConfigured={settings.emailConfigured ?? false}
      />
    </section>
  );
}
