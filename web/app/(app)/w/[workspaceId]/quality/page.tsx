import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { card } from "@/components/ui";
import { pct, plural } from "@/lib/format";
import { AuditPanel } from "@/components/audit-panel";

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
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Quality</h1>
        <p className="text-muted-foreground">
          How often our suggestions turn out to be right, based on what your
          team did with them in the last {q.days} days.
        </p>
      </div>

      {!q.enoughData ? (
        <div role="note" className={card}>
          <p className="font-medium">Not enough to judge yet</p>
          <p className="mt-1 text-muted-foreground">
            You&apos;ve ruled on {plural(decided, "suggestion")}. Rates start to
            mean something at {q.minDecided}, so we&apos;ll show them then.
            Until then the counts below are all there is.
          </p>
        </div>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-3">
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

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-base font-medium">
            Suggestions in the last {q.days} days
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                Accepted
              </th>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                …after a change
              </th>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                Dismissed
              </th>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                Waiting for review
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-2">{c.accepted}</td>
              <td className="px-2 py-2">{c.acceptedEdited}</td>
              <td className="px-2 py-2">{c.dismissed}</td>
              <td className="px-2 py-2">{c.stillOpen}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {q.byWeek.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-base font-medium">
              Week by week
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-border px-2 py-2 font-medium"
                >
                  Week of
                </th>
                <th
                  scope="col"
                  className="border-b border-border px-2 py-2 font-medium"
                >
                  Accepted
                </th>
                <th
                  scope="col"
                  className="border-b border-border px-2 py-2 font-medium"
                >
                  Dismissed
                </th>
                <th
                  scope="col"
                  className="border-b border-border px-2 py-2 font-medium"
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
                    className="border-b border-border px-2 py-2 font-normal"
                  >
                    {new Date(w.weekStart).toLocaleDateString()}
                  </th>
                  <td className="border-b border-border px-2 py-2">
                    {w.counts.accepted}
                  </td>
                  <td className="border-b border-border px-2 py-2">
                    {w.counts.dismissed}
                  </td>
                  <td className="border-b border-border px-2 py-2">
                    {pct(w.rates.accepted)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-base font-medium">
            What the AI cost
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                Task
              </th>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                Calls
              </th>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                Failed
              </th>
              <th
                scope="col"
                className="border-b border-border px-2 py-2 font-medium"
              >
                Cost (USD)
              </th>
            </tr>
          </thead>
          <tbody>
            {q.ai.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-2 text-muted-foreground">
                  No AI calls in this period.
                </td>
              </tr>
            ) : (
              q.ai.map((a) => (
                <tr key={a.task}>
                  <th
                    scope="row"
                    className="border-b border-border px-2 py-2 font-normal"
                  >
                    {a.task}
                  </th>
                  <td className="border-b border-border px-2 py-2">
                    {a.calls}
                  </td>
                  <td className="border-b border-border px-2 py-2">
                    {a.errors}
                  </td>
                  <td className="border-b border-border px-2 py-2">
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
            <h2 id="spot" className="text-lg font-medium">
              Spot checks
            </h2>
            <p className="text-muted-foreground">
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
  return (
    <div className={card}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold">{value}</dd>
      <dd className="text-sm text-muted-foreground">{detail}</dd>
    </div>
  );
}
