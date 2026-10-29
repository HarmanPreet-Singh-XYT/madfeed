import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getSource, getWorkspace } from "@/lib/server/queries";
import { Quote } from "@/components/quote";
import { Brief } from "@/components/brief";
import { InlineStatus } from "@/components/inline-status";
import { RequestTags } from "@/components/request-tags";
import { PublicToggle } from "@/components/public-toggle";
import { IssueBox } from "@/components/issue-box";
import { formatValue } from "@/lib/format";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { isUuid } from "@/lib/text";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

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

  const panelSection =
    "space-y-3 py-4 first:pt-0 last:pb-0 empty:hidden [&_select]:w-full [&_textarea]:w-full";
  const canEdit = ws.role !== "viewer";
  const impact = [
    { label: "People", value: String(req.impact.peopleCount) },
    { label: "Accounts", value: String(req.impact.accountCount) },
    {
      label: "Revenue",
      value:
        req.impact.accountsWithValue > 0
          ? formatValue(req.impact.totalValue)
          : "—",
      hint:
        req.impact.accountsWithValue > 0
          ? "each account counted once"
          : "no account values yet",
    },
    { label: "Quotes", value: String(req.evidence.length) },
  ];
  return (
    <section className="space-y-6">
      <PageHeader
        back={{ href: `/w/${ws.id}/requests`, label: "All requests" }}
        title={req.title}
        description={
          <>
            Added <LocalTime iso={req.createdAt} />
            {req.public
              ? ` · ${req.voteCount} public ${req.voteCount === 1 ? "vote" : "votes"}${req.verifiedVoteCount > 0 ? ` (${req.verifiedVoteCount} from verified customers)` : ""}`
              : ""}
          </>
        }
      />

      <Card asChild className="[--card-spacing:0px] p-0">
        <dl
          aria-label="Impact"
          className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x"
        >
          {impact.map((i) => (
            <div key={i.label} className="px-4 py-3">
              <dt className="text-xs text-muted-foreground">{i.label}</dt>
              <dd className="text-xl font-semibold tracking-tight tabular-nums">
                {i.value}
              </dd>
              {i.hint ? (
                <dd className="text-xs text-muted-foreground">{i.hint}</dd>
              ) : null}
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <Brief
            brief={brief}
            sources={new Map([...sources].map(([id, src]) => [id, src.text]))}
            workspaceId={ws.id}
            requestId={req.id}
            canEdit={ws.role !== "viewer"}
            hasEvidence={req.evidence.length > 0}
          />

          <div className="space-y-3">
            <h2 className="text-base font-semibold">What customers said</h2>
            {req.evidence.length === 0 ? (
              <p className="text-muted-foreground">
                There is no evidence on this request yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {req.evidence.map((ev) => (
                  <Card
                    key={ev.id}
                    asChild
                    className="[--card-spacing:0px] p-4"
                  >
                    <li className="space-y-2">
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
                  </Card>
                ))}
              </ul>
            )}
          </div>

          {req.informed.length > 0 ? (
            <Card className="[--card-spacing:0px] space-y-1 p-5">
              <h2 className="font-semibold">Told about this</h2>
              <ul className="text-sm text-muted-foreground">
                {req.informed.map((i) => (
                  <li key={i.personId}>
                    {i.name} · <LocalTime iso={i.sentAt} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {req.releaseNotes.length > 0 ? (
            <Card className="[--card-spacing:0px] space-y-1 p-5">
              <h2 className="font-semibold">In release notes</h2>
              <ul className="text-sm">
                {req.releaseNotes.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/w/${ws.id}/releases/${n.id}`}
                      className={link}
                    >
                      {n.title}
                    </Link>{" "}
                    <span className="text-muted-foreground">({n.state})</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <Card asChild className="[--card-spacing:0px] p-4 lg:sticky lg:top-0">
          <aside aria-label="Request properties" className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              Properties
            </p>
            <div className="divide-y divide-border">
              <div className={panelSection}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Status</span>
                  <InlineStatus
                    workspaceId={ws.id}
                    requestId={req.id}
                    requestTitle={req.title}
                    current={req.status}
                    statuses={statuses}
                    canEdit={canEdit}
                  />
                </div>
                {req.openBatchId ? (
                  <Link
                    href={`/w/${ws.id}/outreach/${req.openBatchId}`}
                    className={`${link} block text-sm`}
                  >
                    Review the messages for the people who asked
                  </Link>
                ) : null}
              </div>
              <div className={panelSection}>
                <RequestTags
                  workspaceId={ws.id}
                  requestId={req.id}
                  all={allTags.filter((t) => !t.archived)}
                  current={req.tags}
                  canEdit={ws.role !== "viewer"}
                />
              </div>
              {ws.role !== "viewer" ? (
                <div className={panelSection}>
                  <IssueBox
                    workspaceId={ws.id}
                    requestId={req.id}
                    issue={issue}
                    connected={issueConnected}
                  />
                </div>
              ) : null}
              {ws.role === "admin" ? (
                <div className={panelSection}>
                  <PublicToggle
                    workspaceId={ws.id}
                    requestId={req.id}
                    isPublic={req.public}
                    publicTitle={req.publicTitle}
                    summary={req.publicSummary}
                    slug={slug}
                  />
                </div>
              ) : null}
              {req.verifiedVoters.length > 0 ? (
                <div className={panelSection}>
                  <h2 className="font-semibold">Customers who voted</h2>
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
            </div>
          </aside>
        </Card>
      </div>
    </section>
  );
}
