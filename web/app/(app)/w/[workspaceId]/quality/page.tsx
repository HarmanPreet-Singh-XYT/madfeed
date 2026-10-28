import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { pct, plural } from "@/lib/format";
import { AuditPanel } from "@/components/audit-panel";
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

type Props = { params: Promise<{ workspaceId: string }> };

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

async function Quality({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const q = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/quality", {
      params: { path: { workspaceId: ws.id }, query: { days: 30 } },
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

  return (
    <section className="space-y-6">
      <PageHeader
        icon={Gauge}
        hue="teal"
        title="Quality"
        description={`How often our suggestions turn out to be right, based on what your team did with them in the last ${q.days} days.`}
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
          />
          <Stat
            label="Accepted exactly as suggested"
            value={pct(r.acceptedAsIs)}
            detail="no changes needed"
          />
          <Stat
            label="Dismissed"
            value={pct(r.dismissed)}
            detail="of the suggestions you ruled on"
          />
        </dl>
      )}

      <TableCard
        label="Suggestion counts, scrolls sideways on small screens"
        title={`Suggestions in the last ${q.days} days`}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={TH}>Accepted</TableHead>
            <TableHead className={TH}>…after a change</TableHead>
            <TableHead className={TH}>Dismissed</TableHead>
            <TableHead className={TH}>Waiting for review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="hover:bg-transparent">
            <TableCell className={TD}>{c.accepted}</TableCell>
            <TableCell className={TD}>{c.acceptedEdited}</TableCell>
            <TableCell className={TD}>{c.dismissed}</TableCell>
            <TableCell className={TD}>{c.stillOpen}</TableCell>
          </TableRow>
        </TableBody>
      </TableCard>

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
              <TableHead className={TH}>Accepted rate</TableHead>
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
                      className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
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
        label="AI cost, scrolls sideways on small screens"
        title="What the AI cost"
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={TH}>Task</TableHead>
            <TableHead className={TH}>Calls</TableHead>
            <TableHead className={TH}>Failed</TableHead>
            <TableHead className={TH}>Cost (USD)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.ai.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={4}
                className="px-4 py-2 text-muted-foreground"
              >
                No AI calls in this period.
              </TableCell>
            </TableRow>
          ) : (
            q.ai.map((a) => (
              <TableRow key={a.task} className="hover:bg-transparent">
                <TableHead scope="row" className={`${TD} font-medium`}>
                  {a.task}
                </TableHead>
                <TableCell className={TD}>{a.calls}</TableCell>
                <TableCell className={TD}>{a.errors}</TableCell>
                <TableCell className={TD}>
                  {Number(a.costUsd).toFixed(4)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </TableCard>

      {audit ? (
        <section aria-labelledby="spot" className="space-y-4">
          <div className="space-y-1">
            <h2 id="spot">Spot checks</h2>
            <p className="text-sm text-muted-foreground">
              Every week a few of the assistant&apos;s answers and briefs are
              set aside for you to check against the quotes they cite.
              {audit.reviewed > 0
                ? ` You've checked ${audit.reviewed}: ${audit.supported} ${audit.supported === 1 ? "was" : "were"} backed by their quotes.`
                : ""}
              {audit.waiting > 0 ? ` ${audit.waiting} waiting.` : ""}
            </p>
          </div>
          <AuditPanel workspaceId={ws.id} items={audit.items} />
        </section>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
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
    </Card>
  );
}
