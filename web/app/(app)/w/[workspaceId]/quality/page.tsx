import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { pct, plural } from "@/lib/format";
import { AuditPanel } from "@/components/audit-panel";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Quality" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function QualityPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Quality {...props} />
    </Suspense>
  );
}

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

      <div
        role="region"
        aria-label="Suggestion counts, scrolls sideways on small screens"
        tabIndex={0}
        className="overflow-x-auto rounded-2xl bg-card shadow-card"
      >
        <table className="w-full text-left text-sm">
          <caption className="border-b border-border px-4 py-2.5 text-left text-sm font-semibold">
            Suggestions in the last {q.days} days
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                Accepted
              </th>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                …after a change
              </th>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                Dismissed
              </th>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                Waiting for review
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-2 tabular-nums">{c.accepted}</td>
              <td className="px-4 py-2 tabular-nums">{c.acceptedEdited}</td>
              <td className="px-4 py-2 tabular-nums">{c.dismissed}</td>
              <td className="px-4 py-2 tabular-nums">{c.stillOpen}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {q.byWeek.length > 0 ? (
        <div
          role="region"
          aria-label="Week by week, scrolls sideways on small screens"
          tabIndex={0}
          className="overflow-x-auto rounded-2xl bg-card shadow-card"
        >
          <table className="w-full text-left text-sm">
            <caption className="border-b border-border px-4 py-2.5 text-left text-sm font-semibold">
              Week by week
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                >
                  Week of
                </th>
                <th
                  scope="col"
                  className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                >
                  Accepted
                </th>
                <th
                  scope="col"
                  className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                >
                  Dismissed
                </th>
                <th
                  scope="col"
                  className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                >
                  Accepted rate
                </th>
              </tr>
            </thead>
            <tbody>
              {q.byWeek.map((w) => (
                <tr key={w.weekStart}>
                  <th
                    scope="row"
                    className="border-b border-border px-4 py-2 font-medium"
                  >
                    <LocalTime iso={w.weekStart} />
                  </th>
                  <td className="border-b border-border px-4 py-2 tabular-nums">
                    {w.counts.accepted}
                  </td>
                  <td className="border-b border-border px-4 py-2 tabular-nums">
                    {w.counts.dismissed}
                  </td>
                  <td className="border-b border-border px-4 py-2 tabular-nums">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div
        role="region"
        aria-label="AI cost, scrolls sideways on small screens"
        tabIndex={0}
        className="overflow-x-auto rounded-2xl bg-card shadow-card"
      >
        <table className="w-full text-left text-sm">
          <caption className="border-b border-border px-4 py-2.5 text-left text-sm font-semibold">
            What the AI cost
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                Task
              </th>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                Calls
              </th>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                Failed
              </th>
              <th
                scope="col"
                className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
              >
                Cost (USD)
              </th>
            </tr>
          </thead>
          <tbody>
            {q.ai.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-2 text-muted-foreground">
                  No AI calls in this period.
                </td>
              </tr>
            ) : (
              q.ai.map((a) => (
                <tr key={a.task}>
                  <th
                    scope="row"
                    className="border-b border-border px-4 py-2 font-medium"
                  >
                    {a.task}
                  </th>
                  <td className="border-b border-border px-4 py-2 tabular-nums">
                    {a.calls}
                  </td>
                  <td className="border-b border-border px-4 py-2 tabular-nums">
                    {a.errors}
                  </td>
                  <td className="border-b border-border px-4 py-2 tabular-nums">
                    {Number(a.costUsd).toFixed(4)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
    <div className="rounded-2xl bg-card shadow-card p-4">
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
    </div>
  );
}
