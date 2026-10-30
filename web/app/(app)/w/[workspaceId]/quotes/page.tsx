import { Suspense } from "react";
import Link from "next/link";
import { Download, Plus, Quote, SearchX } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { QuoteToolbar } from "@/components/quotes/quote-toolbar";
import { QuoteTable } from "@/components/quotes/quote-table";
import { QuoteBoard } from "@/components/quotes/quote-board";
import { QuoteSearchResults, type QuoteHit } from "@/components/quotes/quote-search-results";
import { QuoteSkeleton } from "@/components/quotes/quote-skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { link } from "@/components/ui";

export const metadata = { title: "Quotes" };

type Search = Record<string, string | string[] | undefined>;
type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Search>;
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const SENTIMENTS = ["positive", "neutral", "negative", "mixed", "none"] as const;
const SOURCES = ["paste", "recording", "form", "api", "chat", "survey"] as const;
const DAYS = [7, 30, 90];
const OPEN = /^(evidence|highlight):([0-9a-f-]{36})$/i;

/** A person or account, when the lookup answered with one. */
function named(x: unknown): { id: string; name: string } | undefined {
  if (x && typeof x === "object" && "id" in x && "name" in x) {
    const v = x as { id: string; name: string };
    return { id: v.id, name: v.name };
  }
  return undefined;
}

/** The moment a "last N days" filter starts at, taken once per request. */
function startOfRange(days: number) {
  return days ? new Date(Date.now() - days * 86_400_000) : undefined;
}

export default function QuotesPage(props: Props) {
  return (
    <Suspense fallback={<QuoteSkeleton />}>
      <Quotes {...props} />
    </Suspense>
  );
}

