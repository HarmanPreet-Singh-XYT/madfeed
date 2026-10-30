import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getProposals, getSource, getWorkspace } from "@/lib/server/queries";
import { Quote } from "@/components/quote";
import { Loading } from "@/components/loading";
import { SuggestedActions, UndoAction } from "@/components/review-actions";
import { BulkAcceptForm } from "@/components/bulk-accept-form";
import { ReviewShortcuts } from "@/components/review-shortcuts";
import { link } from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { KIND_LABEL, percent } from "@/lib/text";
import { isUuid } from "@/lib/text";

export const metadata = { title: "Review" };

type State = "suggested" | "accepted" | "dismissed";
type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ state?: string; source?: string }>;
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
  const sp = await searchParams;
  const q = sp.state;
  const state: State = q === "accepted" || q === "dismissed" ? q : "suggested";
  const ws = await getWorkspace(workspaceId);
  const sourceId = sp.source && isUuid(sp.source) ? sp.source : undefined;

  // Scoped to one conversation, fetch every state so the header can show how far
  // through that conversation the reviewer is. The API filters by state only, so
  // one conversation is picked out here (the same way the conversation page does).
  type Proposals = Awaited<ReturnType<typeof getProposals>>;
  let proposals: Proposals;
  let scope: { title: string; totals: Record<State, number> } | undefined;
  if (sourceId) {
    const [suggested, accepted, dismissed, src] = await Promise.all([
      getProposals(ws.id, "suggested", 200),
      getProposals(ws.id, "accepted", 200),
      getProposals(ws.id, "dismissed", 200),
      getSource(ws.id, sourceId),
    ]);
    const only = (list: typeof suggested) =>
      list.filter((p) => p.sourceItemId === sourceId);
    const sets = {
      suggested: only(suggested),
      accepted: only(accepted),
      dismissed: only(dismissed),
    };
    proposals = sets[state];
    scope = {
      title: src.title || "this conversation",
      totals: {
        suggested: sets.suggested.length,
        accepted: sets.accepted.length,
        dismissed: sets.dismissed.length,
      },
    };
  } else {
    proposals = await getProposals(ws.id, state, 100);
  }

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

  const hrefFor = (next: State) =>
    sourceId
      ? `/w/${ws.id}/review?state=${next}&source=${sourceId}`
      : `/w/${ws.id}/review?state=${next}`;

  const reviewed = scope ? scope.totals.accepted + scope.totals.dismissed : 0;
  const total = scope ? reviewed + scope.totals.suggested : 0;

  return (
    <section className="space-y-4">
      {scope ? (
        <PageHeader
          back={{
            href: `/w/${ws.id}/sources/${sourceId}`,
            label: "Conversation",
          }}
          title="Review"
          description={`Suggestions from “${scope.title}”. Accept the ones that are real; nothing is saved until you do.`}
        />
      ) : (
        <PageHeader
          title="Review"
          description="Each suggestion shows the customer's exact words. Accept the ones that are real; nothing is saved until you do."
        />
      )}

      {scope ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/60 px-4 py-2.5 text-sm">
          <p>
            <span className="font-medium">
              Reviewed {reviewed} of {total}
            </span>
            {scope.totals.accepted > 0
              ? ` · ${scope.totals.accepted} accepted`
              : null}
            {scope.totals.suggested > 0
              ? ` · ${scope.totals.suggested} left`
              : null}
          </p>
          <Link href={`/w/${ws.id}/review`} className={link}>
            Review everything instead
          </Link>
        </div>
      ) : null}

      <nav
        aria-label="Suggestion status"
        className="inline-flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-muted p-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.state}
            href={hrefFor(t.state)}
            aria-current={t.state === state ? "page" : undefined}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-all ${t.state === state ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
            {scope ? (
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${t.state === state ? "bg-secondary text-secondary-foreground" : "bg-background/60"}`}
              >
                {scope.totals[t.state]}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {state === "suggested" && !sourceId && canEdit && proposals.length > 1 ? (
        <BulkAcceptForm workspaceId={ws.id} />
      ) : null}
      {state === "suggested" && canEdit && proposals.length > 0 ? (
        <ReviewShortcuts />
      ) : null}

      {proposals.length === 0 ? (
        <Card className="[--card-spacing:0px] p-5">
          <p className="font-medium">
            {scope
              ? state === "suggested"
                ? "Nothing left to review from this conversation."
                : `Nothing ${state} from this conversation.`
              : state === "suggested"
                ? "Nothing to review right now."
                : `Nothing ${state} yet.`}
          </p>
          {scope ? (
            <p className="mt-1 text-muted-foreground">
              <Link href={`/w/${ws.id}/sources/${sourceId}`} className={link}>
                Back to the conversation
              </Link>{" "}
              or{" "}
              <Link href={`/w/${ws.id}/review`} className={link}>
                review everything
              </Link>
              .
            </p>
          ) : state === "suggested" ? (
            <p className="mt-1 text-muted-foreground">
              <Link href={`/w/${ws.id}/add`} className={link}>
                Add a conversation
              </Link>{" "}
              and new suggestions will appear here.
            </p>
          ) : null}
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          {proposals.map((p) => {
            const src = sources.get(p.sourceItemId);
            return (
              <Card
                key={p.id}
                asChild
                className="[--card-spacing:0px] overflow-hidden"
              >
                <li data-proposal-card className="scroll-mt-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{p.title}</h2>
                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[0.6875rem] font-medium text-secondary-foreground">
                          {KIND_LABEL[p.statementKind] ?? p.statementKind}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {src?.title ? `${src.title} · ` : null}
                        <Link
                          href={`/w/${ws.id}/sources/${p.sourceItemId}?s=${p.spanStart}&e=${p.spanEnd}#quote`}
                          className={link}
                        >
                          See it in the conversation
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
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-tint-teal px-2 py-1 text-xs font-medium">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-hue-teal"
                      />
                      {percent(p.confidence)} confidence
                    </span>
                  </div>

                  <div className="flex-1 px-4 py-3 sm:px-5">
                    <Quote
                      text={src?.text}
                      start={p.spanStart}
                      end={p.spanEnd}
                      quote={p.quote}
                    />
                  </div>

                  {canEdit ? (
                    <div className="border-t border-border bg-muted/40 px-4 py-3 sm:px-5">
                      {p.state === "suggested" ? (
                        <SuggestedActions
                          workspaceId={ws.id}
                          proposalId={p.id}
                          title={p.title}
                          existing={existing}
                          suggestion={
                            p.suggestion
                              ? {
                                  requestId: p.suggestion.requestId,
                                  requestTitle: p.suggestion.requestTitle,
                                  reason: p.suggestion.reason,
                                }
                              : undefined
                          }
                        />
                      ) : (
                        <UndoAction workspaceId={ws.id} proposalId={p.id} />
                      )}
                    </div>
                  ) : null}
                </li>
              </Card>
            );
          })}
        </ul>
      )}
    </section>
  );
}
