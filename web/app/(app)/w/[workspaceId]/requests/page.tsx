import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatValue } from "@/lib/format";
import { isUuid } from "@/lib/text";
import { ConfirmDelete } from "@/components/confirm-delete";
import { InlineStatus } from "@/components/inline-status";
import { InlineTags } from "@/components/inline-tags";
import { RequestFilters } from "@/components/request-filters";
import { deleteViewAction } from "./view-actions";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Requests" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    cursor?: string;
    sort?: string;
    status?: string;
    tag?: string;
    q?: string;
  }>;
};

export default function RequestsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Requests {...props} />
    </Suspense>
  );
}

async function Requests({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { cursor } = sp;
  const sort = sp.sort === "value" ? "value" : "newest";
  const status = sp.status && isUuid(sp.status) ? sp.status : "";
  const tag = sp.tag && isUuid(sp.tag) ? sp.tag : "";
  const q = (sp.q ?? "").slice(0, 100).trim();
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const [res, { statuses }, { tags }, { views }] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/requests", {
        params: {
          path: { workspaceId: ws.id },
          query: {
            limit: 25,
            sort,
            ...(cursor ? { cursor } : {}),
            ...(status ? { statusId: status } : {}),
            ...(tag ? { tagId: tag } : {}),
            ...(q ? { q } : {}),
          },
        },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/statuses", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/tags", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/views", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
  ]);
  const base = `/w/${ws.id}/requests`;
  const href = (f: {
    status?: string;
    tag?: string;
    q?: string;
    sort?: string;
  }) => {
    const p = new URLSearchParams();
    if (f.status) p.set("status", f.status);
    if (f.tag) p.set("tag", f.tag);
    if (f.q) p.set("q", f.q);
    if (f.sort && f.sort !== "newest") p.set("sort", f.sort);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const filtered = Boolean(status || tag || q);
  const customised = filtered || sort !== "newest";

  const tab =
    "inline-flex min-h-9 items-center border-b-2 px-3 text-sm font-medium transition-colors";
  const canEdit = ws.role !== "viewer";
  const liveTags = tags.filter((t) => !t.archived);
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const accounts = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`;
  const quotes = (n: number) => `${n} ${n === 1 ? "quote" : "quotes"}`;

  return (
    <section className="space-y-4">
      <PageHeader
        title="Requests"
        description="Everything your customers have asked for, with the exact words behind each one."
      />

      {views.length > 0 ? (
        <nav aria-label="Saved views">
          <ul className="flex flex-wrap items-center gap-x-1 border-b border-border">
            <li>
              <Link
                href={base}
                aria-current={!customised ? "page" : undefined}
                className={`${tab} ${!customised ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                All requests
              </Link>
            </li>
            {views.map((v) => {
              const target = href({
                status: v.statusId,
                tag: v.tagId,
                q: v.q,
                sort: v.sort,
              });
              const active = target === href({ status, tag, q, sort });
              return (
                <li key={v.id} className="group/view flex items-center">
                  <Link
                    href={target}
                    aria-current={active ? "page" : undefined}
                    className={`${tab} ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {v.name}
                  </Link>
                  {canEdit && (v.mine || ws.role === "admin") ? (
                    <span className="opacity-0 transition-opacity group-focus-within/view:opacity-100 group-hover/view:opacity-100 pointer-coarse:opacity-100">
                      <ConfirmDelete
                        compact
                        label={`Remove view ${v.name}`}
                        consequences={`Remove the saved view “${v.name}” for everyone? Your requests are not affected.`}
                        confirmLabel="Yes, remove it"
                        action={deleteViewAction.bind(null, ws.id, v.id)}
                      />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <RequestFilters
        workspaceId={ws.id}
        base={base}
        filters={{ status, tag, q, sort }}
        statuses={statuses.map((st) => ({ id: st.id, name: st.name }))}
        tags={liveTags.map((t) => ({ id: t.id, name: t.name }))}
        canSave={customised && canEdit}
      />

      {res.requests.length === 0 && filtered ? (
        <Panel>
          <p className="font-medium">No requests match these filters.</p>
          <p className="mt-1 text-muted-foreground">
            Try fewer filters, or{" "}
            <Link href={base} className={link}>
              clear them
            </Link>
            .
          </p>
        </Panel>
      ) : res.requests.length === 0 ? (
        <EmptyState icon={Lightbulb} title="No requests yet.">
          <Link href={`/w/${ws.id}/add`} className={link}>
            Add a conversation
          </Link>{" "}
          and accept what we find to create your first one.
        </EmptyState>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div
            role="region"
            aria-label="Requests, scrolls sideways on small screens"
            tabIndex={0}
            className="overflow-x-auto"
          >
            <Table className="text-sm" containerClassName="overflow-visible">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="h-9 px-4 text-xs font-medium text-muted-foreground">
                    Request
                  </TableHead>
                  <TableHead className="hidden h-9 text-xs font-medium text-muted-foreground md:table-cell">
                    Tags
                  </TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="hidden h-9 text-right text-xs font-medium text-muted-foreground sm:table-cell">
                    Revenue
                  </TableHead>
                  <TableHead className="hidden h-9 pr-4 text-right text-xs font-medium text-muted-foreground md:table-cell">
                    Added
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {res.requests.map((r) => (
                  <TableRow key={r.id} className="group">
                    <TableCell className="max-w-0 min-w-56 px-4 py-2.5 whitespace-normal">
                      <Link
                        href={`/w/${ws.id}/requests/${r.id}`}
                        className="font-medium underline-offset-2 group-hover:text-link hover:underline"
                      >
                        {r.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {people(r.impact.peopleCount)} ·{" "}
                        {accounts(r.impact.accountCount)} ·{" "}
                        {quotes(r.impact.evidenceCount)}
                        {r.impact.accountsWithValue > 0 ? (
                          <span className="sm:hidden">
                            {" "}
                            · {formatValue(r.impact.totalValue)} revenue
                          </span>
                        ) : null}
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <InlineTags
                        workspaceId={ws.id}
                        requestId={r.id}
                        requestTitle={r.title}
                        current={r.tags}
                        all={liveTags}
                        canEdit={canEdit}
                      />
                    </TableCell>
                    <TableCell>
                      <InlineStatus
                        workspaceId={ws.id}
                        requestId={r.id}
                        requestTitle={r.title}
                        current={r.status}
                        statuses={statuses}
                        canEdit={canEdit}
                      />
                    </TableCell>
                    <TableCell className="hidden text-right font-medium tabular-nums sm:table-cell">
                      {r.impact.accountsWithValue > 0 ? (
                        formatValue(r.impact.totalValue)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden pr-4 text-right text-muted-foreground md:table-cell">
                      <LocalTime iso={r.createdAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {res.nextCursor ? (
        <Link
          href={`${href({ status, tag, q, sort })}${href({ status, tag, q, sort }).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(res.nextCursor)}`}
          className={link}
        >
          Older requests
        </Link>
      ) : null}
    </section>
  );
}
