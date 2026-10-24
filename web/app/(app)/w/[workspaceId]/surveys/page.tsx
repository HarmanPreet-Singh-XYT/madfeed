import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateSurveyForm } from "@/components/create-survey-form";
import { card } from "@/components/ui";

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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Surveys</h1>
        <p className="text-muted">
          Ask a group of customers a few questions. Free-text answers go to your
          review queue like any other feedback, so they can become requests with
          the customer&apos;s own words attached.
        </p>
      </div>
      {ws.role !== "viewer" ? (
        <div className={card}>
          <h2 className="mb-3 font-medium">Start a survey</h2>
          <CreateSurveyForm workspaceId={ws.id} />
        </div>
      ) : null}
      {surveys.length === 0 ? (
        <p className="text-muted">No surveys yet.</p>
      ) : (
        <ul className="space-y-3">
          {surveys.map((s) => (
            <li key={s.id} className={card}>
              <Link
                href={`/w/${ws.id}/surveys/${s.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {s.title}
              </Link>
              <p className="text-sm text-muted">
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
