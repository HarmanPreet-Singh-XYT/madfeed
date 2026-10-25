import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { LabelSampler } from "@/components/label-sampler";
import { link } from "@/components/ui";

export const metadata = { title: "Label quotes" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function LabelPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Label {...props} />
    </Suspense>
  );
}

async function Label({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const sample = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/sentiment/sample", {
      params: { path: { workspaceId: ws.id }, query: { limit: 20, seed: "w" } },
    }),
  );
  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/quotes/trends`} className={link}>
          ← Tags over time
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Label quotes</h1>
        <p className="text-muted-foreground">
          Read each quote and say how the person feels. Your labels are how we
          measure whether the model can be trusted: it is compared against what
          you say, and never shown to you while you label. Aim for at least 200.
        </p>
      </div>
      {ws.role === "viewer" ? (
        <p className="text-muted-foreground">Viewers can read but not label.</p>
      ) : sample.quotes.length === 0 ? (
        <p className="text-muted-foreground">There are no unlabelled quotes left.</p>
      ) : (
        <LabelSampler
          workspaceId={ws.id}
          items={sample.quotes}
          labelled={sample.labelled}
        />
      )}
    </section>
  );
}
