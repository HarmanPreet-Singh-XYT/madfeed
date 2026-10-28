import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateSurveyForm } from "@/components/create-survey-form";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Surveys" };

type Props = { params: Promise<{ workspaceId: string }> };

const STATE: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
};

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
  const { surveys } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/surveys", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  return (
    <section className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        hue="teal"
        title="Surveys"
        description="Ask a group of customers a few questions. Free-text answers go to your review queue like any other feedback, so they can become requests with the customer's own words attached."
      />
      {ws.role !== "viewer" ? (
        <div className="rounded-2xl bg-card shadow-card p-4">
          <h2 className="mb-3">Start a survey</h2>
          <CreateSurveyForm workspaceId={ws.id} />
        </div>
      ) : null}
      {surveys.length === 0 ? (
        <p className="text-muted-foreground">No surveys yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {surveys.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-card shadow-card p-3 transition-colors hover:bg-muted/50"
            >
              <Link
                href={`/w/${ws.id}/surveys/${s.id}`}
                className="min-w-0 flex-1 font-medium underline-offset-2 hover:underline"
              >
                {s.title}
              </Link>
              <p className="w-full text-sm text-muted-foreground">
                {STATE[s.state] ?? s.state} ·{" "}
                {s.delivery === "open" ? "public link" : "personal links"}
                {s.invitesSent > 0 ? ` · ${s.invitesSent} sent` : ""} ·{" "}
                {s.responses} {s.responses === 1 ? "answer" : "answers"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