async function Quotes({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const client = await api();

  const tag = isUuid(one(sp.tag)) ? one(sp.tag) : undefined;
  const sentiment = (SENTIMENTS as readonly string[]).includes(one(sp.sentiment))
    ? (one(sp.sentiment) as (typeof SENTIMENTS)[number])
    : undefined;
  const sourceKind = (SOURCES as readonly string[]).includes(one(sp.source))
    ? (one(sp.source) as (typeof SOURCES)[number])
    : undefined;
  const kind =
    one(sp.kind) === "evidence" || one(sp.kind) === "highlight"
      ? (one(sp.kind) as "evidence" | "highlight")
      : undefined;
  const q = one(sp.q).slice(0, 200);
  const meaning = one(sp.m).trim().slice(0, 300);
  const personId = isUuid(one(sp.personId)) ? one(sp.personId) : undefined;
  const accountId = isUuid(one(sp.accountId)) ? one(sp.accountId) : undefined;
  const board = one(sp.view) === "board";
  const sort = one(sp.sort) === "oldest" ? "oldest" : "newest";
  const days = DAYS.includes(Number(one(sp.days))) ? Number(one(sp.days)) : 0;
  const since = startOfRange(days);
  const afterAt = one(sp.afterAt);
  const afterId = one(sp.afterId);
  const openMatch = OPEN.exec(one(sp.open));
  const initialOpen = openMatch ? `${openMatch[1].toLowerCase()}:${openMatch[2]}` : undefined;
  const canWrite = ws.role !== "viewer";

  // All of these are independent, so they go out together rather than one after the other.
  const [tagsRes, viewsRes, listRes, findingsRes, personRes, accountRes, found] = await Promise.all([
    client.GET("/v1/workspaces/{workspaceId}/tags", {
      params: { path: { workspaceId: ws.id } },
    }),
    client.GET("/v1/workspaces/{workspaceId}/quotes/views", {
      params: { path: { workspaceId: ws.id } },
    }),
    client.GET("/v1/workspaces/{workspaceId}/quotes", {
      params: {
        path: { workspaceId: ws.id },
        query: {
          tagId: tag,
          sentiment,
          sourceKind,
          kind,
          q: q || undefined,
          personId,
          accountId,
          sort,
          ...(since ? { since: since.toISOString() } : {}),
          limit: board ? 100 : 50,
          ...(afterAt && isUuid(afterId) && !Number.isNaN(Date.parse(afterAt))
            ? { afterAt: new Date(afterAt).toISOString(), afterId }
            : {}),
        },
      },
    }),
    client.GET("/v1/workspaces/{workspaceId}/findings", {
      params: { path: { workspaceId: ws.id } },
    }),
    personId
      ? client
          .GET("/v1/workspaces/{workspaceId}/people/{personId}", {
            params: { path: { workspaceId: ws.id, personId } },
          })
          .then((r) => (r.response.ok ? unwrap(r) : undefined))
      : Promise.resolve(undefined),
    accountId
      ? client
          .GET("/v1/workspaces/{workspaceId}/accounts/{accountId}", {
            params: { path: { workspaceId: ws.id, accountId } },
          })
          .then((r) => (r.response.ok ? unwrap(r) : undefined))
      : Promise.resolve(undefined),
    meaning
      ? client
          .GET("/v1/workspaces/{workspaceId}/quotes/search", {
            params: { path: { workspaceId: ws.id }, query: { q: meaning } },
          })
          .then(unwrap)
      : Promise.resolve(undefined),
  ]);

  const { tags } = unwrap(tagsRes);
  const { views } = unwrap(viewsRes);
  const res = unwrap(listRes);
  const { documents } = unwrap(findingsRes);
  const person = named(personRes);
  const account = named(accountRes);

  const keep = new URLSearchParams();
  for (const [k, v] of [
    ["tag", tag],
    ["sentiment", sentiment],
    ["source", sourceKind],
    ["personId", personId],
    ["accountId", accountId],
    ["kind", kind],
    ["q", q],
    ["m", meaning],
    ["days", days ? String(days) : ""],
    ["sort", sort === "oldest" ? "oldest" : ""],
    ["view", board ? "board" : ""],
  ] as [string, string | undefined][])
    if (v) keep.set(k, v);

  const nextHref = res.next
    ? `/w/${ws.id}/quotes?${new URLSearchParams({
        ...Object.fromEntries(keep.entries()),
        afterAt: res.next.at,
        afterId: res.next.id,
      }).toString()}`
    : undefined;

  const exportHref = `/w/${ws.id}/quotes/export?${keep.toString()}`;
  const filtered = Boolean(
    q || meaning || tag || sentiment || sourceKind || kind || days || personId || accountId,
  );
  const showMeaning = Boolean(meaning && found?.ready);
  const hits = (found?.hits ?? []) as QuoteHit[];

  return (
    <section className="space-y-4">
      <PageHeader
        title="Quotes"
        description={
          <>
            Every quote customers actually said, with its source. Quotes are
            stored word for word. To review and tag the passages you saved, use{" "}
            <Link href={`/w/${ws.id}/research`} className="underline underline-offset-4">
              Research
            </Link>
            .
          </>
        }
        actions={
          <>
            <Button asChild className="bg-on-brand text-brand-1 hover:bg-on-brand/90">
              <Link href={`/w/${ws.id}/findings`}>
                <Plus aria-hidden="true" /> Write a finding
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/w/${ws.id}/quotes/trends`}>Tags over time</Link>
            </Button>
            {meaning ? (
              <Button
                variant="outline"
                disabled
                title="Clear the meaning search to export the filtered list"
              >
                <Download aria-hidden="true" /> Export
              </Button>
            ) : (
              <Button asChild variant="outline">
                <a href={exportHref}>
                  <Download aria-hidden="true" /> Export
                </a>
              </Button>
            )}
          </>
        }
      />

      <QuoteToolbar
        workspaceId={ws.id}
        tags={tags}
        views={views}
        total={showMeaning ? hits.length : res.total}
        loaded={showMeaning ? hits.length : res.quotes.length}
        meaningCount={showMeaning ? hits.length : undefined}
        canSave={canWrite}
        person={person}
        account={account}
      />

      {meaning && found && !found.ready ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p className="font-medium">Searching by meaning is not set up yet.</p>
          <p className="mt-1 text-muted-foreground">
            It needs an AI provider. An admin can turn one on in{" "}
            <Link href={`/w/${ws.id}/settings`} className={link}>
              settings
            </Link>
            ; searching by words still works.
          </p>
        </div>
      ) : null}

      {showMeaning ? (
        <>
          {found && found.pending > 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {found.pending} quote{found.pending === 1 ? " is" : "s are"} still being
              prepared for meaning search.
              <AutoRefresh seconds={20} />
            </p>
          ) : null}
          {hits.length === 0 ? (
            <EmptyState icon={SearchX} title="No quotes with that meaning yet">
              Try other words, or clear the search and browse with filters.
            </EmptyState>
          ) : (
            <QuoteSearchResults workspaceId={ws.id} hits={hits} />
          )}
        </>
      ) : res.quotes.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No quotes match these filters">
            <span className="block space-y-3">
              <span className="block">
                Nothing here matches what is on, rather than the workspace being
                empty.
              </span>
              <Button asChild variant="outline" size="sm">
                <Link href={`/w/${ws.id}/quotes`}>Clear all filters</Link>
              </Button>
            </span>
          </EmptyState>
        ) : (
          <EmptyState icon={Quote} title="No quotes yet">
            <span className="block space-y-3">
              <span className="block">
                Quotes arrive when you paste feedback, upload a recording, or collect
                it through the website form, chat and surveys. Each one keeps its
                source.
              </span>
              <span className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm">
                  <Link href={`/w/${ws.id}/add`}>Add feedback</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/w/${ws.id}/recordings`}>Record a call</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/w/${ws.id}/settings#feedback-form-for-your-website`}>
                    Put the form on your site
                  </Link>
                </Button>
              </span>
            </span>
          </EmptyState>
        )
      ) : board ? (
        <QuoteBoard
          workspaceId={ws.id}
          rows={res.quotes}
          tags={tags}
          canWrite={canWrite}
          findings={documents}
        />
      ) : (
        <QuoteTable
          workspaceId={ws.id}
          rows={res.quotes}
          tags={tags}
          canWrite={canWrite}
          findings={documents}
          initialOpen={initialOpen}
        />
      )}

      {nextHref && !showMeaning ? (
        <p>
          <Link href={nextHref} className={link}>
            {sort === "oldest" ? "Newer quotes" : "Older quotes"}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
