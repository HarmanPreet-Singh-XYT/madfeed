import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getSource, getWorkspace } from "@/lib/server/queries";
import { Quote } from "@/components/quote";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { isUuid } from "@/lib/text";

type Props = { params: Promise<{ workspaceId: string; requestId: string }> };

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
  const sources = new Map(
    await Promise.all(
      [...new Set(req.evidence.map((e) => e.sourceItemId))].map(
        async (id) => [id, await getSource(ws.id, id)] as const,
      ),
    ),
  );

  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/requests`} className={link}>
          ← All requests
        </Link>
      </p>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{req.title}</h1>
        <p className="text-sm text-muted">
          {req.evidence.length}{" "}
          {req.evidence.length === 1 ? "customer quote" : "customer quotes"} ·
          added {new Date(req.createdAt).toLocaleDateString()}
        </p>
      </div>

      <h2 className="text-lg font-medium">What customers said</h2>
      {req.evidence.length === 0 ? (
        <p className="text-muted">There is no evidence on this request yet.</p>
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
