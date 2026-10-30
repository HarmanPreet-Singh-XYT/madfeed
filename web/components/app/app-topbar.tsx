"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CirclePlus,
  Download,
  FileText,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { searchQuotesAction, type QuoteHit } from "@/lib/server/search-actions";
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
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QuoteHit[]>([]);
  const base = `/w/${workspace.id}`;
  const here = items.find(
    (i) =>
      path === `${base}/${i.path}` || path.startsWith(`${base}/${i.path}/`),
  );
  const onOverview = path === base;
  const hasAsk = items.some((i) => i.path === "ask");
  const onQuotes = here?.path === "quotes";
  const onPeople = here?.path === "people";

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

  // Quotes are found by their words, while you type; everything setState here
  // happens inside the timer or the promise, never on the render path.
  const term = query.trim();
  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      if (term.length < 2) {
        setHits([]);
        return;
      }
      searchQuotesAction(workspace.id, term)
        .then((r) => {
          if (live) setHits(r.hits ?? []);
        })
        .catch(() => {
          if (live) setHits([]);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, term, workspace.id]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    setHits([]);
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
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setQuery("");
            setHits([]);
          }
        }}
        title="Search and jump to"
        description="Type to find a screen, an action, or the words of a quote."
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Go to a screen, or type the words of a quote…"
        />
        <CommandList>
          <CommandEmpty>Nothing matches. Try another word.</CommandEmpty>
          {hits.length > 0 ? (
            <CommandGroup heading="Quotes">
              {hits.map((hit) => (
                <CommandItem
                  key={`${hit.kind}:${hit.id}`}
                  value={`quote ${hit.text}`}
                  // The server already matched these words, so keep the row even
                  // when its wording differs from what was typed (stemming).
                  keywords={[term, hit.sourceTitle]}
                  onSelect={() =>
                    go(
                      `${base}/sources/${hit.sourceItemId}`,
                    )
                  }
                >
                  <Search aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate">“{hit.text}”</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {hit.sourceTitle || "A conversation"}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {onPeople ? (
            <CommandGroup heading="On this page">
              <CommandItem
                value="add a person"
                onSelect={() => go(`${base}/people?tab=people#add-person`)}
              >
                <Plus aria-hidden="true" />
                Add a person
              </CommandItem>
              <CommandItem
                value="import people spreadsheet"
                onSelect={() => go(`${base}/people?tab=people#import`)}
              >
                <CirclePlus aria-hidden="true" />
                Import people
              </CommandItem>
              <CommandItem
                value="export people csv download"
                onSelect={() => {
                  const params = new URLSearchParams(window.location.search);
                  const wasCompanies = params.get("tab") === "companies";
                  params.set("tab", "people");
                  params.delete("cursor");
                  if (wasCompanies) {
                    params.delete("q");
                    params.delete("accountId");
                    params.delete("email");
                  }
                  setOpen(false);
                  const a = document.createElement("a");
                  a.href = `${base}/people/export?${params.toString()}`;
                  a.download = "";
                  a.click();
                }}
              >
                <Download aria-hidden="true" />
                Export people
              </CommandItem>
              <CommandItem
                value="clear person filters"
                onSelect={() => go(`${base}/people?tab=people`)}
              >
                <X aria-hidden="true" />
                Clear person filters
              </CommandItem>
            </CommandGroup>
          ) : null}
          {onQuotes ? (
            <CommandGroup heading="On this page">
              <CommandItem
                value="export quotes csv download"
                onSelect={() => {
                  const params = new URLSearchParams(window.location.search);
                  params.delete("open");
                  params.delete("afterAt");
                  params.delete("afterId");
                  params.delete("m");
                  setOpen(false);
                  const a = document.createElement("a");
                  a.href = `${base}/quotes/export?${params.toString()}`;
                  a.download = "";
                  a.click();
                }}
              >
                <Download aria-hidden="true" />
                Export quotes with these filters
              </CommandItem>
              <CommandItem
                value="clear quote filters"
                onSelect={() => go(`${base}/quotes`)}
              >
                <X aria-hidden="true" />
                Clear quote filters
              </CommandItem>
              <CommandItem
                value="write a finding document"
                onSelect={() => go(`${base}/findings`)}
              >
                <FileText aria-hidden="true" />
                Write a finding
              </CommandItem>
            </CommandGroup>
          ) : null}
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
