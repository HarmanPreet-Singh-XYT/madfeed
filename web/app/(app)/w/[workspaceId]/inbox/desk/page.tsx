import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { DeskSetup } from "@/components/desk-setup";
import { link } from "@/components/ui";

export const metadata = { title: "Desk setup" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function DeskPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Desk {...props} />
    </Suspense>
  );
}

async function Desk({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const client = await api();
  const path = { workspaceId: ws.id };
  const [members, canned, stats] = await Promise.all([
    client.GET("/v1/workspaces/{workspaceId}/members", { params: { path } }),
    client.GET("/v1/workspaces/{workspaceId}/inbox/canned-replies", {
      params: { path },
    }),
    client.GET("/v1/workspaces/{workspaceId}/inbox/stats", {
      params: { path },
    }),
  ]);
  const me = unwrap(members).members.find((m) => m.isMe);
  return (
    <section className="space-y-6">
      <p>
        <Link href={`/w/${ws.id}/inbox`} className={link}>
          ← Inbox
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Desk setup</h1>
      <DeskSetup
        workspaceId={ws.id}
        myName={me?.name ?? ""}
        canned={unwrap(canned).replies}
        targetHours={unwrap(stats).targetHours}
        canWrite={ws.role !== "viewer"}
        isAdmin={ws.role === "admin"}
      />
    </section>
  );
}
