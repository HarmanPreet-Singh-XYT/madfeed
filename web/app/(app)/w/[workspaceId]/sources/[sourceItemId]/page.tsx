import { Suspense } from "react";
import Link from "next/link";
import { getProposals, getSource, getWorkspace } from "@/lib/server/queries";
import { SourceStatus } from "@/components/source-status";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { api, unwrap } from "@/lib/server/api";
import { HighlightableText } from "@/components/highlightable-text";
import { HighlightSuggestions } from "@/components/highlight-suggestions";
import { ConfirmDelete } from "@/components/confirm-delete";
import { deleteSourceAction } from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Conversation" };

type Props = {
  params: Promise<{ workspaceId: string; sourceItemId: string }>;
  searchParams: Promise<{ s?: string; e?: string; t?: string }>;
};

export default function SourcePage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Source {...props} />
    </Suspense>
  );
}

async function Source({ params, searchParams }: Props) {
  const { workspaceId, sourceItemId } = await params;
  const { s, e, t } = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const src = await getSource(ws.id, sourceItemId);
  // Two small reads: what is left to review here, and how much of it has
  // already been accepted, so the panel can show progress rather than a count.
  const forSource = (state: "suggested" | "accepted") =>
    getProposals(ws.id, state, 200).then((list) =>
      list.filter((p) => p.sourceItemId === src.id),
    );
  const [openProposals, acceptedProposals] =
    src.state === "done"
      ? await Promise.all([forSource("suggested"), forSource("accepted")])
      : [[], []];
  const ready = openProposals.length;
  const acceptedCount = acceptedProposals.length;

  const client = await api();
  const marks = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/highlights", {
      params: {
        path: { workspaceId: ws.id },
        query: { sourceItemId: src.id, limit: 100 },
      },
    }),
  ).highlights.map((h) => ({ id: h.id, start: h.spanStart, end: h.spanEnd }));
  const { tags } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/tags", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const transcript =
    src.mediaId !== undefined
      ? unwrap(
          await client.GET(
            "/v1/workspaces/{workspaceId}/sources/{sourceItemId}/transcript",
            { params: { path: { workspaceId: ws.id, sourceItemId: src.id } } },
          ),
        )
      : undefined;
  const { suggestions } = unwrap(
    await client.GET(
      "/v1/workspaces/{workspaceId}/sources/{sourceItemId}/highlight-suggestions",
      { params: { path: { workspaceId: ws.id, sourceItemId: src.id } } },
    ),
  );
  const startAt = Number(t);
  const start = Number(s);
  const end = Number(e);
  const focus =
    s !== undefined &&
    e !== undefined &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    end > start
      ? { start, end }
      : undefined;

  return (
    <section className="space-y-6">
      <PageHeader
        back={{ href: `/w/${ws.id}/requests`, label: "Requests" }}
        title={src.title || "Conversation"}
        description={
          <>
            Added <LocalTime iso={src.createdAt} time />
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="[--card-spacing:0px] min-w-0 space-y-4 p-4 sm:p-6">
          <HighlightableText
            workspaceId={ws.id}
            sourceItemId={src.id}
            text={src.text}
            marks={marks}
            focus={focus}
            tags={tags.filter((t) => !t.archived)}
            canEdit={ws.role !== "viewer"}
            recording={
              transcript
                ? { mediaId: transcript.mediaId, segments: transcript.segments }
                : undefined
            }
            startAtMs={
              Number.isFinite(startAt) && t !== undefined ? startAt : undefined
            }
          />
        </Card>

        <aside
          aria-label="About this conversation"
          className="space-y-4 lg:sticky lg:top-6"
        >
          <Card className="[--card-spacing:0px] space-y-3 p-4">
            <p className="text-xs font-medium text-muted-foreground">
              What we found
            </p>
            <SourceStatus state={src.state}>
              {src.state === "pending" || src.state === "processing" ? (
                <p>
                  Reading the conversation and finding requests… this usually
                  takes under a minute.
                </p>
              ) : src.state === "failed" ? (
                <p className="text-destructive">
                  We couldn&apos;t finish reading this one
                  {src.failureReason ? ` (${src.failureReason})` : ""}. Try
                  pasting it again.
                </p>
              ) : ready > 0 || acceptedCount > 0 ? (
                <div className="space-y-2">
                  <p>
                    {ready > 0
                      ? `Found ${ready} ${ready === 1 ? "request" : "requests"} to review.`
                      : "You have reviewed everything from this conversation."}
                    {acceptedCount > 0
                      ? ` ${acceptedCount} ${acceptedCount === 1 ? "request" : "requests"} accepted.`
                      : ""}
                  </p>
                  <Link
                    href={`/w/${ws.id}/review?source=${src.id}`}
                    className={link}
                  >
                    {ready > 0 ? "Review these" : "See what was accepted"}
                  </Link>
                </div>
              ) : (
                <p>
                  Done. We didn&apos;t find anything that looked like a customer
                  request in this conversation.
                </p>
              )}
            </SourceStatus>
            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Highlights</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {marks.length}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Kind</dt>
                <dd className="font-medium capitalize">{src.kind}</dd>
              </div>
            </dl>
          </Card>

          {src.redactions > 0 ? (
            <p
              role="note"
              className="rounded-xl bg-tint-amber px-3 py-2 text-sm"
            >
              We hid {src.redactions}{" "}
              {src.redactions === 1 ? "thing" : "things"} that looked like card
              numbers, keys or passwords before saving this. They were never
              stored and never sent to an AI service.
            </p>
          ) : null}

          {ws.role !== "viewer" ? (
            <Card className="[--card-spacing:0px] p-4">
              <HighlightSuggestions
                workspaceId={ws.id}
                sourceItemId={src.id}
                suggestions={suggestions}
                allTags={tags.filter((t) => !t.archived)}
              />
            </Card>
          ) : null}

          {ws.role === "admin" ? (
            <ConfirmDelete
              label={
                src.kind === "recording"
                  ? "Delete this recording"
                  : "Delete this conversation"
              }
              consequences={`This removes ${src.kind === "recording" ? "the recording file, " : ""}the text and every quote, highlight and suggestion built on it. Requests that cited it lose that evidence. This can't be undone.`}
              confirmLabel="Yes, delete it"
              action={deleteSourceAction.bind(null, ws.id, src.id)}
              thenGo={`/w/${ws.id}/requests`}
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}
