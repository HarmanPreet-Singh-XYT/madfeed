import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getProposals, getSource, getWorkspace } from "@/lib/server/queries";
import { Quote } from "@/components/quote";
import { Loading } from "@/components/loading";
import { SuggestedActions, UndoAction } from "@/components/review-actions";
import { BulkAcceptForm } from "@/components/bulk-accept-form";
import { card, link } from "@/components/ui";
import { KIND_LABEL, percent } from "@/lib/text";

export const metadata = { title: "Review" };

type State = "suggested" | "accepted" | "dismissed";
type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ state?: string }>;
};

const TABS: { state: State; label: string }[] = [
  { state: "suggested", label: "To review" },
  { state: "accepted", label: "Accepted" },
  { state: "dismissed", label: "Dismissed" },
];

export default function ReviewPage(props: Props) {
  return (
    <Suspense fallback={<Loading label="Loading suggestions…" />}>
      <Review {...props} />
    </Suspense>
  );
}

async function Review({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const q = (await searchParams).state;
  const state: State = q === "accepted" || q === "dismissed" ? q : "suggested";
  const ws = await getWorkspace(workspaceId);
  const proposals = await getProposals(ws.id, state, 100);
  const canEdit = ws.role !== "viewer";
  // Existing requests a suggestion can be added to (the most recent 100).
  const existing =
    canEdit && state === "suggested" && proposals.length > 0
      ? unwrap(
          await (
            await api()
          ).GET("/v1/workspaces/{workspaceId}/requests", {
            params: { path: { workspaceId: ws.id }, query: { limit: 100 } },
          }),
        ).requests.map((r) => ({ id: r.id, title: r.title }))
      : [];
  // Fetch each source once (cached per request) to show quotes in context.
  const sources = new Map(
    await Promise.all(
      [...new Set(proposals.map((p) => p.sourceItemId))].map(
        async (id) => [id, await getSource(ws.id, id)] as const,
      ),
    ),
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-muted">
          Each suggestion shows the customer&apos;s exact words. Accept the ones
          that are real; nothing is saved until you do.
        </p>
      </div>

      <nav aria-label="Suggestion status" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.state}
            href={`/w/${ws.id}/review?state=${t.state}`}
            aria-current={t.state === state ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${t.state === state ? "border-foreground" : "border-border text-muted hover:bg-surface"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {state === "suggested" && canEdit && proposals.length > 1 ? (
        <BulkAcceptForm workspaceId={ws.id} />
      ) : null}

      {proposals.length === 0 ? (
        <div className={card}>
          <p className="font-medium">
            {state === "suggested"
              ? "Nothing to review right now."
              : `Nothing ${state} yet.`}
          </p>
          {state === "suggested" ? (
            <p className="mt-1 text-muted">
              <Link href={`/w/${ws.id}/add`} className={link}>
                Add a conversation
              </Link>{" "}
              and new suggestions will appear here.
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-4">
          {proposals.map((p) => (
            <li key={p.id} className={`${card} space-y-4`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-lg font-medium">{p.title}</h2>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                  {KIND_LABEL[p.statementKind] ?? p.statementKind}
                </span>
                <span className="text-sm text-muted">
                  {percent(p.confidence)} confident
                </span>
              </div>
              <Quote
                text={sources.get(p.sourceItemId)?.text}
                start={p.spanStart}
                end={p.spanEnd}
                quote={p.quote}
              />
              <p className="text-sm">
                <Link
                  href={`/w/${ws.id}/sources/${p.sourceItemId}?s=${p.spanStart}&e=${p.spanEnd}#quote`}
                  className={link}
                >
                  See it in the full conversation
                </Link>
                {p.state === "accepted" && p.requestId ? (
                  <>
                    {" · "}
                    <Link
                      href={`/w/${ws.id}/requests/${p.requestId}`}
                      className={link}
                    >
                      Open the request
                    </Link>
                  </>
                ) : null}
              </p>
              {canEdit ? (
                p.state === "suggested" ? (
                  <SuggestedActions
                    workspaceId={ws.id}
                    proposalId={p.id}
                    title={p.title}
                    existing={existing}
                  />
                ) : (
                  <UndoAction workspaceId={ws.id} proposalId={p.id} />
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
