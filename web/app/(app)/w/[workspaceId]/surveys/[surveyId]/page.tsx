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
import { link } from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";

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
      <PageHeader
        back={{ href: `/w/${ws.id}/surveys`, label: "All surveys" }}
        title={<>{sv.title}</>}
        actions={
          <Link href={`/w/${ws.id}/surveys/${sv.id}/results`} className={link}>
            Results ({sv.responses} {sv.responses === 1 ? "answer" : "answers"})
          </Link>
        }
      />

      <Panel title="Status" className="[&>div]:space-y-3">
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
      </Panel>

      <Panel title="Details" className="[&>div]:space-y-3">
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
      </Panel>

      <Panel title="Questions" className="[&>div]:space-y-3">
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
            ...(q.showWhen
              ? {
                  showWhen: {
                    match: q.showWhen.match,
                    conditions: q.showWhen.conditions.map((c) => ({
                      question: sv.questions.findIndex(
                        (x) => x.id === c.questionId,
                      ),
                      op: c.op,
                      ...(c.number !== undefined ? { number: c.number } : {}),
                      ...(c.choice !== undefined ? { choice: c.choice } : {}),
                    })),
                  },
                }
              : {}),
          }))}
        />
      </Panel>

      {invited ? (
        <>
          <Panel title="Who it is for" className="[&>div]:space-y-3">
            <SurveyAudienceEditor
              workspaceId={ws.id}
              surveyId={sv.id}
              saved={sv.audience}
              requests={requests.map((r) => ({ id: r.id, title: r.title }))}
              canEdit={canWrite}
            />
          </Panel>
          <Panel title="Invitations" className="[&>div]:space-y-3">
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
          </Panel>
        </>
      ) : null}
    </section>
  );
}
