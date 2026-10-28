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
      className="flex-1 space-y-4 overflow-y-auto px-2 pb-3"
    >
      {groups.map((g) => (
        <div key={g}>
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            {g}
          </p>
          <ul className="space-y-px">
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
                          "flex min-h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                          active
                            ? "bg-accent font-medium text-foreground"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            "size-4 shrink-0",
                            active && "text-link",
                          )}
                        />
                        <span className="flex-1 truncate">{i.label}</span>
                        {i.badge ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="rounded bg-tint-blue px-1.5 py-px text-[11px] font-semibold text-link tabular-nums"
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
      className="mx-2 my-2 flex items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-accent/60"
    >
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
      >
        {workspace.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {workspace.name}
      </span>
      {inSheet ? null : (
        <ChevronsUpDown
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
      <span className="sr-only">Switch workspace</span>
    </Link>
  );
}

/**
 * The workspace's navigation: a compact sidebar on wide screens, and a top bar with a menu button and slide-over on
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
      <aside className="hidden w-60 shrink-0 flex-col md:flex">
        <WorkspaceHeader workspace={workspace} />
        <NavBody workspace={workspace} items={items} />
        <div className="p-2">{footer}</div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-2 backdrop-blur md:hidden">
        <Link href="/home" className="min-w-0 truncate text-sm font-semibold">
          {workspace.name}
        </Link>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-md"
            >
              <Menu aria-hidden="true" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[18rem] max-w-[86vw] gap-0 bg-sidebar p-0"
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
            <div className="border-t border-border p-2">{mobileFooter}</div>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
