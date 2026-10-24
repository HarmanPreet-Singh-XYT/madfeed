import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { ClassifyButton } from "@/components/classify-button";
import { FEELINGS } from "@/lib/feelings";
import { card, link } from "@/components/ui";

export const metadata = { title: "Tags over time" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function TrendsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Trends {...props} />
    </Suspense>
  );
}

async function Trends({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const { tags } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/trends", {
      params: { path: { workspaceId: ws.id }, query: { weeks: 12 } },
    }),
  );
  const st = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/sentiment", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  // the same 12 weeks for every tag, oldest first
  const monday = (d: Date) => {
    const x = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x;
  };
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const d = monday(new Date());
    d.setUTCDate(d.getUTCDate() - 7 * (11 - i));
    return d.toISOString().slice(0, 10);
  });
  const shown = tags
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/quotes`} className={link}>
          ← All quotes
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Tags over time</h1>
        <p className="text-muted">
          How many quotes each tag collected in the last 12 weeks, and how they
          feel. A person&apos;s label always wins over the model&apos;s.
        </p>
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">
          How well does the model read feelings?
        </h2>
        {st.compared === 0 ? (
          <p className="text-sm">
            Not measured yet. Label some quotes yourself, then let the model
            label them too, and this compares the two.{" "}
            <Link href={`/w/${ws.id}/quotes/label`} className={link}>
              Label quotes
            </Link>
          </p>
        ) : (
          <>
            <p className="text-sm">
              The model matched people on <strong>{st.agreed}</strong> of{" "}
              <strong>{st.compared}</strong> quotes (
              <strong>{pct(st.accuracy)}</strong>
              ). The target is {pct(st.target)}.{" "}
              {st.enough
                ? st.meetsTarget
                  ? "It meets the target."
                  : "It does not meet the target yet, so treat its labels with care."
                : "That is too few quotes to count: at least 200 are needed before this number means anything."}
            </p>
            <table className="text-sm">
              <caption className="sr-only">
                Person&apos;s label against the model&apos;s
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-4 text-left">
                    Person said
                  </th>
                  <th scope="col" className="pr-4 text-left">
                    Model said
                  </th>
                  <th scope="col" className="text-left">
                    Quotes
                  </th>
                </tr>
              </thead>
              <tbody>
                {st.pairs.map((p) => (
                  <tr key={p.human + p.model}>
                    <td className="pr-4">{p.human}</td>
                    <td className="pr-4">{p.model}</td>
                    <td>{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Link href={`/w/${ws.id}/quotes/label`} className={link}>
              Label more quotes
            </Link>
          </>
        )}
        {ws.role !== "viewer" ? (
          <ClassifyButton workspaceId={ws.id} pending={st.pending} />
        ) : null}
      </div>

      {shown.length === 0 ? (
        <p className="text-muted">
          No tagged quotes in the last 12 weeks. Tag some highlights or requests
          and they show up here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Quotes per tag per week, last 12 weeks
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-3">
                  Tag
                </th>
                <th scope="col" className="py-2 pr-3">
                  Quotes
                </th>
                <th scope="col" className="py-2 pr-3">
                  How they feel
                </th>
                <th scope="col" className="py-2">
                  Per week, oldest first
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((t) => {
                const by = new Map(t.weeks.map((w) => [w.week, w.count]));
                const counts = weeks.map((w) => by.get(w) ?? 0);
                const peak = Math.max(...counts, 1);
                return (
                  <tr key={t.id} className="align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      <Link
                        href={`/w/${ws.id}/quotes?tag=${t.id}`}
                        className={link}
                      >
                        {t.name}
                      </Link>
                    </th>
                    <td className="py-2 pr-3">{t.total}</td>
                    <td className="py-2 pr-3">
                      {(Object.keys(FEELINGS) as (keyof typeof FEELINGS)[])
                        .filter((k) => (t.byFeeling[k] ?? 0) > 0)
                        .map((k) => `${FEELINGS[k]} ${t.byFeeling[k]}`)
                        .join(" · ") || "No labels"}
                      {(t.byFeeling.none ?? 0) > 0
                        ? ` · not labelled ${t.byFeeling.none}`
                        : ""}
                    </td>
                    <td className="py-2">
                      <span
                        className="flex items-end gap-0.5"
                        role="img"
                        aria-label={`Quotes per week: ${counts.join(", ")}`}
                      >
                        {counts.map((c, i) => (
                          <span
                            key={i}
                            aria-hidden="true"
                            className="inline-block w-2 bg-accent-solid"
                            style={{
                              height: `${Math.max(2, Math.round((c / peak) * 32))}px`,
                            }}
                          />
                        ))}
                      </span>
                      <span className="text-muted">{counts.join(" ")}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
