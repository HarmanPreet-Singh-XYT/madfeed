import { Suspense } from "react";
import { NavLink } from "@/components/nav-link";
import { getShell } from "@/lib/server/queries";
import { visibleNav, type NavBadge } from "@/lib/modules";

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
  const shell = await getShell(workspaceId);
  const ws = shell.workspace;
  const access = shell;
  const waiting = shell.waitingProposals;
  const messages = shell.openOutreach;
  const notices = shell.notices;
  const base = `/w/${ws.id}`;
  return (
    <>
      {notices.length > 0 ? (
        <div
          role="status"
          className="mb-3 space-y-1 rounded-md border border-border bg-muted px-4 py-3 text-sm"
        >
          {notices.map((n) => (
            <p key={n.id}>{n.message}</p>
          ))}
        </div>
      ) : null}
      <nav
        aria-label={`${ws.name} sections`}
        className="flex flex-wrap items-center gap-1 border-b border-border pb-2"
      >
        <span className="mr-3 font-medium">{ws.name}</span>
        {visibleNav(access.modules).map((n) => (
          <NavLink key={n.path} href={`${base}/${n.path}`}>
            {n.label}
            {badgeText(n.badge, { waiting, messages })}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function badgeText(
  badge: NavBadge | undefined,
  n: { waiting: number; messages: number },
) {
  if (badge === "review" && n.waiting > 0)
    return ` (${n.waiting >= 100 ? "100+" : n.waiting})`;
  if (badge === "messages" && n.messages > 0) return ` (${n.messages})`;
  return "";
}
