import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { AskPanel } from "@/components/ask-panel";
import { Loading } from "@/components/loading";

export const metadata = { title: "Ask" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function AskPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Ask {...props} />
    </Suspense>
  );
}

async function Ask({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const { answers } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/qa", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Ask</h1>
        <p className="text-muted-foreground">
          Ask about what your customers said. Every answer shows the exact
          quotes behind it, and if there isn&apos;t enough evidence we say so
          instead of guessing. It can&apos;t count customers or tell you how
          common something is; use Requests for that.
        </p>
      </div>
      <AskPanel
        workspaceId={ws.id}
        enabled={process.env.QA_ENABLED !== "false"}
        history={answers}
      />
    </section>
  );
}
