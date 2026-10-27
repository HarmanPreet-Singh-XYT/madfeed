import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { impactLine } from "@/lib/format";
import { isUuid } from "@/lib/text";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SaveViewForm } from "@/components/save-view-form";
import { btn, field } from "@/components/ui";
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

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Requests</h1>
        <p className="text-muted-foreground">
          Everything your customers have asked for, with the exact words behind
          each one.
        </p>
      </div>

      {views.length > 0 ? (
        <nav aria-label="Saved views" className="space-y-2">
          <h2 className="text-sm font-medium">Saved views</h2>
          <ul className="flex flex-wrap gap-2">
            {views.map((v) => {
              const target = href({
                status: v.statusId,
                tag: v.tagId,
                q: v.q,
                sort: v.sort,
              });
              const active = target === href({ status, tag, q, sort });
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={target}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${active ? "border-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
                  >
                    {v.name}
                  </Link>
                  {ws.role !== "viewer" && (v.mine || ws.role === "admin") ? (
                    <ConfirmDelete
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
        className="flex flex-wrap items-end gap-3"
        aria-label="Filter requests"
      >
        <div>
          <label htmlFor="f-q" className="mb-1 block text-sm font-medium">
            Search titles
          </label>
          <input
            id="f-q"
            name="q"
            defaultValue={q}
            maxLength={100}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-sm font-medium">
            Status
          </label>
          <select
            id="f-status"
            name="status"
            defaultValue={status}
            className={field}
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
          <label htmlFor="f-tag" className="mb-1 block text-sm font-medium">
            Tag
          </label>
          <select id="f-tag" name="tag" defaultValue={tag} className={field}>
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
          <label htmlFor="f-sort" className="mb-1 block text-sm font-medium">
            Order by
          </label>
          <select id="f-sort" name="sort" defaultValue={sort} className={field}>
            <option value="newest">Newest</option>
            <option value="value">Most revenue behind it</option>
          </select>
        </div>
        <button type="submit" className={btn}>
          Apply
        </button>
        {customised ? (
          <Link
            href={base}
            className="inline-flex min-h-11 items-center text-sm text-link underline"
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
        <div className={card}>
          <p className="font-medium">No requests yet.</p>
          <p className="mt-1 text-muted-foreground">
            <Link href={`/w/${ws.id}/add`} className={link}>
              Add a conversation
            </Link>{" "}
            and accept what we find to create your first one.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {res.requests.map((r) => (
            <li key={r.id} className={card}>
              <Link
                href={`/w/${ws.id}/requests/${r.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {r.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {r.status.name} · {impactLine(r.impact)} ·{" "}
                {r.impact.evidenceCount}{" "}
                {r.impact.evidenceCount === 1 ? "quote" : "quotes"} · added{" "}
                <LocalTime iso={r.createdAt} />
              </p>
            </li>
          ))}
        </ul>
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
