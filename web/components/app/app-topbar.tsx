"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { HelpMenu } from "@/components/onboarding/help-menu";
import { CommandPalette } from "@/components/app/command-palette";
import { OPEN_PALETTE_EVENT, typingTarget } from "@/lib/palette";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type Item = { path: string; label: string };

/**
 * The bar across the top of the work surface: where you are, a search that opens the command palette (⌘K or
 * Ctrl K) to jump to any screen or start something, the light and dark switch, and the most common action. It is
 * hidden on phones, which have their own top bar.
 */
export function AppTopbar({
  workspace,
  items,
  canAdd,
}: {
  workspace: { id: string; name: string };
  items: Item[];
  canAdd: boolean;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ownsSlash = useRef(false);
  const base = `/w/${workspace.id}`;
  const here = items.find(
    (i) =>
      path === `${base}/${i.path}` || path.startsWith(`${base}/${i.path}/`),
  );
  const onOverview = path === base;
  useEffect(() => {
    ownsSlash.current = here?.path === "people" || here?.path === "quotes";
  }, [here?.path]);

  // ⌘K or Ctrl K toggles the palette anywhere; "/" opens it when nobody is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (
        // The People table and the Quotes toolbar use "/" to focus their own search box.
        !ownsSlash.current &&
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !typingTarget(e.target)
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  return (
    <header className="hidden h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-6 md:flex">
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="min-w-0">
            <span className="truncate text-muted-foreground">
              {workspace.name}
            </span>
          </BreadcrumbItem>
          {onOverview ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-medium">Overview</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : here ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate font-medium">
                  {here.label}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          data-tour="search"
          className="hidden w-60 justify-start gap-2 px-3 font-normal text-muted-foreground lg:inline-flex"
        >
          <Search aria-hidden="true" className="size-3.5" />
          <span className="flex-1 text-left">Search and jump to…</span>
          <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          data-tour="search"
          className="lg:hidden"
        >
          <Search aria-hidden="true" />
          <span className="sr-only">Search and jump to</span>
        </Button>
        <HelpMenu />
        <ThemeToggle />
        {canAdd ? (
          <Button
            asChild
            data-tour="add-button"
            className="gap-1.5 bg-sun px-4 font-bold text-ink shadow-card hover:bg-sun/90"
          >
            <Link href={`${base}/add`}>
              <Plus aria-hidden="true" className="size-3.5" />
              Add feedback
            </Link>
          </Button>
        ) : null}
      </div>

      <CommandPalette
        workspace={workspace}
        items={items}
        canAdd={canAdd}
        open={open}
        onOpenChange={setOpen}
      />
    </header>
  );
}
