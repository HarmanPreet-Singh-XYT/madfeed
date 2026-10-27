import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getSource, getWorkspace } from "@/lib/server/queries";
import { Quote } from "@/components/quote";
import { Brief } from "@/components/brief";
import { StatusForm } from "@/components/status-form";
import { RequestTags } from "@/components/request-tags";
import { PublicToggle } from "@/components/public-toggle";
import { IssueBox } from "@/components/issue-box";
import { impactLine } from "@/lib/format";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { isUuid } from "@/lib/text";
import { LocalTime } from "@/components/local-time";

type Props = { params: Promise<{ workspaceId: string; requestId: string }> };

const TRACKER_KINDS: string[] = [
  "github",
  "linear",
  "jira",
  "clickup",
  "asana",
  "azuredevops",
];

export default function RequestPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <RequestDetail {...props} />
    </Suspense>
  );
}

export async function generateMetadata() {
  return { title: "Request" };
}

async function RequestDetail({ params }: Props) {
  const { workspaceId, requestId } = await params;
  const ws = await getWorkspace(workspaceId);
  if (!isUuid(requestId)) notFound();
  const client = await api();
  const res = await client.GET(
    "/v1/workspaces/{workspaceId}/requests/{requestId}",
    { params: { path: { workspaceId: ws.id, requestId } } },
  );
  if (res.response.status === 404) notFound();
  const req = unwrap(res);
  // The brief is optional: a 404 just means nobody asked for one yet.
  const { statuses } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/statuses", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const { tags: allTags } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/tags", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const briefRes = await client.GET(
    "/v1/workspaces/{workspaceId}/requests/{requestId}/brief",
    { params: { path: { workspaceId: ws.id, requestId } } },
  );
  const brief = briefRes.response.status === 404 ? undefined : unwrap(briefRes);
  const briefSourceIds = brief?.quotes.map((q) => q.sourceItemId) ?? [];
  const sources = new Map(
    await Promise.all(
      [
        ...new Set([
          ...req.evidence.map((e) => e.sourceItemId),
          ...briefSourceIds,
        ]),
      ].map(async (id) => [id, await getSource(ws.id, id)] as const),
    ),
  );

  const settings = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/settings", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const slug = settings.publicSlug ?? undefined;
  // The linked issue, and whether a repository is connected (only admins can ask the latter, so members
  // learn it by trying; a request that already has an issue shows it either way).
  const issueRes = await client.GET(
    "/v1/workspaces/{workspaceId}/requests/{requestId}/issue",
    { params: { path: { workspaceId: ws.id, requestId } } },
  );
  const issue = issueRes.data;
  let issueConnected = false;
  if (ws.role === "admin" && !issue) {
    const conns = await client.GET(
      "/v1/workspaces/{workspaceId}/integrations",
      {
        params: { path: { workspaceId: ws.id } },
      },
    );
    issueConnected = Boolean(
      conns.data?.integrations.some(
        (i) =>
          TRACKER_KINDS.includes(i.kind) &&
          i.state === "connected" &&
          conns.data?.enabledKinds.includes(i.kind),
      ),
    );
  } else if (!issue) {
    issueConnected = true; // members and editors see the button; the server says no if nothing is connected
  }

  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/requests`} className={link}>
          ← All requests
        </Link>
      </p>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{req.title}</h1>
        <p className="text-sm text-muted-foreground">
          {impactLine(req.impact)} · {req.evidence.length}{" "}
          {req.evidence.length === 1 ? "customer quote" : "customer quotes"} ·
          added <LocalTime iso={req.createdAt} />
          {req.public
            ? ` · ${req.voteCount} public ${req.voteCount === 1 ? "vote" : "votes"}${req.verifiedVoteCount > 0 ? ` (${req.verifiedVoteCount} from verified customers)` : ""}`
            : ""}
        </p>
      </div>

      {ws.role !== "viewer" ? (
        <StatusForm
          workspaceId={ws.id}
          requestId={req.id}
          current={req.status}
          statuses={statuses}
          openBatchId={req.openBatchId}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Status: {req.status.name}</p>
      )}

      <RequestTags
        workspaceId={ws.id}
        requestId={req.id}
        all={allTags.filter((t) => !t.archived)}
        current={req.tags}
        canEdit={ws.role !== "viewer"}
      />

      {ws.role !== "viewer" ? (
        <IssueBox
          workspaceId={ws.id}
          requestId={req.id}
          issue={issue}
          connected={issueConnected}
        />
      ) : null}

      {ws.role === "admin" ? (
        <PublicToggle
          workspaceId={ws.id}
          requestId={req.id}
          isPublic={req.public}
          publicTitle={req.publicTitle}
          summary={req.publicSummary}
          slug={slug}
        />
      ) : null}

      {req.verifiedVoters.length > 0 ? (
        <div className={`${card} space-y-1`}>
          <h2 className="text-lg font-medium">Customers who voted</h2>
          <ul className="text-sm text-muted-foreground">
            {req.verifiedVoters.map((v) => (
              <li key={v.personId}>
                {v.name}
                {v.accountName ? ` · ${v.accountName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {req.informed.length > 0 ? (
        <div className={`${card} space-y-1`}>
          <h2 className="text-lg font-medium">Told about this</h2>
          <ul className="text-sm text-muted-foreground">
            {req.informed.map((i) => (
              <li key={i.personId}>
                {i.name} · <LocalTime iso={i.sentAt} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {req.releaseNotes.length > 0 ? (
        <div className={`${card} space-y-1`}>
          <h2 className="text-lg font-medium">In release notes</h2>
          <ul className="text-sm">
            {req.releaseNotes.map((n) => (
              <li key={n.id}>
                <Link href={`/w/${ws.id}/releases/${n.id}`} className={link}>
                  {n.title}
                </Link>{" "}
                <span className="text-muted-foreground">({n.state})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Brief
        brief={brief}
        sources={new Map([...sources].map(([id, src]) => [id, src.text]))}
        workspaceId={ws.id}
        requestId={req.id}
        canEdit={ws.role !== "viewer"}
        hasEvidence={req.evidence.length > 0}
      />

      <h2 className="text-lg font-medium">What customers said</h2>
      {req.evidence.length === 0 ? (
        <p className="text-muted-foreground">There is no evidence on this request yet.</p>
      ) : (
        <ul className="space-y-4">
          {req.evidence.map((ev) => (
            <li key={ev.id} className={`${card} space-y-3`}>
              <Quote
                text={sources.get(ev.sourceItemId)?.text}
                start={ev.spanStart}
                end={ev.spanEnd}
                quote={ev.quote}
              />
              <p className="text-sm">
                <Link
                  href={`/w/${ws.id}/sources/${ev.sourceItemId}?s=${ev.spanStart}&e=${ev.spanEnd}#quote`}
                  className={link}
                >
                  See it in the full conversation
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
