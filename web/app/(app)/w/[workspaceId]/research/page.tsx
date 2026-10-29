import { Suspense } from "react";
import Link from "next/link";
import { Highlighter, Tags } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { HighlightList } from "@/components/highlight-list";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { isUuid } from "@/lib/text";

export const metadata = { title: "Research" };

const LIMIT = 30;

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    tag?: string;
    cursor?: string;
    q?: string;
    view?: string;
  }>;
};

export default function ResearchPage(props: Props) {
  return (
    <Suspense fallback={<ResearchLoading />}>
      <Research {...props} />
    </Suspense>
  );
}

async function Research({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const { tag, cursor, q, view } = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const tagIds = (tag ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(isUuid)
    .slice(0, 10);
  const tagParam = tagIds.join(",");
  const untagged = view === "untagged";
  const words = (q ?? "").trim().slice(0, 200);

  const [{ tags }, page, toTag] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/tags", {
        params: { path: { workspaceId: ws.id } },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/highlights", {
        params: {
          path: { workspaceId: ws.id },
          query: {
            limit: LIMIT,
            ...(tagIds.length > 0 ? { tagIds } : {}),
            ...(untagged ? { untagged: true } : {}),
            ...(words ? { q: words } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      })
      .then(unwrap),
    client
      .GET("/v1/workspaces/{workspaceId}/highlights", {
        params: {
          path: { workspaceId: ws.id },
          query: { limit: 1, untagged: true },
        },
      })
      .then(unwrap),
  ]);

  const live = tags.filter((t) => !t.archived);
  const base = `/w/${ws.id}/research`;
  const canEdit = ws.role !== "viewer";
  const filtered = Boolean(tagIds.length > 0 || words || untagged);
  // The header always says how many highlights the workspace has, never how
  // many this one filter happened to match.
  const total = filtered
    ? (
        await client
          .GET("/v1/workspaces/{workspaceId}/highlights", {
            params: { path: { workspaceId: ws.id }, query: { limit: 1 } },
          })
          .then(unwrap)
      ).count
    : page.count;

  /** A link that keeps the other filters, so nothing silently resets. */
  function href(next: {
    tag?: string;
    q?: string;
    view?: string;
    cursor?: string;
  }) {
    const state = {
      tag: tagParam || undefined,
      q: words || undefined,
      view: untagged ? "untagged" : undefined,
      cursor,
      ...next,
    };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  }

  /** Tags add up: a second click takes one off again. */
  function withTag(id: string) {
    const next = tagIds.includes(id)
      ? tagIds.filter((x) => x !== id)
      : [...tagIds, id];
    return href({ tag: next.join(",") || undefined, view: undefined, cursor: undefined });
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Research"
        description={
          <>
            {total} highlight{total === 1 ? "" : "s"}
            {toTag.count > 0 ? ` · ${toTag.count} to tag` : null}
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`${base}/codebook`}>
              <Tags aria-hidden="true" />
              Manage tags
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Show highlights" className="flex flex-wrap gap-2">
          <Link
            href={href({ view: undefined, cursor: undefined })}
            aria-current={!untagged ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium transition-colors ${!untagged ? "border-primary/40 bg-tint-blue text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            All
          </Link>
          <Link
            href={href({ view: "untagged", cursor: undefined })}
            aria-current={untagged ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${untagged ? "border-primary/40 bg-tint-blue text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            To tag
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
              {toTag.count}
            </span>
          </Link>
        </nav>

        <form action={base} method="get" className="ms-auto flex items-center gap-2">
          {tagParam ? <input type="hidden" name="tag" value={tagParam} /> : null}
          {untagged ? <input type="hidden" name="view" value="untagged" /> : null}
          <Input
            name="q"
            defaultValue={words}
            placeholder="Words in the quote"
            aria-label="Words in the quote"
            className="min-h-11 w-52"
          />
          <Button type="submit" variant="outline" className="min-h-11">
            Search
          </Button>
        </form>
      </div>

      <nav
        aria-label="Filter by tag"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="mr-1 text-sm text-muted-foreground">Show</span>
        {live.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            No tags yet.{" "}
            <Link href={`${base}/codebook`} className="text-link underline underline-offset-4 hover:text-foreground">
              Create the first one
            </Link>
            .
          </span>
        ) : (
          <>
            <Link
              href={href({ tag: undefined, cursor: undefined })}
              aria-current={tagIds.length === 0 ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium transition-colors ${tagIds.length === 0 ? "border-primary/40 bg-tint-blue text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              Any tag
            </Link>
            {live.map((t) => (
              <Link
                key={t.id}
                href={withTag(t.id)}
                aria-current={tagIds.includes(t.id) ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium transition-colors ${tagIds.includes(t.id) ? "border-primary/40 bg-tint-blue text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                {t.name}
              </Link>
            ))}
          </>
        )}
      </nav>

      {!canEdit ? (
        <p className="text-sm text-muted-foreground">
          You can read these. Only editors can tag or remove them.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Cards are for triage. A table, meaning search, feelings and saved views
        live in{" "}
        <Link
          href={`/w/${ws.id}/quotes?kind=highlight`}
          className="text-link underline underline-offset-4 hover:text-foreground"
        >
          Quotes
        </Link>
        .
      </p>

      {filtered && page.count > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Showing {page.highlights.length} of {page.count}
          <Link href={base} className="text-link underline underline-offset-4 hover:text-foreground">
            Clear
          </Link>
        </p>
      ) : null}

      {page.highlights.length === 0 ? (
        <Empty
          tagIds={tagIds}
          words={words}
          untagged={untagged}
          base={base}
          workspaceId={ws.id}
        />
      ) : (
        <HighlightList
          workspaceId={ws.id}
          highlights={page.highlights}
          allTags={live}
          canEdit={canEdit}
        />
      )}

      {page.nextCursor ? (
        <Button asChild variant="outline">
          <Link href={href({ cursor: page.nextCursor })}>Older highlights</Link>
        </Button>
      ) : null}
    </section>
  );

}

function Empty({
  tagIds,
  words,
  untagged,
  base,
  workspaceId,
}: {
  tagIds: string[];
  words: string;
  untagged: boolean;
  base: string;
  workspaceId: string;
}) {
  if (tagIds.length > 0) {
    return (
      <EmptyState
        icon={Highlighter}
        title={
          tagIds.length === 1
            ? "Nothing has this tag yet."
            : "Nothing has these tags yet."
        }
        actions={
          <Button asChild variant="outline">
            <Link href={base}>Show all highlights</Link>
          </Button>
        }
      >
        Highlights keep a tag once it is added; this one has not been used yet.
      </EmptyState>
    );
  }
  if (words) {
    return (
      <EmptyState
        icon={Highlighter}
        title={`No highlights match “${words}”.`}
        actions={
          <Button asChild variant="outline">
            <Link href={base}>Clear the search</Link>
          </Button>
        }
      >
        Only the words inside the saved passage are searched.
      </EmptyState>
    );
  }
  if (untagged) {
    return (
      <EmptyState
        icon={Highlighter}
        title="Everything is tagged."
        actions={
          <Button asChild variant="outline">
            <Link href={base}>Show all highlights</Link>
          </Button>
        }
      >
        Every passage in this workspace has at least one tag. New ones appear
        here until they get one.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={Highlighter}
      title="No highlights yet."
      actions={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={`/w/${workspaceId}/requests`}>Open a request</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${base}/codebook`}>Set up tags</Link>
          </Button>
        </div>
      }
    >
      Open a conversation, select the words that matter, and save them. They
      show up here with their tags.
    </EmptyState>
  );
}

function ResearchLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading highlights">
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
