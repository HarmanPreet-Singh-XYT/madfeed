"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import {
  ArrowRight,
  Building2,
  Clock,
  CornerDownLeft,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  Moon,
  Plus,
  Quote,
  Route,
  Search,
  Sparkles,
  Sun,
  User,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  addRecent,
  highlightParts,
  readRecents,
  searchScopes,
  type Recent,
} from "@/lib/palette";
import {
  searchWorkspaceAction,
  type SearchResults,
} from "@/lib/server/search-actions";
import { cn } from "@/lib/utils";
import { START_TOUR_EVENT } from "@/components/onboarding/product-tour";
import { darkModeOn, setDarkMode } from "@/components/site/theme-toggle";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Item = { path: string; label: string };

const KIND_ICON: Record<Recent["kind"], LucideIcon> = {
  page: ArrowRight,
  request: Lightbulb,
  person: User,
  company: Building2,
  finding: FileText,
  quote: Quote,
};

/** The value of the first result row, in the order the groups are drawn. */
function firstValue(r: SearchResults): string {
  if (r.requests[0]) return `request ${r.requests[0].id}`;
  if (r.people[0]) return `person ${r.people[0].id}`;
  if (r.companies[0]) return `company ${r.companies[0].id}`;
  if (r.findings[0]) return `finding ${r.findings[0].id}`;
  if (r.quotes[0]) return `quote ${r.quotes[0].kind} ${r.quotes[0].id}`;
  return "";
}

