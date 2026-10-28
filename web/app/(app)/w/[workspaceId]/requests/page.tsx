import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { Search, Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusPill } from "@/components/app/status-pill";
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
import { SaveViewForm } from "@/components/save-view-form";
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
  const input =
    "h-8 rounded-xl border border-input bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground";

  return (
    <section className="space-y-6">
      <PageHeader
        icon={Lightbulb}
        hue="blue"
        title="Requests"
        description="Everything your customers have asked for, with the exact words behind each one."
      />

      {views.length > 0 ? (
        <nav aria-label="Saved views" className="-mb-2">
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
                <li key={v.id} className="flex items-center">
                  <Link
                    href={target}
                    aria-current={active ? "page" : undefined}
                    className={`${tab} ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {v.name}
                  </Link>
                  {ws.role !== "viewer" && (v.mine || ws.role === "admin") ? (
                    <ConfirmDelete
                      compact
                      label={`Remove view ${v.name}`}
                      consequences={`Remove the saved view “${v.name}” for everyone? Your requests are not affected.`}
                      confirmLabel="Yes, remove it"
                      action={deleteViewAction.bind(null, ws.id, v.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <form
        key={href({ status, tag, q, sort })}
        method="get"
        action={base}
        className="flex flex-wrap items-center gap-2"
        aria-label="Filter requests"
      >
        <div className="relative min-w-48 flex-1">
          <label htmlFor="f-q" className="sr-only">
            Search titles
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="f-q"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Search titles"
            className={`${input} w-full pl-8`}
          />
        </div>
        <div>
          <label htmlFor="f-status" className="sr-only">
            Status
          </label>
          <select
            id="f-status"
            name="status"
            defaultValue={status}
            className={input}
          >
            <option value="">Any status</option>
            {statuses.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-tag" className="sr-only">
            Tag
          </label>
          <select id="f-tag" name="tag" defaultValue={tag} className={input}>
            <option value="">Any tag</option>
            {tags
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-sort" className="sr-only">
            Order by
          </label>
          <select id="f-sort" name="sort" defaultValue={sort} className={input}>
            <option value="newest">Newest</option>
            <option value="value">Most revenue behind it</option>
          </select>
        </div>
        <button
          type="submit"
          className="h-8 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          Apply
        </button>
        {customised ? (
          <Link
            href={base}
            className="inline-flex min-h-8 items-center px-1 text-sm text-link underline"
          >
            Clear filters
          </Link>
        ) : null}
      </form>

      {customised && ws.role !== "viewer" ? (
        <SaveViewForm
          workspaceId={ws.id}
          status={status}
          tag={tag}
          q={q}
          sort={sort}
        />
      ) : null}

      {res.requests.length === 0 && filtered ? (
        <div className={card}>
          <p className="font-medium">No requests match these filters.</p>
          <p className="mt-1 text-muted-foreground">
            Try fewer filters, or{" "}
            <Link href={base} className={link}>
              clear them
            </Link>
            .
          </p>
        </div>
      ) : res.requests.length === 0 ? (
        <EmptyState icon={Lightbulb} title="No requests yet.">
          <Link href={`/w/${ws.id}/add`} className={link}>
            Add a conversation
          </Link>{" "}
          and accept what we find to create your first one.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="h-11 px-5 text-xs font-semibold tracking-wider uppercase">
                  Request
                </TableHead>
                <TableHead className="h-9 text-xs font-medium text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="hidden h-9 text-right text-xs font-medium text-muted-foreground sm:table-cell">
                  People
                </TableHead>
                <TableHead className="hidden h-9 text-right text-xs font-medium text-muted-foreground md:table-cell">
                  Accounts
                </TableHead>
                <TableHead className="h-9 text-right text-xs font-medium text-muted-foreground">
                  Revenue
                </TableHead>
                <TableHead className="hidden h-9 text-right text-xs font-medium text-muted-foreground md:table-cell">
                  Quotes
                </TableHead>
                <TableHead className="hidden h-9 pr-5 text-right text-xs font-medium text-muted-foreground lg:table-cell">
                  Added
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.requests.map((r) => (
                <TableRow key={r.id} className="group">
                  <TableCell className="max-w-0 min-w-56 px-4 py-2 whitespace-normal">
                    <Link
                      href={`/w/${ws.id}/requests/${r.id}`}
                      className="font-medium underline-offset-2 group-hover:text-link hover:underline"
                    >
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusPill name={r.status.name} bucket={r.status.bucket} />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {r.impact.peopleCount}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {r.impact.accountCount}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {r.impact.accountsWithValue > 0 ? (
                      formatValue(r.impact.totalValue)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {r.impact.evidenceCount}
                  </TableCell>
                  <TableCell className="hidden pr-5 text-right text-muted-foreground lg:table-cell">
                    <LocalTime iso={r.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
