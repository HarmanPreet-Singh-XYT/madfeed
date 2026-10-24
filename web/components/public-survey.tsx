import { notFound } from "next/navigation";
import { publicApi } from "@/lib/server/api";
import { SurveyForm } from "./survey-form";

const TOKEN = /^[A-Za-z0-9._-]{20,200}$/;

/** The survey a link opens: the questions, or a plain message when it is closed or already answered. */
export async function PublicSurvey({ token }: { token: string }) {
  if (!TOKEN.test(token)) notFound();
  const res = await publicApi().GET("/v1/public/surveys/{token}", {
    params: { path: { token } },
    cache: "no-store",
  });
  if (res.response.status === 404 || !res.data) notFound();
  const s = res.data;
  if (s.closed)
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p role="status">
          This survey is closed and is not taking answers any more. Thank you
          for your interest.
        </p>
      </div>
    );
  if (s.answered)
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p role="status">You have already answered this survey. Thank you.</p>
      </div>
    );
  return (
    <SurveyForm
      token={token}
      title={s.title}
      intro={s.intro}
      questions={s.questions.map((q) => ({
        ...q,
        showIf: q.showIf,
        showWhen: q.showWhen,
      }))}
      saved={s.saved.map((a) => ({
        questionId: a.questionId,
        ...(a.number !== undefined ? { number: a.number } : {}),
        ...(a.choice !== undefined ? { choice: a.choice } : {}),
        ...(a.text !== undefined ? { text: a.text } : {}),
      }))}
    />
  );
}
