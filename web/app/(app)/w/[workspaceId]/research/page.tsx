import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { HighlightCard } from "@/components/highlight-card";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";
import { isUuid } from "@/lib/text";

export const metadata = { title: "Research" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ tag?: string; cursor?: string }>;
};

export default function ResearchPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Research {...props} />
    </Suspense>
  );
}

async function Research({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const { tag, cursor } = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const tagId = tag && isUuid(tag) ? tag : undefined;
  const [{ tags }, page] = await Promise.all([
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
            limit: 30,
            ...(tagId ? { tagId } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      })
      .then(unwrap),
  ]);
  const live = tags.filter((t) => !t.archived);
  const base = `/w/${ws.id}/research`;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Research</h1>
        <p className="text-muted-foreground">
          Passages you marked in conversations, with the tags you gave them.
          Open any conversation and select words to add one.{" "}
          <Link href={`${base}/codebook`} className={link}>
            Manage tags
          </Link>
        </p>
      </div>

      {live.length > 0 ? (
        <nav
          aria-label="Filter by tag"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-sm text-muted-foreground">Show</span>
          {[{ id: "", name: "All" }, ...live].map((t) => {
            const active = (t.id || undefined) === tagId;
            return (
              <Link
                key={t.id || "all"}
                href={t.id ? `${base}?tag=${t.id}` : base}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${active ? "border-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                {t.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {page.highlights.length === 0 ? (
        <div className={card}>
          <p className="font-medium">
            {tagId ? "Nothing has this tag yet." : "No highlights yet."}
          </p>
          <p className="mt-1 text-muted-foreground">
            Open a conversation, select the words that matter, and save them.
            You can find your conversations from{" "}
            <Link href={`/w/${ws.id}/requests`} className={link}>
              a request
            </Link>{" "}
            (“See it in the conversation”).
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {page.highlights.map((h) => (
            <HighlightCard
              key={h.id}
              workspaceId={ws.id}
              highlight={h}
              allTags={live}
              canEdit={ws.role !== "viewer"}
            />
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Link
          href={`${base}?${tagId ? `tag=${tagId}&` : ""}cursor=${encodeURIComponent(page.nextCursor)}`}
          className={link}
        >
          Older highlights
        </Link>
      ) : null}
    </section>
  );
}
