import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { SurveyResultsCsv } from "@/components/survey-results-csv";
import { PageHeader, Stat } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";

export const metadata = { title: "Survey results" };

type Props = { params: Promise<{ workspaceId: string; surveyId: string }> };

export default function ResultsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Results {...props} />
    </Suspense>
  );
}

async function Results({ params }: Props) {
  const { workspaceId, surveyId } = await params;
  if (!isUuid(surveyId)) notFound();
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const path = { workspaceId: ws.id, surveyId };
  const sres = await client.GET(
    "/v1/workspaces/{workspaceId}/surveys/{surveyId}",
    { params: { path } },
  );
  if (sres.response.status === 404) notFound();
  const sv = unwrap(sres);
  const r = unwrap(
    await client.GET(
      "/v1/workspaces/{workspaceId}/surveys/{surveyId}/results",
      {
        params: { path },
      },
    ),
  );
  const prompt = new Map(sv.questions.map((q) => [q.id, q.prompt]));
  return (
    <section className="space-y-6">
      <PageHeader
        back={{ href: `/w/${ws.id}/surveys/${sv.id}`, label: sv.title }}
        title={<>Results: {sv.title}</>}
        description={
          <>
            {r.complete} finished {r.complete === 1 ? "answer" : "answers"}
            {r.partial > 0
              ? `, and ${r.partial} started but not finished (not counted below)`
              : ""}
            .
          </>
        }
        actions={
          r.complete > 0 ? (
            <SurveyResultsCsv
              title={sv.title}
              questions={sv.questions}
              results={r}
            />
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Finished answers" value={r.complete} />
        <Stat
          label="Started, not finished"
          value={r.partial}
          hint={r.partial > 0 ? "Not counted in the results below" : undefined}
        />
        <Stat
          label="Completion"
          value={`${r.complete + r.partial === 0 ? 0 : Math.round((r.complete * 100) / (r.complete + r.partial))}%`}
          hint="Of everyone who started"
        />
      </div>

      {r.complete === 0 ? (
        <p className="text-muted-foreground">No finished answers yet.</p>
      ) : null}

      {r.numeric.map((n) => (
        <Card key={n.questionId} className="[--card-spacing:0px] p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-medium">{prompt.get(n.questionId)}</h2>
            <Badge variant={n.kind === "nps" ? "tint-blue" : "tint-sky"}>
              {n.kind === "nps" ? "NPS" : "CSAT"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {n.answers} of {r.complete} finished{" "}
            {r.complete === 1 ? "answer" : "answers"}
          </p>
          {n.answers === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No answers yet.
            </p>
          ) : n.kind === "nps" ? (
            <div className="mt-3 grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <div
                className={`rounded-xl px-4 py-3 ${
                  n.score >= 30
                    ? "bg-tint-teal"
                    : n.score >= 0
                      ? "bg-tint-amber"
                      : "bg-tint-coral"
                }`}
              >
                <p
                  className="text-3xl font-semibold tabular-nums"
                  aria-label={`Net promoter score ${n.score}`}
                >
                  {n.score > 0 ? "+" : ""}
                  {n.score}
                </p>
                <p className="text-xs text-muted-foreground">
                  Net promoter score
                </p>
              </div>
              <ul className="space-y-2 text-sm">
                {[
                  {
                    label: "Promoters (9–10)",
                    count: n.promoters,
                    tone: "bg-hue-teal",
                  },
                  {
                    label: "Passive (7–8)",
                    count: n.passives,
                    tone: "bg-hue-amber",
                  },
                  {
                    label: "Detractors (0–6)",
                    count: n.detractors,
                    tone: "bg-hue-coral",
                  },
                ].map((row) => (
                  <li
                    key={row.label}
                    className="grid grid-cols-[8.5rem_minmax(0,1fr)_2rem] items-center gap-2"
                  >
                    <span className="text-muted-foreground">{row.label}</span>
                    <span
                      aria-hidden="true"
                      className="h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className={`block h-full rounded-full ${row.tone}`}
                        style={{
                          width: `${n.answers > 0 ? (row.count * 100) / n.answers : 0}%`,
                        }}
                      />
                    </span>
                    <span className="text-right tabular-nums">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-3xl font-semibold tabular-nums">
                {n.average.toFixed(1)}
              </p>
              <p className="text-sm text-muted-foreground">
                out of 5 · {n.answers} {n.answers === 1 ? "answer" : "answers"}
              </p>
            </div>
          )}
        </Card>
      ))}

      {sv.questions
        .filter((q) => q.kind === "choice")
        .map((q) => {
          const rows = r.choices.filter((c) => c.questionId === q.id);
          const total = rows.reduce((a, c) => a + c.count, 0);
          return (
            <Card key={q.id} className="[--card-spacing:0px] space-y-2 p-5">
              <h2 className="font-medium">{q.prompt}</h2>
              <p className="text-xs text-muted-foreground tabular-nums">
                {total} of {r.complete} finished{" "}
                {r.complete === 1 ? "answer" : "answers"}
              </p>
              {total === 0 ? (
                <p className="text-sm text-muted-foreground">No answers yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {q.options.map((o) => {
                    const n = rows.find((c) => c.choice === o)?.count ?? 0;
                    return (
                      <li key={o} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span>{o}</span>
                          <span className="text-muted-foreground tabular-nums">
                            {n}
                            {total > 0
                              ? ` · ${Math.round((n * 100) / total)}%`
                              : ""}
                          </span>
                        </div>
                        <div
                          aria-hidden="true"
                          className="h-2 overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className="h-full rounded-full bg-chart-1"
                            style={{
                              width: `${total > 0 ? (n * 100) / total : 0}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}

      {sv.questions.some((q) => q.kind === "text") ? (
        <Panel
          title="In their own words"
          className="[&_[data-slot=card-content]]:space-y-3"
        >
          <p className="text-sm text-muted-foreground">
            These also go to your{" "}
            <Link href={`/w/${ws.id}/review`} className={link}>
              review queue
            </Link>
            , where you decide which become requests.
          </p>
          {r.text.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No written answers yet.
            </p>
          ) : (
            <div className="space-y-5">
              {sv.questions
                .filter((q) => q.kind === "text")
                .map((q) => {
                  const answers = r.text.filter((t) => t.questionId === q.id);
                  if (answers.length === 0) return null;
                  return (
                    <div key={q.id} className="space-y-2">
                      <h3 className="text-sm font-medium">{q.prompt}</h3>
                      <ul className="space-y-2">
                        {answers.map((t, i) => (
                          <li
                            key={i}
                            className="rounded-lg border border-border p-3"
                          >
                            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              <span>
                                {t.person ||
                                  "Someone who is no longer in People"}
                              </span>
                              {t.at ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <LocalTime iso={t.at} />
                                </>
                              ) : null}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap">{t.text}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
            </div>
          )}
        </Panel>
      ) : null}
    </section>
  );
}
