import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { pct, plural } from "@/lib/format";
import { AuditPanel } from "@/components/audit-panel";
import { Panel, Segmented } from "@/components/app/panel";
import {
  outcomeSegments,
  outcomeWidths,
  parseQualityDays,
  rateDelta,
  QUALITY_RANGES,
} from "@/lib/quality";
import { link } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Quality" };

const VERDICT_LABELS: Record<string, string> = {
  already_supported: "Already possible",
  known_issue: "Known issue",
  demand_signal: "Others want it too",
  no_signal: "Nothing public",
};

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ days?: string }>;
};

export default function QualityPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Quality {...props} />
    </Suspense>
  );
}

// A table on a product screen: a titled card that can scroll sideways on small screens without widening the page.
function TableCard({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="overflow-x-auto"
      >
        <Table containerClassName="overflow-visible">
          <TableCaption className="mt-0 border-b border-border px-4 py-2.5 text-left text-sm font-semibold text-foreground">
            {title}
          </TableCaption>
          {children}
        </Table>
      </div>
    </Card>
  );
}

const TH =
  "h-9 border-b border-border bg-muted/50 px-4 text-xs font-medium text-muted-foreground";
const TD = "border-b border-border px-4 py-2 tabular-nums";

async function Quality({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const days = parseQualityDays((await searchParams).days);
  const ws = await getWorkspace(workspaceId);
  const q = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/quality", {
      params: { path: { workspaceId: ws.id }, query: { days } },
    }),
  );
  const audit =
    ws.role === "admin"
      ? unwrap(
          await (
            await api()
          ).GET("/v1/workspaces/{workspaceId}/audit", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const c = q.total.counts;
  const decided = c.accepted + c.dismissed;
  const r = q.total.rates;
  const previousDecided =
    q.previous.counts.accepted + q.previous.counts.dismissed;

  return (
    <section className="space-y-6">
      <PageHeader
        icon={Gauge}
        hue="teal"
        title="Quality"
        description={`How often our suggestions turn out to be right, based on what your team did with them in the last ${q.days} days.`}
      />

      <Segmented
        label="Time range"
        items={QUALITY_RANGES.map((d) => ({
          href: `/w/${ws.id}/quality?days=${d}`,
          label: `${d} days`,
          active: q.days === d,
        }))}
      />

      {!q.enoughData ? (
        <div role="note" className="rounded-lg bg-tint-amber p-4 text-sm">
          <p className="font-semibold">Not enough to judge yet</p>
          <p className="mt-1">
            You&apos;ve ruled on {plural(decided, "suggestion")}. Rates start to
            mean something at {q.minDecided}, so we&apos;ll show them then.
            Until then the counts below are all there is.
          </p>
        </div>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Accepted"
            value={pct(r.accepted)}
            detail="of the suggestions you ruled on"
            delta={rateDelta(
              r.accepted,
              q.previous.rates.accepted,
              previousDecided,
              q.minDecided,
            )}
            days={q.days}
          />
          <Stat
            label="Accepted exactly as suggested"
            value={pct(r.acceptedAsIs)}
            detail="no changes needed"
            delta={rateDelta(
              r.acceptedAsIs,
              q.previous.rates.acceptedAsIs,
              previousDecided,
              q.minDecided,
            )}
            days={q.days}
          />
          <Stat
            label="Dismissed"
            value={pct(r.dismissed)}
            detail="of the suggestions you ruled on"
            delta={rateDelta(
              r.dismissed,
              q.previous.rates.dismissed,
              previousDecided,
              q.minDecided,
            )}
            days={q.days}
          />
        </dl>
      )}

      <OutcomeCard workspaceId={ws.id} days={q.days} counts={c} />

      {q.bySource.length > 0 ? (
        <TableCard
          label="Where the suggestions came from, scrolls sideways on small screens"
          title={`Where they came from, in the last ${q.days} days`}
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={TH}>Source</TableHead>
              <TableHead className={TH}>Accepted</TableHead>
              <TableHead className={TH}>Dismissed</TableHead>
              <TableHead className={TH}>Accepted rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.bySource.map((src) => (
              <TableRow key={src.kind} className="hover:bg-transparent">
                <TableHead
                  scope="row"
                  className={`${TD} font-medium capitalize`}
                >
                  {src.kind}
                </TableHead>
                <TableCell className={TD}>{src.counts.accepted}</TableCell>
                <TableCell className={TD}>{src.counts.dismissed}</TableCell>
                <TableCell className={TD}>
                  {src.rates.accepted === undefined
                    ? "Not enough yet"
                    : pct(src.rates.accepted)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : null}

      {q.byWeek.length > 0 ? (
        <TableCard
          label="Week by week, scrolls sideways on small screens"
          title="Week by week"
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={TH}>Week of</TableHead>
              <TableHead className={TH}>Accepted</TableHead>
              <TableHead className={TH}>Dismissed</TableHead>
              <TableHead className={TH}>Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.byWeek.map((w) => (
              <TableRow key={w.weekStart} className="hover:bg-transparent">
                <TableHead scope="row" className={`${TD} font-medium`}>
                  <LocalTime iso={w.weekStart} />
                </TableHead>
                <TableCell className={TD}>{w.counts.accepted}</TableCell>
                <TableCell className={TD}>{w.counts.dismissed}</TableCell>
                <TableCell className={TD}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:block"
                    >
                      <span
                        className="block h-full rounded-full bg-seq-4"
                        style={{
                          width: `${Math.round((w.rates.accepted ?? 0) * 100)}%`,
                        }}
                      />
                    </span>
                    {pct(w.rates.accepted)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : null}

      <TableCard
        label="Models used, scrolls sideways on small screens"
        title="Which model did what"
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={TH}>Task</TableHead>
            <TableHead className={TH}>Model</TableHead>
            <TableHead className={TH}>Calls</TableHead>
            <TableHead className={TH}>Failed</TableHead>
            <TableHead className={TH}>Cost (USD)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.ai.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="px-4 py-2 text-muted-foreground"
              >
                No AI calls in this period.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {q.ai.map((a) => (
                <TableRow
                  key={`${a.task}|${a.provider}|${a.model}`}
                  className="hover:bg-transparent"
                >
                  <TableHead scope="row" className={`${TD} font-medium`}>
                    {a.task}
                  </TableHead>
                  <TableCell
                    className={`${TD} max-w-[22rem] truncate font-mono text-xs`}
                    title={`${a.provider} · ${a.model}`}
                  >
                    {a.model}
                  </TableCell>
                  <TableCell className={TD}>{a.calls}</TableCell>
                  <TableCell className={TD}>{a.errors}</TableCell>
                  <TableCell className={TD}>
                    {Number(a.costUsd).toFixed(4)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead scope="row" className={`${TD} font-medium`}>
                  Total
                </TableHead>
                <TableCell className={TD} />
                <TableCell className={`${TD} font-medium`}>
                  {q.ai.reduce((n, a) => n + a.calls, 0)}
                </TableCell>
                <TableCell className={`${TD} font-medium`}>
                  {q.ai.reduce((n, a) => n + a.errors, 0)}
                </TableCell>
                <TableCell className={`${TD} font-medium`}>
                  {q.ai.reduce((n, a) => n + Number(a.costUsd), 0).toFixed(4)}
                </TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </TableCard>

      {q.publicSignals.length > 0 ? (
        <TableCard
          label="Public sources, scrolls sideways on small screens"
          title="What the web said about these requests"
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={TH}>Verdict</TableHead>
              <TableHead className={TH}>Requests</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.publicSignals.map((v) => (
              <TableRow key={v.verdict} className="hover:bg-transparent">
                <TableHead scope="row" className={`${TD} font-medium`}>
                  {VERDICT_LABELS[v.verdict] ?? v.verdict}
                </TableHead>
                <TableCell className={TD}>{v.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      ) : null}

      {q.alreadyPossible.length > 0 ? (
        <Card asChild className="[--card-spacing:0px] space-y-3 p-5">
          <section aria-labelledby="already-possible-h">
            <h2 id="already-possible-h" className="text-lg font-medium">
              Already possible
            </h2>
            <p className="text-muted-foreground">
              The public check found these already documented or already
              shipped. Write the documentation instead of building them.
            </p>
            <ul className="space-y-2">
              {q.alreadyPossible.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/w/${ws.id}/requests/${r.id}`}
                    className={`${link} font-medium`}
                  >
                    {r.title}
                  </Link>
                  {r.urls[0] ? (
                    <>
                      {" "}
                      <a
                        href={r.urls[0]}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={link}
                      >
                        source
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </Card>
      ) : null}

      {audit ? (
        <Panel
          title="Spot checks"
          description={
            <>
              Every week a few of the assistant&apos;s answers and briefs are
              set aside for you to check against the quotes they cite.
              {audit.reviewed > 0
                ? ` You've checked ${audit.reviewed}: ${audit.supported} ${audit.supported === 1 ? "was" : "were"} backed by their quotes.`
                : ""}
              {audit.waiting > 0 ? ` ${audit.waiting} waiting.` : ""}
            </>
          }
        >
          <AuditPanel workspaceId={ws.id} items={audit.items} />
        </Panel>
      ) : null}
    </section>
  );
}

function OutcomeCard({
  workspaceId,
  days,
  counts,
}: {
  workspaceId: string;
  days: number;
  counts: {
    accepted: number;
    acceptedEdited: number;
    dismissed: number;
    stillOpen: number;
  };
}) {
  const decided = counts.accepted + counts.dismissed;
  const total = decided + counts.stillOpen;
  const rows = outcomeSegments(counts);
  const widths = outcomeWidths(counts);
  return (
    <Card className="gap-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-medium">What happened to the suggestions</h2>
          <p className="text-sm text-muted-foreground">
            {decided === 0
              ? `Nothing was ruled on in the last ${days} days.`
              : `${plural(decided, "suggestion")} ruled on in the last ${days} days.`}
          </p>
        </div>
        {counts.stillOpen > 0 ? (
          <Link href={`/w/${workspaceId}/review`} className={link}>
            Review {plural(counts.stillOpen, "waiting suggestion")}
          </Link>
        ) : null}
      </div>

      {total === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          When suggestions start arriving they will show up here.
        </p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted"
          >
            {rows.map((row) =>
              widths[row.key] > 0 ? (
                <span
                  key={row.key}
                  className={row.tone}
                  style={{ width: `${widths[row.key]}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={`size-2.5 shrink-0 rounded-full ${row.tone}`}
                />
                <span className="min-w-0 flex-1">{row.label}</span>
                <span className="tabular-nums">{row.count}</span>
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                  {row.key === "stillOpen" ? "" : `${row.percent}%`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Percentages are of the {plural(decided, "suggestion")} you ruled on.
            Waiting suggestions are not counted in the rates.
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  detail,
  delta,
  days,
}: {
  label: string;
  value: string;
  detail: string;
  delta: { kind: "up" | "down" | "same" | "none"; points: number };
  days: number;
}) {
  const n = Number.parseFloat(value);
  return (
    <Card className="gap-0 px-4 py-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </dd>
      {Number.isFinite(n) ? (
        <dd
          aria-hidden="true"
          className="my-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-seq-4"
            style={{ width: `${Math.min(100, n)}%` }}
          />
        </dd>
      ) : null}
      <dd className="text-xs text-muted-foreground">{detail}</dd>
      <dd className="mt-1 text-xs text-muted-foreground">
        {delta.kind === "none"
          ? "No comparable period yet"
          : delta.kind === "same"
            ? `Same as the previous ${days} days`
            : `${delta.kind === "up" ? "↑" : "↓"} ${delta.points} points vs the previous ${days} days`}
      </dd>
    </Card>
  );
}
