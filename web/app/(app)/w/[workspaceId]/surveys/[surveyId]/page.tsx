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
import { plural } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  const step =
    sv.state !== "draft"
      ? undefined
      : sv.questions.length === 0
        ? {
            title: "Add your first question",
            detail:
              "A survey needs at least one question before you can open it.",
            label: "Add a question",
            href: "#questions",
          }
        : invited && !sv.audience
          ? {
              title: "Choose who it is for",
              detail:
                "Pick the people who should get it. You can change the list before anything is sent.",
              label: "Choose audience",
              href: "#audience",
            }
          : invited && invites.length === 0
            ? {
                title: "Prepare the invitations",
                detail:
                  "Write down who will be asked, then approve the list. Nothing is sent until you approve it.",
                label: "Prepare invitations",
                href: "#invitations",
              }
            : {
                title: "Open the survey",
                detail: "Everything is ready. Opening it lets people answer.",
                label: "Go to status",
                href: "#status",
              };

  const stateTone = {
    draft: "bg-hue-amber",
    open: "bg-hue-teal",
    closed: "bg-muted-foreground",
  }[sv.state];

  const sections = [
    ["questions", "Questions"],
    ["details", "Details"],
    ...(invited
      ? [
          ["audience", "Who it is for"],
          ["invitations", "Invitations"],
        ]
      : []),
    ["status", "Status and sharing"],
  ];
  return (
    <section className="space-y-5">
      <PageHeader
        back={{ href: `/w/${ws.id}/surveys`, label: "All surveys" }}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {sv.title}
            <Badge
              variant="outline"
              className="gap-1.5 border-transparent bg-card text-foreground shadow-xs"
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${stateTone}`}
              />
              {{ draft: "Draft", open: "Open", closed: "Closed" }[sv.state]}
            </Badge>
          </span>
        }
        description={
          <>
            {sv.state === "draft"
              ? "Draft. Nobody can answer until you open it."
              : sv.state === "open"
                ? "Live. Customers can answer now."
                : "Closed. No new answers are taken."}
            <span className="mt-1 block text-sm text-on-brand/90">
              {plural(sv.questions.length, "question")} ·{" "}
              {sv.delivery === "open" ? "One public link" : "Personal links"} ·
              Started <LocalTime iso={sv.createdAt} />
            </span>
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/w/${ws.id}/surveys/${sv.id}/results`}>
              Results ({sv.responses}{" "}
              {sv.responses === 1 ? "answer" : "answers"})
            </Link>
          </Button>
        }
      />

      {step ? (
        <Card className="[--card-spacing:0px] flex-row flex-wrap items-center gap-3 bg-tint-amber p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Next step: {step.title}</p>
            <p className="text-sm text-muted-foreground">{step.detail}</p>
          </div>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
          >
            <a href={step.href}>{step.label}</a>
          </Button>
        </Card>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label="Sections of this survey"
          className="lg:sticky lg:top-0"
        >
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="inline-flex min-h-8 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-5">
          <div id="questions" className="scroll-mt-4">
            <Panel title="Questions" className="[&>div]:space-y-3">
              <SurveyQuestionsEditor
                workspaceId={ws.id}
                surveyId={sv.id}
                mode={
                  !canWrite
                    ? "readonly"
                    : sv.state === "draft"
                      ? "full"
                      : "wording"
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
                            ...(c.number !== undefined
                              ? { number: c.number }
                              : {}),
                            ...(c.choice !== undefined
                              ? { choice: c.choice }
                              : {}),
                          })),
                        },
                      }
                    : {}),
                }))}
              />
            </Panel>
          </div>

          <div id="details" className="scroll-mt-4">
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
          </div>

          {invited ? (
            <>
              <div id="audience" className="scroll-mt-4">
                <Panel title="Who it is for" className="[&>div]:space-y-3">
                  <SurveyAudienceEditor
                    workspaceId={ws.id}
                    surveyId={sv.id}
                    saved={sv.audience}
                    requests={requests.map((r) => ({
                      id: r.id,
                      title: r.title,
                    }))}
                    canEdit={canWrite}
                  />
                </Panel>
              </div>
              <div id="invitations" className="scroll-mt-4">
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
              </div>
            </>
          ) : null}

          <div id="status" className="scroll-mt-4">
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
                closesAt={sv.closesAt}
              />
            </Panel>
          </div>
        </div>
      </div>
    </section>
  );
}
