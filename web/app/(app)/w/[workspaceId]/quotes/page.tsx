import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { QuoteFeeling } from "@/components/quote-feeling";
import { FEELINGS } from "@/lib/feelings";
import { btn, card, field, link } from "@/components/ui";

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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Quotes</h1>
        <p className="text-muted">
          Every customer quote in one place, with filters. Open{" "}
          <Link href={`/w/${ws.id}/quotes/trends`} className={link}>
            tags over time
          </Link>{" "}
          or{" "}
          <Link href={`/w/${ws.id}/findings`} className={link}>
            write up findings
          </Link>
          .
        </p>
      </div>
      <form method="get" className={`${card} space-y-3`}>
        <div>
          <label htmlFor="m" className="mb-1 block text-sm font-medium">
            Search by meaning
          </label>
          <input
            id="m"
            name="m"
            defaultValue={meaning}
            maxLength={300}
            aria-describedby="m-help"
            className={field}
          />
          <p id="m-help" className="mt-1 text-sm text-muted">
            Describe what you are looking for in your own words. Finds quotes
            that mean the same, even when they use different words.
          </p>
        </div>
        <button type="submit" className={btn}>
          Search
        </button>
      </form>
      {found ? (
        <div className="space-y-3" aria-live="polite">
          {!found.ready ? (
            <p className="text-muted">
              Searching by meaning is not set up yet. Words in a quote still
              work below.
            </p>
          ) : (
            <>
              {found.pending > 0 ? (
                <p className="text-muted">
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
                      className={`${card} space-y-1 text-sm`}
                    >
                      <p>“{h.text}”</p>
                      <p className="text-muted">
                        <Link
                          href={`/w/${ws.id}/sources/${h.sourceItemId}`}
                          className={link}
                        >
                          {h.sourceTitle || "A source"}
                        </Link>
                        {" · "}
                        {new Date(h.at).toLocaleDateString()}
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
        className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-3`}
      >
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor="q" className="mb-1 block text-sm font-medium">
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
          <label htmlFor="tag" className="mb-1 block text-sm font-medium">
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
          <label htmlFor="sentiment" className="mb-1 block text-sm font-medium">
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
          <label htmlFor="source" className="mb-1 block text-sm font-medium">
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
          <label htmlFor="kind" className="mb-1 block text-sm font-medium">
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
          <label htmlFor="view" className="mb-1 block text-sm font-medium">
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
        <div className="flex items-end gap-3">
          <button type="submit" className={btn}>
            Apply
          </button>
          <Link href={`/w/${ws.id}/quotes`} className={link}>
            Clear
          </Link>
        </div>
      </form>

      {res.quotes.length === 0 ? (
        <p className="text-muted">No quotes match.</p>
      ) : board ? (
        <div
          className="grid gap-4 lg:grid-cols-5"
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
                <h2 id={`col-${c.id}`} className="font-medium">
                  {c.title} <span className="text-muted">({items.length})</span>
                </h2>
                <ul className="space-y-3">
                  {items.map((x) => (
                    <li
                      key={x.kind + x.id}
                      className={`${card} space-y-2 text-sm`}
                    >
                      <p>“{x.text}”</p>
                      <p className="text-muted">{x.sourceTitle}</p>
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Quotes, newest first</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-3">
                  Quote
                </th>
                <th scope="col" className="py-2 pr-3">
                  From
                </th>
                <th scope="col" className="py-2 pr-3">
                  Tags
                </th>
                <th scope="col" className="py-2 pr-3">
                  Feels
                </th>
                <th scope="col" className="py-2">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {res.quotes.map((x) => (
                <tr key={x.kind + x.id} className="align-top">
                  <td className="max-w-md py-2 pr-3">“{x.text}”</td>
                  <td className="py-2 pr-3">
                    {x.sourceTitle || "A source"}
                    <span className="block text-muted">
                      {SOURCE_LABEL[x.sourceKind] ?? x.sourceKind}
                      {x.requestTitle ? ` · ${x.requestTitle}` : ""}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {x.tags.map((t) => t.name).join(", ")}
                  </td>
                  <td className="py-2 pr-3">
                    <QuoteFeeling
                      workspaceId={ws.id}
                      kind={x.kind}
                      id={x.id}
                      value={x.sentiment}
                      source={x.sentimentSource}
                      canWrite={canWrite}
                    />
                  </td>
                  <td className="whitespace-nowrap py-2">
                    {new Date(x.at).toLocaleDateString()}
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
