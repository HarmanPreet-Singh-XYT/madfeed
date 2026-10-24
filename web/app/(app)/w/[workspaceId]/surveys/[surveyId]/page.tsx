import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { Loading } from "@/components/loading";
import { SurveyDetailsForm } from "@/components/survey-details-form";
import { SurveyQuestionsEditor } from "@/components/survey-questions-editor";
import { SurveyAudienceEditor } from "@/components/survey-audience-editor";
import { SurveyInvites } from "@/components/survey-invites";
import { SurveyControls } from "@/components/survey-controls";
import { card, link } from "@/components/ui";

export const metadata = { title: "Survey" };

type Props = { params: Promise<{ workspaceId: string; surveyId: string }> };

export default function SurveyPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Survey {...props} />
    </Suspense>
  );
}

async function Survey({ params }: Props) {
  const { workspaceId, surveyId } = await params;
  if (!isUuid(surveyId)) notFound();
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const res = await client.GET(
    "/v1/workspaces/{workspaceId}/surveys/{surveyId}",
    {
      params: { path: { workspaceId: ws.id, surveyId } },
    },
  );
  if (res.response.status === 404) notFound();
  const sv = unwrap(res);
  const canWrite = ws.role !== "viewer";
  const invited = sv.delivery === "invited";
  const { requests } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/requests", {
      params: { path: { workspaceId: ws.id }, query: { limit: 100 } },
    }),
  );
  const invitesRes = invited
    ? unwrap(
        await client.GET(
          "/v1/workspaces/{workspaceId}/surveys/{surveyId}/invites",
          { params: { path: { workspaceId: ws.id, surveyId } } },
        ),
      )
    : undefined;
  const invites = invitesRes?.invites ?? [];
  const wording = invited
    ? unwrap(
        await client.GET(
          "/v1/workspaces/{workspaceId}/surveys/{surveyId}/invites/preview",
          { params: { path: { workspaceId: ws.id, surveyId } } },
        ),
      )
    : undefined;
  const publicLink = sv.publicLink;
  const embedUrl = publicLink
    ? publicLink.replace("/s/", "/embed/s/")
    : undefined;
  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/surveys`} className={link}>
          ← All surveys
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{sv.title}</h1>
        <Link href={`/w/${ws.id}/surveys/${sv.id}/results`} className={link}>
          Results ({sv.responses} {sv.responses === 1 ? "answer" : "answers"})
        </Link>
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Status</h2>
        <SurveyControls
          workspaceId={ws.id}
          surveyId={sv.id}
          state={sv.state}
          delivery={sv.delivery}
          canWrite={canWrite}
          isAdmin={ws.role === "admin"}
          hasQuestions={sv.questions.length > 0}
          publicLink={publicLink}
          embedUrl={embedUrl}
        />
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Details</h2>
        <SurveyDetailsForm
          workspaceId={ws.id}
          surveyId={sv.id}
          canEdit={canWrite}
          isDraft={sv.state === "draft"}
          initial={{
            title: sv.title,
            intro: sv.intro,
            thankYou: sv.thankYou,
            delivery: sv.delivery,
            onPersonDelete: sv.onPersonDelete,
          }}
        />
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Questions</h2>
        <SurveyQuestionsEditor
          workspaceId={ws.id}
          surveyId={sv.id}
          mode={
            !canWrite ? "readonly" : sv.state === "draft" ? "full" : "wording"
          }
          initial={sv.questions.map((q) => ({
            kind: q.kind,
            prompt: q.prompt,
            required: q.required,
            options: q.options,
            ...(q.showIf
              ? {
                  showIf: {
                    question: sv.questions.findIndex(
                      (x) => x.id === q.showIf!.questionId,
                    ),
                    op: q.showIf.op,
                    ...(q.showIf.number !== undefined
                      ? { number: q.showIf.number }
                      : {}),
                    ...(q.showIf.choice !== undefined
                      ? { choice: q.showIf.choice }
                      : {}),
                  },
                }
              : {}),
          }))}
        />
      </div>

      {invited ? (
        <>
          <div className={`${card} space-y-3`}>
            <h2 className="text-lg font-medium">Who it is for</h2>
            <SurveyAudienceEditor
              workspaceId={ws.id}
              surveyId={sv.id}
              saved={sv.audience}
              requests={requests.map((r) => ({ id: r.id, title: r.title }))}
              canEdit={canWrite}
            />
          </div>
          <div className={`${card} space-y-3`}>
            <h2 className="text-lg font-medium">Invitations</h2>
            <SurveyInvites
              workspaceId={ws.id}
              surveyId={sv.id}
              surveyState={sv.state}
              canWrite={canWrite}
              emailConfigured={wording?.emailConfigured ?? false}
              hasAudience={sv.audience !== undefined}
              invites={invites}
              remindable={invitesRes?.remindable ?? 0}
              wording={{
                subject: wording?.subject ?? "",
                text: wording?.text ?? "",
              }}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
