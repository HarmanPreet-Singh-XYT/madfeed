import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateNoteForm } from "@/components/create-note-form";
import { ChevronLeft, Megaphone } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NoteKind, NoteStatus } from "@/components/note-status";
import { NoteFiltersBar, noteHref } from "@/components/note-filters";
import { NoteCalendar } from "@/components/note-calendar";
import { NoteRowActions } from "@/components/note-row-actions";
import { LocalTime } from "@/components/local-time";
import { plural } from "@/lib/format";

export const metadata = { title: "Release notes" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    state?: string;
    q?: string;
    type?: string;
    cursor?: string;
    view?: string;
    month?: string;
  }>;
};

const STATES = ["draft", "scheduled", "published", "unpublished"] as const;
const TYPES = ["new", "improved", "fixed"] as const;

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "unpublished", label: "Taken down" },
];

const EMPTY: Record<string, { title: string; body: string }> = {
  "": {
    title: "No release notes yet.",
    body: "Start one above to tell customers what changed.",
  },
  draft: {
    title: "No drafts.",
    body: "A draft is a note you are still writing. Start one above when there is something to say.",
  },
  scheduled: {
    title: "Nothing scheduled.",
    body: "Pick a go-live time on a draft and it waits here until it publishes itself.",
  },
  published: {
    title: "Nothing published yet.",
    body: "A published note goes on your public page and can be mentioned in messages to the people who asked.",
  },
  unpublished: {
    title: "Nothing taken down.",
    body: "Notes you take off the public page stay here, so they can go back up later.",
  },
};

/** The body as one line of plain text, short enough for a row. */
function excerpt(body: string) {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 140).trimEnd()}…` : text;
}

export default function ReleasesPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Releases {...props} />
    </Suspense>
  );
}

async function Releases({ params, searchParams }: Props) {
  // The month shown by default is "now", which must be read per request, never frozen into the build.
  await connection();
  const { workspaceId } = await params;
  const sp = await searchParams;
  const state = STATES.includes(sp.state as (typeof STATES)[number])
    ? (sp.state as string)
    : "";
  const type = TYPES.includes(sp.type as (typeof TYPES)[number])
    ? (sp.type as string)
    : "";
  const q = (sp.q ?? "").slice(0, 100).trim();
  const cursor = sp.cursor ?? "";
  const view = sp.view === "calendar" ? "calendar" : "list";
  const now = new Date();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "")
    ? (sp.month as string)
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const ws = await getWorkspace(workspaceId);
  const { notes, counts, nextCursor } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/release-notes", {
      params: {
        path: { workspaceId: ws.id },
        query: {
          limit: view === "calendar" ? 100 : 50,
          ...(view === "calendar"
            ? { state: "scheduled" as const }
            : state
              ? { state: state as (typeof STATES)[number] }
              : {}),
          ...(type ? { type: type as (typeof TYPES)[number] } : {}),
          ...(q ? { q } : {}),
          ...(view === "list" && cursor ? { cursor } : {}),
        },
      },
    }),
  );
  const canEdit = ws.role !== "viewer";
  const countFor = (key: string) =>
    key === ""
      ? counts.all
      : key === "draft"
        ? counts.draft
        : key === "scheduled"
          ? counts.scheduled
          : key === "published"
            ? counts.published
            : counts.unpublished;
  const empty = EMPTY[state] ?? EMPTY[""];

  return (
    <section className="space-y-6">
      <PageHeader
        title="Release notes"
        description="Tell everyone what changed. Publish now or schedule it, and link the requests it closes."
      />
      {canEdit ? (
        <div id="start-a-note" className="scroll-mt-4">
          <Panel title="Start a note">
            <CreateNoteForm workspaceId={ws.id} />
          </Panel>
        </div>
      ) : null}

      {counts.all > 0 ? (
        <NoteFiltersBar
          workspaceId={ws.id}
          filters={{ state, q, type }}
          view={view}
          month={month}
          tabs={TABS.map((t) => ({
            key: t.key,
            label: t.label,
            count: countFor(t.key),
          }))}
        />
      ) : null}

      {view === "calendar" ? (
        <NoteCalendar
          workspaceId={ws.id}
          month={month}
          filters={{ state: "", q, type }}
          notes={notes
            .filter((n) => n.state === "scheduled" && n.scheduledFor)
            .map((n) => ({
              id: n.id,
              title: n.title,
              type: n.type,
              at: n.scheduledFor as string,
            }))}
        />
      ) : (q || type) && notes.length === 0 ? (
        <EmptyState icon={Megaphone} title="Nothing matches these filters.">
          <Link
            href={noteHref(ws.id, { state, q, type }, { q: "", type: "" })}
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            Clear the search and the kind
          </Link>
        </EmptyState>
      ) : notes.length === 0 ? (
        <EmptyState icon={Megaphone} title={empty.title}>
          {empty.body}
        </EmptyState>
      ) : (
        <Card asChild className="[--card-spacing:0px] py-0">
          <ul className="divide-y divide-border">
            {notes.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-2 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/w/${ws.id}/releases/${n.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {n.title}
                    </Link>
                    <NoteStatus state={n.state} />
                    <NoteKind type={n.type} />
                  </div>
                  {excerpt(n.body) ? (
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                      {excerpt(n.body)}
                    </p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {n.state === "scheduled" && n.scheduledFor ? (
                      <span>
                        Goes live{" "}
                        <LocalTime iso={n.scheduledFor} time relative />
                      </span>
                    ) : n.liveNow && n.publishedAt ? (
                      <span>
                        Live since <LocalTime iso={n.publishedAt} />
                      </span>
                    ) : n.state === "unpublished" && n.publishedAt ? (
                      <span>
                        Was live <LocalTime iso={n.publishedAt} />
                      </span>
                    ) : (
                      <span>Not published</span>
                    )}
                    {n.requests.length > 0 ? (
                      <span>Closes {plural(n.requests.length, "request")}</span>
                    ) : null}
                    <span>
                      Edited <LocalTime iso={n.updatedAt} relative />
                    </span>
                  </p>
                </div>
                {canEdit ? (
                  <NoteRowActions
                    workspaceId={ws.id}
                    note={{ id: n.id, title: n.title, state: n.state }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link
              href={noteHref(ws.id, { state, q, type }, { cursor: nextCursor })}
              className="inline-flex items-center gap-1"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              Older notes
            </Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
