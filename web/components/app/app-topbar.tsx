"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CirclePlus,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const base = `/w/${workspace.id}`;
  const here = items.find(
    (i) =>
      path === `${base}/${i.path}` || path.startsWith(`${base}/${i.path}/`),
  );
  const onOverview = path === base;
  const hasAsk = items.some((i) => i.path === "ask");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

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
          className="lg:hidden"
        >
          <Search aria-hidden="true" />
          <span className="sr-only">Search and jump to</span>
        </Button>
        <ThemeToggle />
        {canAdd ? (
          <Button
            asChild
            className="gap-1.5 bg-sun px-4 font-bold text-ink shadow-card hover:bg-sun/90"
          >
            <Link href={`${base}/add`}>
              <Plus aria-hidden="true" className="size-3.5" />
              Add feedback
            </Link>
          </Button>
        ) : null}
      </div>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search and jump to"
        description="Type to find a screen or an action."
      >
        <CommandInput placeholder="Go to a screen or start something…" />
        <CommandList>
          <CommandEmpty>Nothing matches. Try another word.</CommandEmpty>
          <CommandGroup heading="Actions">
            {canAdd ? (
              <CommandItem
                value="add feedback paste conversation"
                onSelect={() => go(`${base}/add`)}
              >
                <CirclePlus aria-hidden="true" />
                Add feedback
              </CommandItem>
            ) : null}
            {hasAsk ? (
              <CommandItem
                value="ask your quotes question"
                onSelect={() => go(`${base}/ask`)}
              >
                <Sparkles aria-hidden="true" />
                Ask your quotes a question
              </CommandItem>
            ) : null}
          </CommandGroup>
          <CommandGroup heading="Go to">
            {items.map((i) => (
              <CommandItem
                key={i.path}
                value={`go ${i.label}`}
                onSelect={() => go(`${base}/${i.path}`)}
              >
                <ArrowRight aria-hidden="true" />
                {i.label}
                {here?.path === i.path ? (
                  <CommandShortcut>Here</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </header>
  );
}
