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
  Inbox,
  Lightbulb,
  ListChecks,
  Map,
  Megaphone,
  Menu,
  Mic,
  Quote,
  Send,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  const groups = [...new Set(items.map((i) => i.group))];
  const wrap = onNavigate ?? ((n: ReactNode) => n);
  return (
    <nav
      aria-label={`${workspace.name} sections`}
      className="flex-1 space-y-5 overflow-y-auto px-3 pb-3"
    >
      {groups.map((g) => (
        <div key={g}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-widest text-on-brand/55 uppercase">
            {g}
          </p>
          <ul className="space-y-0.5">
            {items
              .filter((i) => i.group === g)
              .map((i) => {
                const href = `${base}/${i.path}`;
                const active = path === href || path.startsWith(href + "/");
                const Icon = ICON[i.path] ?? Lightbulb;
                return (
                  <li key={i.path}>
                    {wrap(
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-9 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                          active
                            ? "bg-gradient-to-r from-brand-2 to-brand-3 font-semibold text-on-brand shadow-glow"
                            : "text-on-brand/75 hover:bg-on-brand/10 hover:text-on-brand",
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className="size-4.5 shrink-0"
                        />
                        <span className="flex-1 truncate">{i.label}</span>
                        {i.badge ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="rounded-full bg-sun px-2 py-px text-[11px] font-bold text-ink tabular-nums"
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
              })}
          </ul>
        </div>
      ))}
    </nav>
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
      className="mx-3 my-4 flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-on-brand/10"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-2 to-brand-3 font-display text-base font-bold text-on-brand shadow-card"
      >
        {workspace.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-display text-sm font-bold text-on-brand">
          {workspace.name}
        </span>
        <span className="block text-xs text-on-brand/60 capitalize">
          {workspace.role}
        </span>
      </span>
      {inSheet ? null : (
        <ChevronsUpDown
          aria-hidden="true"
          className="size-4 shrink-0 text-on-brand/60"
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
      <aside className="hidden w-64 shrink-0 flex-col bg-ink text-on-brand md:flex">
        <WorkspaceHeader workspace={workspace} />
        <NavBody workspace={workspace} items={items} />
        <div className="border-t border-on-brand/15 p-3">{footer}</div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-ink px-4 py-2 text-on-brand md:hidden">
        <Link
          href="/home"
          className="min-w-0 truncate font-display text-sm font-bold"
        >
          {workspace.name}
        </Link>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-xl text-on-brand hover:bg-on-brand/10 hover:text-on-brand"
            >
              <Menu aria-hidden="true" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[18rem] max-w-[86vw] gap-0 border-0 bg-ink p-0 text-on-brand [&_button]:text-on-brand"
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
            <div className="border-t border-on-brand/15 p-3">
              {mobileFooter}
            </div>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