/** A title with the searched words marked, so it is clear why a result matched. */
function Marked({ text, term }: { text: string; term: string }) {
  return (
    <>
      {highlightParts(text, term).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-mark px-0.5 text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The search and jump palette (⌘K, Ctrl K, or /). With nothing typed it offers the places you went recently, quick
 * actions and every screen; as you type it also looks through quotes, requests, people, companies and findings and
 * says what it is doing: searching, nothing found, or search being unavailable. Everything it opens is a link inside
 * this workspace.
 */
export function CommandPalette({
  workspace,
  items,
  canAdd,
  open,
  onOpenChange,
}: {
  workspace: { id: string; name: string };
  items: Item[];
  canAdd: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search and jump to</DialogTitle>
        <DialogDescription>
          Type to find a screen, an action, a request, a person, or the words of
          a quote.
        </DialogDescription>
      </DialogHeader>
      <DialogContent
        showCloseButton={false}
        className="top-[10%] translate-y-0 gap-0 overflow-hidden rounded-xl! p-0 sm:max-w-2xl"
      >
        {/* Mounted only while open, so each opening starts fresh: empty search, recent places read again. */}
        <Body
          workspace={workspace}
          items={items}
          canAdd={canAdd}
          close={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  workspace,
  items,
  canAdd,
  close,
}: {
  workspace: { id: string; name: string };
  items: Item[];
  canAdd: boolean;
  close: () => void;
}) {
  const router = useRouter();
  const path = usePathname();
  const base = `/w/${workspace.id}`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  // The highlighted row. When an answer arrives it moves to the first result, so typing then pressing Enter opens the
  // best match, not whatever row happened to be highlighted before the answer came.
  const [active, setActive] = useState("");
  const [recents] = useState(() => readRecents(workspace.id));
  const term = query.trim();
  const searching = term.length >= 2;

  const has = (p: string) => items.some((i) => i.path === p);
  const here = items.find(
    (i) => path === `${base}/${i.path}` || path.startsWith(`${base}/${i.path}/`),
  );
  const dark = darkModeOn();

  // Search while you type: wait for a pause, and ignore an answer to words that have since changed.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (term.length < 2) {
        setResults(null);
        setStatus("idle");
        return;
      }
      setStatus("loading");
      searchWorkspaceAction(workspace.id, term, searchScopes(items.map((i) => i.path)))
        .then((r) => {
          if (!live) return;
          setResults(r);
          setStatus(r.failed ? "failed" : "idle");
          setActive(firstValue(r));
        })
        .catch(() => {
          if (live) setStatus("failed");
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, workspace.id, items]);

  function go(href: string, label: string, kind: Recent["kind"]) {
    addRecent(workspace.id, { href, label, kind });
    close();
    router.push(href);
  }
  function download(href: string) {
    close();
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    a.click();
  }

  const found =
    results &&
    results.quotes.length +
      results.requests.length +
      results.people.length +
      results.companies.length +
      results.findings.length;
  const q = encodeURIComponent(term);

  return (
    <Command
      // The server decides what matches a typed search, so those rows are never filtered out again here; cmdk's own
      // filter still narrows the screens and actions.
      className="rounded-none! bg-popover p-0"
      loop
      value={active}
      onValueChange={setActive}
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <CommandPrimitive.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search requests, people, quotes… or jump to a screen"
          // The global :focus-visible outline would draw a box inside the box that already is the field; the whole
          // palette is the focus indicator here, so it is switched off for this one input.
          className="h-12 w-full bg-transparent text-base placeholder:text-muted-foreground"
          style={{ outline: "none" }}
        />
        {status === "loading" ? (
          <Loader2
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin text-muted-foreground"
          />
        ) : query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Clear the search</span>
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
            esc
          </kbd>
        )}
      </div>

      {/* Status and messages sit above the list, not in it: a list of options may only contain options. */}
      <div className="px-4 empty:hidden">
        <p role="status" className="sr-only">
          {status === "loading"
            ? "Searching"
            : status === "failed"
              ? "Search is unavailable right now"
              : searching && found === 0
                ? "No matches"
                : searching && found
                  ? `${found} matches`
                  : ""}
        </p>
        {status === "failed" ? (
          <p className="py-2.5 text-sm text-muted-foreground">
            Search is unavailable right now. You can still jump to any screen
            below.
          </p>
        ) : searching && status === "idle" && found === 0 ? (
          <p className="py-2.5 text-sm text-muted-foreground">
            Nothing found for “{term}”. Try fewer words, or use one of the
            searches below.
          </p>
        ) : null}

      </div>

      <CommandList className="max-h-[min(26rem,60svh)] p-1.5">
        {results && searching ? (
          <>
            {results.requests.length > 0 ? (
              <CommandGroup heading="Requests" forceMount>
                {results.requests.map((r) => (
                  <CommandItem
                    key={r.id}
                    forceMount
                    value={`request ${r.id}`}
                    onSelect={() => go(`${base}/requests/${r.id}`, r.title, "request")}
                  >
                    <Lightbulb aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      <Marked text={r.title} term={term} />
                    </span>
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                      {r.status}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.people.length > 0 ? (
              <CommandGroup heading="People" forceMount>
                {results.people.map((p) => (
                  <CommandItem
                    key={p.id}
                    forceMount
                    value={`person ${p.id}`}
                    onSelect={() =>
                      go(`${base}/people?q=${encodeURIComponent(p.name)}`, p.name, "person")
                    }
                  >
                    <User aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <Marked text={p.name} term={term} />
                      </span>
                      {p.accountName || p.email ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          <Marked text={[p.accountName, p.email].filter(Boolean).join(" · ")} term={term} />
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.companies.length > 0 ? (
              <CommandGroup heading="Companies" forceMount>
                {results.companies.map((a) => (
                  <CommandItem
                    key={a.id}
                    forceMount
                    value={`company ${a.id}`}
                    onSelect={() =>
                      go(
                        `${base}/people?tab=companies&q=${encodeURIComponent(a.name)}`,
                        a.name,
                        "company",
                      )
                    }
                  >
                    <Building2 aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      <Marked text={a.name} term={term} />
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {a.peopleCount} {a.peopleCount === 1 ? "person" : "people"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.findings.length > 0 ? (
              <CommandGroup heading="Findings" forceMount>
                {results.findings.map((f) => (
                  <CommandItem
                    key={f.id}
                    forceMount
                    value={`finding ${f.id}`}
                    onSelect={() => go(`${base}/findings/${f.id}`, f.title, "finding")}
                  >
                    <FileText aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      <Marked text={f.title} term={term} />
                    </span>
                    {f.state === "draft" ? (
                      <span className="shrink-0 text-xs text-muted-foreground">Draft</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.quotes.length > 0 ? (
              <CommandGroup heading="Quotes" forceMount>
                {results.quotes.map((hit) => (
                  <CommandItem
                    key={`${hit.kind}:${hit.id}`}
                    forceMount
                    value={`quote ${hit.kind} ${hit.id}`}
                    onSelect={() =>
                      go(`${base}/sources/${hit.sourceItemId}`, hit.sourceTitle || "A conversation", "quote")
                    }
                  >
                    <Quote aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2">
                        “<Marked text={hit.text} term={term} />”
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {hit.sourceTitle || "A conversation"}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </>
        ) : null}

        {searching ? (
          <CommandGroup heading={`Search for “${term}”`} forceMount>
            {has("quotes") ? (
              <>
                <CommandItem
                  forceMount
                  value="search-quotes-words"
                  onSelect={() => go(`${base}/quotes?q=${q}`, `Quotes with “${term}”`, "page")}
                >
                  <Quote aria-hidden="true" />
                  All quotes with these words
                </CommandItem>
                <CommandItem
                  forceMount
                  value="search-quotes-meaning"
                  onSelect={() => go(`${base}/quotes?m=${q}`, `Quotes about “${term}”`, "page")}
                >
                  <Sparkles aria-hidden="true" />
                  Quotes with a similar meaning
                </CommandItem>
              </>
            ) : null}
            {has("requests") ? (
              <CommandItem
                forceMount
                value="search-requests"
                onSelect={() => go(`${base}/requests?q=${q}`, `Requests with “${term}”`, "page")}
              >
                <Lightbulb aria-hidden="true" />
                All requests with these words
              </CommandItem>
            ) : null}
          </CommandGroup>
        ) : null}

        {!searching && recents.length > 0 ? (
          <CommandGroup heading="Recent">
            {recents.map((r) => {
              const Icon = r.kind === "page" ? Clock : KIND_ICON[r.kind];
              return (
                <CommandItem
                  key={r.href}
                  value={`recent ${r.label} ${r.href}`}
                  onSelect={() => go(r.href, r.label, r.kind)}
                >
                  <Icon aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {here?.path === "people" ? (
          <CommandGroup heading="On this page">
            <CommandItem value="add a person" onSelect={() => go(`${base}/people?tab=people#add-person`, "Add a person", "page")}>
              <Plus aria-hidden="true" />
              Add a person
            </CommandItem>
            <CommandItem value="import people spreadsheet" onSelect={() => go(`${base}/people?tab=people#import`, "Import people", "page")}>
              <Plus aria-hidden="true" />
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
                download(`${base}/people/export?${params.toString()}`);
              }}
            >
              <Download aria-hidden="true" />
              Export people
            </CommandItem>
            <CommandItem value="clear person filters" onSelect={() => go(`${base}/people?tab=people`, "People", "page")}>
              <X aria-hidden="true" />
              Clear person filters
            </CommandItem>
          </CommandGroup>
        ) : null}
        {here?.path === "quotes" ? (
          <CommandGroup heading="On this page">
            <CommandItem
              value="export quotes csv download"
              onSelect={() => {
                const params = new URLSearchParams(window.location.search);
                for (const k of ["open", "afterAt", "afterId", "m"]) params.delete(k);
                download(`${base}/quotes/export?${params.toString()}`);
              }}
            >
              <Download aria-hidden="true" />
              Export quotes with these filters
            </CommandItem>
            <CommandItem value="clear quote filters" onSelect={() => go(`${base}/quotes`, "Quotes", "page")}>
              <X aria-hidden="true" />
              Clear quote filters
            </CommandItem>
            <CommandItem value="write a finding document" onSelect={() => go(`${base}/findings`, "Findings", "page")}>
              <FileText aria-hidden="true" />
              Write a finding
            </CommandItem>
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Actions">
          {canAdd ? (
            <CommandItem value="add feedback paste conversation" onSelect={() => go(`${base}/add`, "Add feedback", "page")}>
              <Plus aria-hidden="true" />
              Add feedback
            </CommandItem>
          ) : null}
          {has("ask") ? (
            <CommandItem value="ask your quotes question" onSelect={() => go(`${base}/ask`, "Ask", "page")}>
              <Sparkles aria-hidden="true" />
              Ask your quotes a question
            </CommandItem>
          ) : null}
          <CommandItem
            value="take the product tour help walkthrough"
            onSelect={() => {
              close();
              window.dispatchEvent(new Event(START_TOUR_EVENT));
            }}
          >
            <Route aria-hidden="true" />
            Take the product tour
          </CommandItem>
          <CommandItem
            value="switch dark light mode theme"
            onSelect={() => {
              setDarkMode(!dark);
              close();
            }}
          >
            {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {dark ? "Switch to light mode" : "Switch to dark mode"}
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Go to">
          <Row
            href={base}
            label="Overview"
            current={path === base}
            go={go}
          />
          {items.map((i) => (
            <Row
              key={i.path}
              href={`${base}/${i.path}`}
              label={i.label}
              current={here?.path === i.path}
              go={go}
            />
          ))}
        </CommandGroup>
      </CommandList>

      <div className="hidden items-center gap-4 border-t border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground sm:flex">
        <Hint keys={["↑", "↓"]} label="to move" />
        <Hint keys={[<CornerDownLeft key="e" aria-hidden="true" className="size-3" />]} label="to open" />
        <Hint keys={["esc"]} label="to close" />
        <span className="ml-auto">Type 2 or more letters to search your data</span>
      </div>
    </Command>
  );
}

function Row({
  href,
  label,
  current,
  go,
}: {
  href: string;
  label: string;
  current: boolean;
  go: (href: string, label: string, kind: Recent["kind"]) => void;
}) {
  return (
    <CommandItem value={`go ${label}`} onSelect={() => go(href, label, "page")}>
      <ArrowRight aria-hidden="true" />
      {label}
      {current ? <CommandShortcut>Here</CommandShortcut> : null}
    </CommandItem>
  );
}

function Hint({ keys, label }: { keys: ReactNode[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className={cn(
            "inline-flex min-w-5 items-center justify-center rounded border border-border bg-card px-1 py-0.5 font-mono text-[10px] text-foreground",
          )}
        >
          {k}
        </kbd>
      ))}
      {label}
    </span>
  );
}
