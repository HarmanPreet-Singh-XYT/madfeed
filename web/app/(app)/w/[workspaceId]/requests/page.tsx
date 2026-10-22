import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { impactLine } from "@/lib/format";

export const metadata = { title: "Requests" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ cursor?: string; sort?: string }>;
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
  const { cursor, sort: rawSort } = await searchParams;
  const sort = rawSort === "value" ? "value" : "newest";
  const ws = await getWorkspace(workspaceId);
  const res = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/requests", {
      params: {
        path: { workspaceId: ws.id },
        query: { limit: 25, sort, ...(cursor ? { cursor } : {}) },
      },
    }),
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Requests</h1>
        <p className="text-muted">
          Everything your customers have asked for, with the exact words behind
          each one.
        </p>
      </div>

      <nav aria-label="Order" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Order by</span>
        {(["newest", "value"] as const).map((o) => (
          <Link
            key={o}
            href={`/w/${ws.id}/requests?sort=${o}`}
            aria-current={o === sort ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${o === sort ? "border-foreground" : "border-border text-muted hover:bg-surface"}`}
          >
            {o === "newest" ? "Newest" : "Most revenue behind it"}
          </Link>
        ))}
      </nav>

      {res.requests.length === 0 ? (
        <div className={card}>
          <p className="font-medium">No requests yet.</p>
          <p className="mt-1 text-muted">
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
              <p className="text-sm text-muted">
                {r.status.name} · {impactLine(r.impact)} ·{" "}
                {r.impact.evidenceCount}{" "}
                {r.impact.evidenceCount === 1 ? "quote" : "quotes"} · added{" "}
                {new Date(r.createdAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      {res.nextCursor ? (
        <Link
          href={`/w/${ws.id}/requests?sort=${sort}&cursor=${encodeURIComponent(res.nextCursor)}`}
          className={link}
        >
          Older requests
        </Link>
      ) : null}
    </section>
  );
}
