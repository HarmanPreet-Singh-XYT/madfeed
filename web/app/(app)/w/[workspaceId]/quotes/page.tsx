import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { QuoteFeeling } from "@/components/quote-feeling";
import { FEELINGS } from "@/lib/feelings";
import { btn, field, link } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { Quote } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";

export const metadata = { title: "Quotes" };

type Search = Record<string, string | string[] | undefined>;
type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Search>;
};

const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";
const SENTIMENTS = [
  "positive",
  "neutral",
  "negative",
  "mixed",
  "none",
] as const;
const SOURCES = [
  "paste",
  "recording",
  "form",
  "api",
  "chat",
  "survey",
] as const;
const SOURCE_LABEL: Record<string, string> = {
  paste: "Pasted",
  recording: "Recording",
  form: "Website form",
  api: "API",
  chat: "Chat",
  survey: "Survey",
};

export default function QuotesPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
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
  const sentiment = (SENTIMENTS as readonly string[]).includes(
    one(sp.sentiment),
  )
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
  const found = meaning
    ? unwrap(
        await client.GET("/v1/workspaces/{workspaceId}/quotes/search", {
          params: { path: { workspaceId: ws.id }, query: { q: meaning } },
        }),
      )
    : undefined;
  const board = one(sp.view) === "board";
  const afterAt = one(sp.afterAt);
  const afterId = one(sp.afterId);
  const { tags } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/tags", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const res = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/quotes", {
      params: {
        path: { workspaceId: ws.id },
        query: {
          tagId: tag,
          sentiment,
          sourceKind,
          kind,
          q: q || undefined,
          limit: board ? 100 : 50,
          ...(afterAt && isUuid(afterId) && !Number.isNaN(Date.parse(afterAt))
            ? { afterAt: new Date(afterAt).toISOString(), afterId }
            : {}),
        },
      },
    }),
  );
  const keep = new URLSearchParams();
  for (const [k, v] of [
    ["tag", tag],
    ["sentiment", sentiment],
    ["source", sourceKind],
    ["kind", kind],
    ["q", q],
    ["view", board ? "board" : ""],
  ] as [string, string | undefined][])
    if (v) keep.set(k, v);
  const nextHref = res.next
    ? `/w/${ws.id}/quotes?${new URLSearchParams({ ...Object.fromEntries(keep.entries()), afterAt: res.next.at, afterId: res.next.id }).toString()}`
    : undefined;
  const canWrite = ws.role !== "viewer";
  const columns: {
    id: string;
    title: string;
    match: (s?: string) => boolean;
  }[] = [
    ...(Object.keys(FEELINGS) as (keyof typeof FEELINGS)[]).map((k) => ({
      id: k,
      title: FEELINGS[k],
      match: (s?: string) => s === k,
    })),
    { id: "none", title: "Not labelled", match: (s?: string) => !s },
  ];
  return (
    <section className="space-y-6">
      <PageHeader
        icon={Quote}
        hue="amber"
        title="Quotes"
        description={
          <>
            Every customer quote in one place, with filters. Open{" "}
            <Link href={`/w/${ws.id}/quotes/trends`} className={link}>
              tags over time
            </Link>{" "}
            or{" "}
            <Link href={`/w/${ws.id}/findings`} className={link}>
              write up findings
            </Link>
            .
          </>
        }
      />
      <form method="get" className="space-y-1">
        <label htmlFor="m" className="block text-sm font-medium">
          Search by meaning
        </label>
        <div className="flex gap-2">
          <input
            id="m"
            name="m"
            defaultValue={meaning}
            maxLength={300}
            aria-describedby="m-help"
            placeholder="Describe what you are looking for in your own words"
            className={field}
          />
          <button type="submit" className={`${btn} shrink-0`}>
            Search
          </button>
        </div>
        <p id="m-help" className="text-xs text-muted-foreground">
          Finds quotes that mean the same, even when they use different words.
        </p>
      </form>
      {found ? (
        <div className="space-y-3" aria-live="polite">
          {!found.ready ? (
            <p className="text-muted-foreground">
              Searching by meaning is not set up yet. Words in a quote still
              work below.
            </p>
          ) : (
            <>
              {found.pending > 0 ? (
                <p className="text-muted-foreground">
                  {found.pending} quote{found.pending === 1 ? " is" : "s are"}{" "}
                  still being prepared for this search. Search again in a minute
                  for a fuller answer.
                </p>
              ) : null}
              {found.hits.length === 0 ? (
                <p>No quotes with that meaning yet.</p>
              ) : (
                <ul className="space-y-3">
                  {found.hits.map((h) => (
                    <li
                      key={h.kind + h.id}
                      className="space-y-1 rounded-2xl bg-card shadow-card p-3 text-sm"
                    >
                      <p>“{h.text}”</p>
                      <p className="text-muted-foreground">
                        <Link
                          href={`/w/${ws.id}/sources/${h.sourceItemId}`}
                          className={link}
                        >
                          {h.sourceTitle || "A source"}
                        </Link>
                        {" · "}
                        <LocalTime iso={h.at} />
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : null}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/50 p-3"
      >
        <div className="min-w-52 flex-1">
          <label
            htmlFor="q"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Words in the quote
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            maxLength={200}
            className={field}
          />
        </div>
        <div>
          <label
            htmlFor="tag"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Tag
          </label>
          <select
            id="tag"
            name="tag"
            defaultValue={tag ?? ""}
            className={field}
          >
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="sentiment"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            How it feels
          </label>
          <select
            id="sentiment"
            name="sentiment"
            defaultValue={sentiment ?? ""}
            className={field}
          >
            <option value="">Any</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
            <option value="mixed">Mixed</option>
            <option value="none">Not labelled yet</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="source"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Where it came from
          </label>
          <select
            id="source"
            name="source"
            defaultValue={sourceKind ?? ""}
            className={field}
          >
            <option value="">Anywhere</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="kind"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Kind
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue={kind ?? ""}
            className={field}
          >
            <option value="">Evidence and highlights</option>
            <option value="evidence">Evidence for requests</option>
            <option value="highlight">Highlights</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="view"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Show as
          </label>
          <select
            id="view"
            name="view"
            defaultValue={board ? "board" : "table"}
            className={field}
          >
            <option value="table">A table</option>
            <option value="board">A board, by how it feels</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className={btn}>
            Apply
          </button>
          <Link href={`/w/${ws.id}/quotes`} className={link}>
            Clear
          </Link>
        </div>
      </form>

      {res.quotes.length === 0 ? (
        <Panel>
          <p className="text-center text-sm text-muted-foreground">
            No quotes match these filters.
          </p>
        </Panel>
      ) : board ? (
        <div
          className="grid gap-3 lg:grid-cols-5"
          aria-label="Quotes by how they feel"
        >
          {columns.map((c) => {
            const items = res.quotes.filter((x) => c.match(x.sentiment));
            return (
              <section
                key={c.id}
                aria-labelledby={`col-${c.id}`}
                className="space-y-3"
              >
                <h2 id={`col-${c.id}`}>
                  {c.title}{" "}
                  <span className="text-muted-foreground">
                    ({items.length})
                  </span>
                </h2>
                <ul className="space-y-3">
                  {items.map((x) => (
                    <li
                      key={x.kind + x.id}
                      className="space-y-2 rounded-xl bg-card p-3 text-sm shadow-card"
                    >
                      <p>“{x.text}”</p>
                      <p className="text-muted-foreground">{x.sourceTitle}</p>
                      <QuoteFeeling
                        workspaceId={ws.id}
                        kind={x.kind}
                        id={x.id}
                        value={x.sentiment}
                        source={x.sentimentSource}
                        canWrite={canWrite}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <div
          role="region"
          aria-label="Quotes, scrolls sideways on small screens"
          tabIndex={0}
          className="overflow-x-auto rounded-2xl bg-card shadow-card"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Quotes, newest first</caption>
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">
                  Quote
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  From
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Tags
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Feels
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {res.quotes.map((x) => (
                <tr key={x.kind + x.id} className="align-top hover:bg-muted/40">
                  <td className="max-w-md px-4 py-2.5">“{x.text}”</td>
                  <td className="px-4 py-2.5">
                    {x.sourceTitle || "A source"}
                    <span className="block text-muted-foreground">
                      {SOURCE_LABEL[x.sourceKind] ?? x.sourceKind}
                      {x.requestTitle ? ` · ${x.requestTitle}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {x.tags.map((t) => t.name).join(", ")}
                  </td>
                  <td className="px-4 py-2.5">
                    <QuoteFeeling
                      workspaceId={ws.id}
                      kind={x.kind}
                      id={x.id}
                      value={x.sentiment}
                      source={x.sentimentSource}
                      canWrite={canWrite}
                    />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                    <LocalTime iso={x.at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextHref ? (
        <p>
          <Link href={nextHref} className={link}>
            Older quotes
          </Link>
        </p>
      ) : null}
    </section>
  );
}
