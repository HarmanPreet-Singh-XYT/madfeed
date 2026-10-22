import { Suspense } from "react";
import { NavLink } from "@/components/nav-link";
import { getProposals, getWorkspace } from "@/lib/server/queries";

type Params = Promise<{ workspaceId: string }>;

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="h-12" aria-hidden />}>
        <WorkspaceNav params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function WorkspaceNav({ params }: { params: Params }) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const waiting = (await getProposals(workspaceId, "suggested", 100)).length;
  const base = `/w/${ws.id}`;
  return (
    <nav
      aria-label={`${ws.name} sections`}
      className="flex flex-wrap items-center gap-1 border-b border-border pb-2"
    >
      <span className="mr-3 font-medium">{ws.name}</span>
      <NavLink href={`${base}/add`}>Add feedback</NavLink>
      <NavLink href={`${base}/review`}>
        Review{waiting > 0 ? ` (${waiting >= 100 ? "100+" : waiting})` : ""}
      </NavLink>
      <NavLink href={`${base}/requests`}>Requests</NavLink>
    </nav>
  );
}
