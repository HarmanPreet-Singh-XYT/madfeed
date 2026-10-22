import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";

export const metadata = { title: "Requests" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ cursor?: string }>;
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
  const { cursor } = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const res = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/requests", {
      params: {
        path: { workspaceId: ws.id },
        query: { limit: 25, ...(cursor ? { cursor } : {}) },
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
                {r.evidenceCount}{" "}
                {r.evidenceCount === 1 ? "customer quote" : "customer quotes"} ·
                added {new Date(r.createdAt).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      {res.nextCursor ? (
        <Link
          href={`/w/${ws.id}/requests?cursor=${encodeURIComponent(res.nextCursor)}`}
          className={link}
        >
          Older requests
        </Link>
      ) : null}
    </section>
  );
}
