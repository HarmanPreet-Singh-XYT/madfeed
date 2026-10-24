import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { card, link } from "@/components/ui";

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
      <p>
        <Link href={`/w/${ws.id}/surveys/${sv.id}`} className={link}>
          ← {sv.title}
        </Link>
      </p>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Results: {sv.title}</h1>
        <p className="text-muted">
          {r.complete} finished {r.complete === 1 ? "answer" : "answers"}
          {r.partial > 0
            ? `, and ${r.partial} started but not finished (not counted below)`
            : ""}
          .
        </p>
      </div>
      {r.complete === 0 ? (
        <p className="text-muted">No finished answers yet.</p>
      ) : null}

      {r.numeric.map((n) => (
        <div key={n.questionId} className={`${card} space-y-2`}>
          <h2 className="font-medium">{prompt.get(n.questionId)}</h2>
          {n.kind === "nps" ? (
            <>
              <p
                className="text-3xl font-semibold"
                aria-label={`Net promoter score ${n.score}`}
              >
                {n.score > 0 ? "+" : ""}
                {n.score}
              </p>
              <p className="text-sm text-muted">
                {n.promoters} promoters (9–10), {n.passives} passive (7–8),{" "}
                {n.detractors} detractors (0–6) from {n.answers}{" "}
                {n.answers === 1 ? "answer" : "answers"}. Average{" "}
                {n.average.toFixed(1)} out of 10.
              </p>
            </>
          ) : (
            <p className="text-sm">
              Average <strong>{n.average.toFixed(1)}</strong> out of 5 from{" "}
              {n.answers} {n.answers === 1 ? "answer" : "answers"}.
            </p>
          )}
        </div>
      ))}

      {sv.questions
        .filter((q) => q.kind === "choice")
        .map((q) => {
          const rows = r.choices.filter((c) => c.questionId === q.id);
          const total = rows.reduce((a, c) => a + c.count, 0);
          return (
            <div key={q.id} className={`${card} space-y-2`}>
              <h2 className="font-medium">{q.prompt}</h2>
              <ul className="space-y-2 text-sm">
                {q.options.map((o) => {
                  const n = rows.find((c) => c.choice === o)?.count ?? 0;
                  return (
                    <li
                      key={o}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3"
                    >
                      <span>{o}</span>
                      <span className="text-muted">
                        {n}{" "}
                        {total > 0 ? `(${Math.round((n * 100) / total)}%)` : ""}
                      </span>
                      <progress
                        className="col-span-2 h-2 w-full"
                        value={n}
                        max={Math.max(total, 1)}
                        aria-label={`${o}: ${n} of ${total}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

      {sv.questions.some((q) => q.kind === "text") ? (
        <div className={`${card} space-y-3`}>
          <h2 className="font-medium">In their own words</h2>
          <p className="text-sm text-muted">
            These also go to your{" "}
            <Link href={`/w/${ws.id}/review`} className={link}>
              review queue
            </Link>
            , where you decide which become requests.
          </p>
          {r.text.length === 0 ? (
            <p className="text-sm text-muted">No written answers yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {r.text.map((t, i) => (
                <li key={i} className="space-y-1 py-3">
                  <p className="text-sm text-muted">
                    {prompt.get(t.questionId)} ·{" "}
                    {t.person || "someone who is no longer in People"}
                  </p>
                  <p className="whitespace-pre-wrap">{t.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
