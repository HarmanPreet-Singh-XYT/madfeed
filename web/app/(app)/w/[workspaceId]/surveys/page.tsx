import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateSurveyForm } from "@/components/create-survey-form";
import { SurveysList } from "@/components/surveys-list";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";

export const metadata = { title: "Surveys" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function SurveysPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Surveys {...props} />
    </Suspense>
  );
}

async function Surveys({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const { surveys, nextCursor } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/surveys", {
      params: { path: { workspaceId: ws.id }, query: { limit: 50 } },
    }),
  );
  const canWrite = ws.role !== "viewer";
  return (
    <section className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        hue="teal"
        title="Surveys"
        description="Ask a group of customers a few questions. Free-text answers go to your review queue like any other feedback, so they can become requests with the customer's own words attached."
      />

      {canWrite ? (
        <Panel
          title="Start a survey"
          description="Start from a template or an empty survey. Everything can be changed until you open it."
        >
          <CreateSurveyForm workspaceId={ws.id} />
        </Panel>
      ) : null}

      {surveys.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No surveys yet.">
          {canWrite
            ? "Start one above, add a few questions, then open it. Answers appear here and in your review queue."
            : "Ask an editor to start one."}
        </EmptyState>
      ) : (
        <SurveysList
          workspaceId={ws.id}
          surveys={surveys}
          nextCursor={nextCursor}
          canWrite={canWrite}
          isAdmin={ws.role === "admin"}
        />
      )}
    </section>
  );
}
