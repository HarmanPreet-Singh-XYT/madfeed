"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Plus, Settings, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type WorkspaceLite = { id: string; name: string; role: string };

/**
 * The workspace switcher. It used to be a link to /home, which for someone with one workspace did
 * nothing but reload the page. Now it lists the workspaces a person belongs to, and puts creating a
 * workspace, its settings and inviting people where people look for them.
 */
export function WorkspaceMenu({
  current,
  workspaces,
  compact = false,
}: {
  current: WorkspaceLite;
  workspaces: WorkspaceLite[];
  compact?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${current.name} — switch workspace`}
          className="mx-2 mt-3 mb-3 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent/70 focus-visible:bg-accent/70 focus-visible:outline-none data-[state=open]:bg-accent/70"
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary font-display text-base font-bold text-primary-foreground"
          >
            {current.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-display text-sm font-bold text-foreground">
              {current.name}
            </span>
            <span className="block text-xs text-muted-foreground capitalize">
              {current.role}
            </span>
          </span>
          {compact ? null : (
            <ChevronsUpDown
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link href={`/w/${w.id}`} className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold">
                {w.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === current.id ? (
                <Check aria-hidden="true" className="size-4 shrink-0" />
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/home?new=1" className="flex items-center gap-2">
            <Plus aria-hidden="true" className="size-4" />
            Create a workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href={`/w/${current.id}/settings`}
            className="flex items-center gap-2"
          >
            <Settings aria-hidden="true" className="size-4" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href={`/w/${current.id}/settings?tab=general#team`}
            className="flex items-center gap-2"
          >
            <UserPlus aria-hidden="true" className="size-4" />
            Invite people
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
