"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ChevronsUpDown,
  CirclePlus,
  ClipboardList,
  FileText,
  FlaskConical,
  Gauge,
  House,
  Inbox,
  Lightbulb,
  ListChecks,
  Map,
  Megaphone,
  Menu,
  Mic,
  Quote,
  Search,
  Send,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HelpMenu } from "@/components/onboarding/help-menu";
import { OPEN_PALETTE_EVENT } from "@/lib/palette";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type SidebarItem = {
  path: string;
  label: string;
  group: string;
  /** A count of things waiting, shown beside the name. */
  badge?: number;
};

const ICON: Record<string, LucideIcon> = {
  inbox: Inbox,
  add: CirclePlus,
  review: ListChecks,
  requests: Lightbulb,
  recordings: Mic,
  research: FlaskConical,
  quotes: Quote,
  findings: FileText,
  ask: Sparkles,
  roadmap: Map,
  outreach: Send,
  releases: Megaphone,
  surveys: ClipboardList,
  people: Users,
  quality: Gauge,
  settings: Settings,
};

type Workspace = { id: string; name: string; role: string };

function NavBody({
  workspace,
  items,
  onNavigate,
}: {
  workspace: Workspace;
  items: SidebarItem[];
  onNavigate?: (node: ReactNode) => ReactNode;
}) {
  const path = usePathname();
  const base = `/w/${workspace.id}`;
  // Groups appear in the order their first item does.
  const main = items.filter((i) => i.path !== "settings");
  const groups = [...new Set(main.map((i) => i.group))];
  const wrap = onNavigate ?? ((n: ReactNode) => n);
  const row = (i: SidebarItem) => {
    const href = `${base}/${i.path}`;
    const active = path === href || path.startsWith(href + "/");
    const Icon = ICON[i.path] ?? Lightbulb;
    return (
      <li key={i.path}>
        {wrap(
          <Link
            href={href}
            data-tour={`nav-${i.path}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors pointer-coarse:min-h-11",
              active
                ? "bg-accent font-semibold text-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-1 before:rounded-full before:bg-primary"
                : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                active ? "text-primary" : "text-muted-foreground",
              )}
            />
            <span className="flex-1 truncate">{i.label}</span>
            {i.badge ? (
              <>
                <span
                  aria-hidden="true"
                  className="rounded-full bg-sun px-2 py-px text-[11px] leading-4 font-bold text-ink tabular-nums"
                >
                  {i.badge >= 100 ? "100+" : i.badge}
                </span>
                <span className="sr-only">
                  {" "}
                  ({i.badge >= 100 ? "100+" : i.badge})
                </span>
              </>
            ) : null}
          </Link>,
        )}
      </li>
    );
  };
  const overviewActive = path === base;
  return (
    <nav
      aria-label={`${workspace.name} sections`}
      className="flex-1 space-y-3 overflow-y-auto px-2 pb-2"
    >
      <ul>
        <li>
          {wrap(
            <Link
              href={base}
              aria-current={overviewActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors pointer-coarse:min-h-11",
                overviewActive
                  ? "bg-accent font-semibold text-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-1 before:rounded-full before:bg-primary"
                  : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
              )}
            >
              <House
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0",
                  overviewActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              Overview
            </Link>,
          )}
        </li>
      </ul>
      {groups.map((g) => (
        <div key={g}>
          <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            {g}
          </p>
          <ul className="space-y-px">
            {main.filter((i) => i.group === g).map(row)}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Settings stays in view at the bottom, whatever the height of the window. */
function PinnedSettings({
  workspace,
  items,
  onNavigate,
}: {
  workspace: Workspace;
  items: SidebarItem[];
  onNavigate?: (node: ReactNode) => ReactNode;
}) {
  const path = usePathname();
  const item = items.find((i) => i.path === "settings");
  if (!item) return null;
  const href = `/w/${workspace.id}/${item.path}`;
  const active = path === href || path.startsWith(href + "/");
  const wrap = onNavigate ?? ((n: ReactNode) => n);
  return wrap(
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors pointer-coarse:min-h-11",
        active
          ? "bg-accent font-semibold text-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-1 before:rounded-full before:bg-primary"
          : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
      )}
    >
      <Settings
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground",
        )}
      />
      {item.label}
    </Link>,
  );
}

function WorkspaceHeader({
  workspace,
  inSheet = false,
}: {
  workspace: Workspace;
  inSheet?: boolean;
}) {
  return (
    <Link
      href="/home"
      className="mx-2 mt-3 mb-3 flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent/70"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-base font-bold text-primary-foreground"
      >
        {workspace.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-display text-sm font-bold text-foreground">
          {workspace.name}
        </span>
        <span className="block text-xs text-muted-foreground capitalize">
          {workspace.role}
        </span>
      </span>
      {inSheet ? null : (
        <ChevronsUpDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
      <span className="sr-only">Switch workspace</span>
    </Link>
  );
}

/**
 * The workspace's navigation: a navy sidebar on wide screens, and a top bar with a menu button and slide-over on
 * phones. `footer` is the account area, drawn by the server so it can use the sign-out action.
 */
export function AppSidebar({
  workspace,
  items,
  footer,
  mobileFooter,
}: {
  workspace: Workspace;
  items: SidebarItem[];
  footer: ReactNode;
  mobileFooter: ReactNode;
}) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex">
        <WorkspaceHeader workspace={workspace} />
        <NavBody workspace={workspace} items={items} />
        <div className="space-y-px border-t border-border p-2">
          <PinnedSettings workspace={workspace} items={items} />
          {footer}
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-sidebar px-4 py-2 text-foreground md:hidden">
        <Link href="/home" className="min-w-0 truncate font-display text-sm font-bold">
          {workspace.name}
        </Link>
        <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
        >
          <Search aria-hidden="true" />
          <span className="sr-only">Search and jump to</span>
        </Button>
        <HelpMenu />
        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              >
              <Menu aria-hidden="true" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[18rem] max-w-[86vw] gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">{workspace.name}</SheetTitle>
            <SheetDescription className="sr-only">
              Sections of this workspace
            </SheetDescription>
            <WorkspaceHeader workspace={workspace} inSheet />
            <NavBody
              workspace={workspace}
              items={items}
              onNavigate={(n) => (
                <SheetClose asChild>{n as React.ReactElement}</SheetClose>
              )}
            />
            <div className="space-y-px border-t border-border p-2">
              <PinnedSettings
                workspace={workspace}
                items={items}
                onNavigate={(n) => (
                  <SheetClose asChild>{n as React.ReactElement}</SheetClose>
                )}
              />
              {mobileFooter}
            </div>
          </SheetContent>
        </Sheet>
        </div>
      </header>
    </>
  );
}
