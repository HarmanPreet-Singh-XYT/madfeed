import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { QuoteFeeling } from "@/components/quote-feeling";
import { TagChip } from "@/components/tag-picker";
import { FEELINGS } from "@/lib/feelings";
import { link } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Quotes" };

/** A Radix Select cannot use an empty string as a value; this stands in for "no filter". */
const ANY = "__any";

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

const FILTER_LABEL = "mb-1 block text-xs font-medium text-muted-foreground";

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
    <section className="space-y-4">
      <PageHeader
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
          <Input
            id="m"
            name="m"
            defaultValue={meaning}
            maxLength={300}
            aria-describedby="m-help"
            placeholder="Describe what you are looking for in your own words"
            className="bg-card"
          />
          <Button type="submit" variant="outline" className="shrink-0">
            Search
          </Button>
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
                    <Card key={h.kind + h.id} asChild className="gap-0 py-3">
                      <li className="space-y-1 text-sm">
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
                    </Card>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : null}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
      >
        <div className="min-w-52 flex-1">
          <label htmlFor="q" className={FILTER_LABEL}>
            Words in the quote
          </label>
          <Input id="q" name="q" defaultValue={q} maxLength={200} />
        </div>
        <div>
          <span id="tag-label" className={FILTER_LABEL}>
            Tag
          </span>
          <Select name="tag" defaultValue={tag ?? ANY}>
            <SelectTrigger
              id="tag"
              aria-labelledby="tag-label"
              className="w-44"
            >
              <SelectValue placeholder="Any tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any tag</SelectItem>
              {tags.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <span id="sentiment-label" className={FILTER_LABEL}>
            How it feels
          </span>
          <Select name="sentiment" defaultValue={sentiment ?? ANY}>
            <SelectTrigger
              id="sentiment"
              aria-labelledby="sentiment-label"
              className="w-40"
            >
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any</SelectItem>
              <SelectItem value="positive">Positive</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="negative">Negative</SelectItem>
              <SelectItem value="mixed">Mixed</SelectItem>
              <SelectItem value="none">Not labelled yet</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <span id="source-label" className={FILTER_LABEL}>
            Where it came from
          </span>
          <Select name="source" defaultValue={sourceKind ?? ANY}>
            <SelectTrigger
              id="source"
              aria-labelledby="source-label"
              className="w-40"
            >
              <SelectValue placeholder="Anywhere" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Anywhere</SelectItem>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <span id="kind-label" className={FILTER_LABEL}>
            Kind
          </span>
          <Select name="kind" defaultValue={kind ?? ANY}>
            <SelectTrigger
              id="kind"
              aria-labelledby="kind-label"
              className="w-52"
            >
              <SelectValue placeholder="Evidence and highlights" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Evidence and highlights</SelectItem>
              <SelectItem value="evidence">Evidence for requests</SelectItem>
              <SelectItem value="highlight">Highlights</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <span id="view-label" className={FILTER_LABEL}>
            Show as
          </span>
          <Select name="view" defaultValue={board ? "board" : "table"}>
            <SelectTrigger
              id="view"
              aria-labelledby="view-label"
              className="w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="table">A table</SelectItem>
              <SelectItem value="board">A board, by how it feels</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline">
            Apply
          </Button>
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
                    <Card key={x.kind + x.id} asChild className="gap-0 py-3">
                      <li className="space-y-2 text-sm">
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
                    </Card>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div
            role="region"
            aria-label="Quotes, scrolls sideways on small screens"
            tabIndex={0}
            className="overflow-x-auto"
          >
            <Table containerClassName="overflow-visible">
              <TableCaption className="sr-only">
                Quotes, newest first
              </TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-transparent">
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">
                    Quote
                  </TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">
                    From
                  </TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">
                    Tags
                  </TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">
                    Feels
                  </TableHead>
                  <TableHead className="px-4 text-xs font-medium text-muted-foreground">
                    Date
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {res.quotes.map((x) => (
                  <TableRow key={x.kind + x.id} className="align-top">
                    <TableCell className="max-w-md px-4 py-2.5 whitespace-normal">
                      “{x.text}”
                    </TableCell>
                    <TableCell className="px-4 py-2.5 whitespace-normal">
                      {x.sourceTitle || "A source"}
                      <span className="block text-muted-foreground">
                        {SOURCE_LABEL[x.sourceKind] ?? x.sourceKind}
                        {x.requestTitle ? ` · ${x.requestTitle}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 whitespace-normal">
                      {x.tags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {x.tags.map((t) => (
                            <TagChip key={t.id} tag={t} />
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <QuoteFeeling
                        workspaceId={ws.id}
                        kind={x.kind}
                        id={x.id}
                        value={x.sentiment}
                        source={x.sentimentSource}
                        canWrite={canWrite}
                      />
                    </TableCell>
                    <TableCell className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      <LocalTime iso={x.at} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
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
