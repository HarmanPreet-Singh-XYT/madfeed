import { Suspense } from "react";
import Link from "next/link";
import { AccountFooter } from "@/components/app/account-footer";
import { AppSidebar } from "@/components/app/app-sidebar";
import { AppTopbar } from "@/components/app/app-topbar";
import { OfflineNotice } from "@/components/app/offline-notice";
import { PageHint } from "@/components/onboarding/page-hint";
import { ProductTour } from "@/components/onboarding/product-tour";
import { isSampleWorkspace } from "@/lib/onboarding";
import { getShell } from "@/lib/server/queries";
import { api, unwrap } from "@/lib/server/api";
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
      className="min-h-svh bg-muted text-foreground md:flex md:h-svh md:overflow-hidden"
    >
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className="hidden w-64 shrink-0 bg-brand-1 md:block"
          />
        }
      >
        <Sidebar params={params} />
      </Suspense>
      <Suspense fallback={null}>
        <Tour params={params} />
      </Suspense>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-svh flex-col md:h-full md:min-h-0 md:overflow-hidden">
          <Suspense
            fallback={
              <div
                aria-hidden="true"
                className="hidden h-12 border-b border-border bg-card md:block"
              />
            }
          >
            <Topbar params={params} />
          </Suspense>
          <div className="relative md:flex-1 md:overflow-y-auto">
            <Suspense fallback={null}>
              <Notices params={params} />
            </Suspense>
            <main
              id="main"
              className="w-full px-4 py-5 sm:px-6 sm:py-6"
            >
              <div className="mb-4 empty:mb-0">
                <OfflineNotice />
              </div>
              <Suspense fallback={null}>
                <Hint params={params} />
              </Suspense>
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
            : n.badge === "inbox"
              ? shell.unreadConversations
              : undefined,
    }))
    .sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );
  return { shell, items };
}

async function Sidebar({ params }: { params: Params }) {
  const { workspaceId } = await params;
  const [{ shell, items }, mine] = await Promise.all([
    navItems(workspaceId),
    (await api())
      .GET("/v1/workspaces")
      .then(unwrap)
      .then((r) => r.workspaces),
  ]);
  return (
    <AppSidebar
      workspace={{
        id: shell.workspace.id,
        name: shell.workspace.name,
        role: shell.role,
      }}
      workspaces={mine.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
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

async function Tour({ params }: { params: Params }) {
  const { workspaceId } = await params;
  const { shell, items } = await navItems(workspaceId);
  return (
    <ProductTour
      workspaceId={workspaceId}
      available={items.map((i) => i.path)}
      canAdd={shell.role !== "viewer"}
    />
  );
}

async function Hint({ params }: { params: Params }) {
  const { workspaceId } = await params;
  return <PageHint workspaceId={workspaceId} />;
}

/** Said at the top of the sample workspace so nobody mistakes made-up data for their own. */
function SampleNotice({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-tint-blue px-3 py-2">
      <p>
        <strong className="font-semibold">You are looking at a sample workspace.</strong>{" "}
        The people, companies and conversations are invented, so you can try
        anything without affecting real work.
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/home?new=1" className="font-medium text-link underline underline-offset-2">
          Start your own workspace
        </Link>
        <Link
          href={`/w/${workspaceId}/settings?tab=account#delete-this-workspace`}
          className="text-link underline underline-offset-2"
        >
          Delete this sample
        </Link>
      </p>
    </div>
  );
}

async function Notices({ params }: { params: Params }) {
  const { workspaceId } = await params;
  const { notices, workspace } = await getShell(workspaceId);
  const sample = isSampleWorkspace(workspace.name);
  if (notices.length === 0 && !sample) return null;
  return (
    <div
      role="status"
      className="w-full space-y-2 px-4 pt-5 text-sm sm:px-6"
    >
      {sample ? <SampleNotice workspaceId={workspaceId} /> : null}
      {notices.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-border bg-tint-amber px-3 py-2">
          {notices.map((n) => (
            <p key={n.id}>{n.message}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
