import { Suspense } from "react";
import { AccountFooter } from "@/components/app/account-footer";
import { AppSidebar } from "@/components/app/app-sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { getShell } from "@/lib/server/queries";
import { MODULE_NAMES, visibleNav } from "@/lib/modules";

type Params = Promise<{ workspaceId: string }>;

// Where each group sits in the sidebar, whatever order the pages come in.
const GROUP_ORDER = ["Feedback", "Research", "Surveys", "Support", "Workspace"];

// The look of the whole product comes from [data-app] (see globals.css): a grey canvas with the sidebar on it, and
// the page as a white work surface inset beside it, with a top bar.
export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  return (
    <div
      data-app
      className="min-h-svh bg-sidebar text-foreground md:flex md:h-svh md:overflow-hidden"
    >
      <Suspense
        fallback={
          <div aria-hidden="true" className="hidden w-60 shrink-0 md:block" />
        }
      >
        <Sidebar params={params} />
      </Suspense>
      <div className="min-w-0 flex-1 md:py-2 md:pr-2">
        <div className="flex min-h-svh flex-col bg-background md:h-full md:min-h-0 md:overflow-hidden md:rounded-lg md:border md:border-border">
          <Suspense
            fallback={
              <div
                aria-hidden="true"
                className="hidden h-12 border-b border-border md:block"
              />
            }
          >
            <Topbar params={params} />
          </Suspense>
          <div className="md:flex-1 md:overflow-y-auto">
            <Suspense fallback={null}>
              <Notices params={params} />
            </Suspense>
            <main
              id="main"
              className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-8 sm:py-7"
            >
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

async function navItems(workspaceId: string) {
  const shell = await getShell(workspaceId);
  const items = visibleNav(shell.modules)
    .map((n) => ({
      path: n.path,
      label: n.label,
      group: n.module ? MODULE_NAMES[n.module] : "Workspace",
      badge:
        n.badge === "review"
          ? shell.waitingProposals
          : n.badge === "messages"
            ? shell.openOutreach
            : undefined,
    }))
    .sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );
  return { shell, items };
}

async function Sidebar({ params }: { params: Params }) {
  const { workspaceId } = await params;
  const { shell, items } = await navItems(workspaceId);
  return (
    <AppSidebar
      workspace={{
        id: shell.workspace.id,
        name: shell.workspace.name,
        role: shell.role,
      }}
      items={items}
      footer={<AccountFooter />}
      mobileFooter={<AccountFooter withTheme />}
    />
  );
}

async function Topbar({ params }: { params: Params }) {
  const { workspaceId } = await params;
  const { shell, items } = await navItems(workspaceId);
  return (
    <AppTopbar
      workspace={{ id: shell.workspace.id, name: shell.workspace.name }}
      items={items.map((i) => ({ path: i.path, label: i.label }))}
      canAdd={shell.role !== "viewer" && items.some((i) => i.path === "add")}
    />
  );
}

async function Notices({ params }: { params: Params }) {
  const { workspaceId } = await params;
  const { notices } = await getShell(workspaceId);
  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      className="mx-auto w-full max-w-6xl px-4 pt-5 text-[13px] sm:px-8"
    >
      <div className="space-y-1 rounded-md bg-tint-amber px-3 py-2">
        {notices.map((n) => (
          <p key={n.id}>{n.message}</p>
        ))}
      </div>
    </div>
  );
}
