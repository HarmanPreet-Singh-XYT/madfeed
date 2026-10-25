import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { CodebookManager } from "@/components/codebook-manager";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";

export const metadata = { title: "Tags" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function CodebookPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Codebook {...props} />
    </Suspense>
  );
}

async function Codebook({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const { tags } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/tags", {
      params: {
        path: { workspaceId: ws.id },
        query: { includeArchived: true },
      },
    }),
  );
  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/research`} className={link}>
          ← Research
        </Link>
      </p>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Tags</h1>
        <p className="text-muted-foreground">
          The shared set of labels for highlights and requests. Each has a line
          on what it means so everyone uses it the same way. Merging or
          archiving never deletes anything, and a merge can be undone.
        </p>
      </div>
      <CodebookManager
        workspaceId={ws.id}
        tags={tags}
        isAdmin={ws.role === "admin"}
        canEdit={ws.role !== "viewer"}
      />
    </section>
  );
}
