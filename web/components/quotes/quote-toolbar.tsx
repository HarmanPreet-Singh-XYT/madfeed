"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BookmarkPlus, Pencil, Search, SlidersHorizontal, X } from "lucide-react";
import {
  deleteQuoteViewAction,
  renameQuoteViewAction,
  saveQuoteViewAction,
  type QuoteViewInput,
} from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { DirectoryFilter } from "./directory-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { daysWord, FEELING_LOOK, SOURCE_LABEL, SOURCES, type Feeling, type QuoteView, type TagLite } from "./types";

const ANY = "__any";

function patchUrl(current: URLSearchParams, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v) next.set(k, v);
    else next.delete(k);
  }
  next.delete("afterAt");
  next.delete("afterId");
  next.delete("open");
  return next;
}

/**
 * Everything that narrows the list: one search field, the filters as removable
 * chips, the order, the view, and saved ways of looking at quotes.
 */
export function QuoteToolbar({
  workspaceId,
  tags,
  views,
  total,
  loaded,
  meaningCount,
  canSave,
  person,
  account,
}: {
  workspaceId: string;
  tags: TagLite[];
  views: QuoteView[];
  total: number;
  loaded: number;
  meaningCount?: number;
  canSave: boolean;
  person?: { id: string; name: string };
  account?: { id: string; name: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const input = useRef<HTMLInputElement>(null);

  const q = sp.get("q") ?? "";
  const m = sp.get("m") ?? "";
  const kind = sp.get("kind") ?? "";
  const tag = sp.get("tag") ?? "";
  const sentiment = sp.get("sentiment") ?? "";
  const source = sp.get("source") ?? "";
  const personId = sp.get("personId") ?? "";
  const accountId = sp.get("accountId") ?? "";
  const days = Number(sp.get("days") ?? 0);
  const sort = sp.get("sort") === "oldest" ? "oldest" : "newest";
  const board = sp.get("view") === "board";

  const [mode, setMode] = useState<"words" | "meaning">(m ? "meaning" : "words");
  const [value, setValue] = useState(m || q);
  const [seen, setSeen] = useState(`${mode}:${m}:${q}`);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTo, setRenameTo] = useState("");
  if (seen !== `${m ? "meaning" : "words"}:${m}:${q}`) {
    setSeen(`${m ? "meaning" : "words"}:${m}:${q}`);
    setMode(m ? "meaning" : "words");
    setValue(m || q);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      input.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (patch: Record<string, string | undefined>) => {
    const next = patchUrl(sp, patch);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const filters: { key: string; label: string; clear: Record<string, string | undefined> }[] = [];
  if (kind) filters.push({ key: "kind", label: kind === "highlight" ? "Highlights only" : "Evidence only", clear: { kind: "" } });
  const tagName = tags.find((t) => t.id === tag)?.name;
  if (tagName) filters.push({ key: "tag", label: `Tag: ${tagName}`, clear: { tag: "" } });
  if (sentiment) filters.push({ key: "sentiment", label: `Feels: ${FEELING_LOOK[(sentiment === "none" ? "none" : sentiment) as Feeling].label}`, clear: { sentiment: "" } });
  if (source) filters.push({ key: "source", label: `From: ${SOURCE_LABEL[source] ?? source}`, clear: { source: "" } });
  if (personId) filters.push({ key: "person", label: `Person: ${person?.name ?? "chosen"}`, clear: { personId: "" } });
  if (accountId) filters.push({ key: "account", label: `Account: ${account?.name ?? "chosen"}`, clear: { accountId: "" } });
  if (days) filters.push({ key: "days", label: daysWord(days), clear: { days: "" } });
  if (q) filters.push({ key: "q", label: `Words: “${q}”`, clear: { q: "" } });

  const filterCount = [kind, tag, sentiment, source, personId, accountId, days ? String(days) : "", q].filter(Boolean).length;
  const canSaveView =
    canSave && (Boolean(m) || filterCount > 0 || sort !== "newest");
  const meaning = Boolean(m);

  const viewInput: QuoteViewInput = {
    name: "",
    ...(kind === "evidence" || kind === "highlight" ? { kind } : {}),
    ...(tag ? { tagId: tag } : {}),
    ...(sentiment ? { sentiment: sentiment as Feeling } : {}),
    ...(source ? { sourceKind: source as QuoteViewInput["sourceKind"] } : {}),
    ...(personId ? { personId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(q ? { q } : {}),
    ...(m ? { meaning: m } : {}),
    ...(days === 7 || days === 30 || days === 90 ? { days } : {}),
    ...(sort !== "newest" ? { sort } : {}),
  };

  function viewHref(v: QuoteView) {
    const p = new URLSearchParams();
    if (v.kind) p.set("kind", v.kind);
    if (v.tagId) p.set("tag", v.tagId);
    if (v.sentiment) p.set("sentiment", v.sentiment);
    if (v.sourceKind) p.set("source", v.sourceKind);
    if (v.personId) p.set("personId", v.personId);
    if (v.accountId) p.set("accountId", v.accountId);
    if (v.days) p.set("days", String(v.days));
    if (v.q) p.set("q", v.q);
    if (v.meaning) p.set("m", v.meaning);
    if (v.sort !== "newest") p.set("sort", v.sort);
    const qs = p.toString();
    return `/w/${workspaceId}/quotes${qs ? `?${qs}` : ""}`;
  }

  const activeView = views.find((v) => {
    const p = new URLSearchParams(viewHref(v).split("?")[1] ?? "");
    const current = new URLSearchParams();
    if (kind) current.set("kind", kind);
    if (tag) current.set("tag", tag);
    if (sentiment) current.set("sentiment", sentiment);
    if (source) current.set("source", source);
    if (personId) current.set("personId", personId);
    if (accountId) current.set("accountId", accountId);
    if (days) current.set("days", String(days));
    if (q) current.set("q", q);
    if (m) current.set("m", m);
    if (sort !== "newest") current.set("sort", sort);
    const a = [...p.entries()].sort().map(([k, val]) => `${k}=${val}`).join("&");
    const b = [...current.entries()].sort().map(([k, val]) => `${k}=${val}`).join("&");
    return a === b && a !== "";
  });

  return (
    <div className="space-y-2">
      {views.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" aria-label="Saved quote views">
          <Link
            href={`/w/${workspaceId}/quotes`}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              !activeView ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            All quotes
          </Link>
          {views.map((v) => (
            <span key={v.id} className="inline-flex items-center">
              <Link
                href={viewHref(v)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  activeView?.id === v.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {v.name}
              </Link>
              {v.mine && activeView?.id === v.id ? (
                <button
                  type="button"
                  aria-label={`Rename the view ${v.name}`}
                  title={`Rename ${v.name}`}
                  onClick={() => {
                    setRenameTo(v.name);
                    setRenaming(true);
                  }}
                  className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil aria-hidden="true" className="size-3" />
                </button>
              ) : null}
              {v.mine ? (
                <button
                  type="button"
                  aria-label={`Delete the view ${v.name}`}
                  title={`Delete ${v.name}`}
                  onClick={async () => {
                    const r = await deleteQuoteViewAction(workspaceId, v.id);
                    if (r.error) toast.error(r.error);
                    else {
                      toast.success(r.notice ?? "View removed.");
                      router.refresh();
                    }
                  }}
                  className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5" role="group" aria-label="Quote type">
          {[
            { id: "", label: "All quotes" },
            { id: "evidence", label: "Evidence" },
            { id: "highlight", label: "Highlights" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={kind === t.id}
              onClick={() => go({ kind: t.id })}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                kind === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <form
            className="relative min-w-52 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const next = value.trim().slice(0, mode === "meaning" ? 300 : 200);
              go(
                mode === "meaning"
                  ? { m: next, q: "" }
                  : { q: next, m: "" },
              );
            }}
            role="search"
            aria-label="Search quotes"
          >
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Label htmlFor="quote-search" className="sr-only">
              {mode === "meaning" ? "Describe what you are looking for" : "Words in the quote"}
            </Label>
            <Input
              ref={input}
              id="quote-search"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={mode === "meaning" ? 300 : 200}
              placeholder={
                mode === "meaning"
                  ? "Describe what you are looking for in your own words"
                  : "Words in the quote"
              }
              className="pl-8"
            />
          </form>

          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5" aria-label="How to match search">
            {(["words", "meaning"] as const).map((modeId) => (
              <button
                key={modeId}
                type="button"
                aria-pressed={mode === modeId}
                onClick={() => {
                  setMode(modeId);
                  setValue("");
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  mode === modeId ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title={
                  modeId === "meaning"
                    ? "Finds quotes that mean the same, even in different words"
                    : "Finds quotes containing these words"
                }
              >
                {modeId === "words" ? "Words" : "Meaning"}
              </button>
            ))}
          </div>

          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <SlidersHorizontal aria-hidden="true" />
                Filters
                {filterCount > 0 ? (
                  <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[0.65rem]">
                    {filterCount}
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-[75vh] w-80 space-y-3 overflow-y-auto">
              <div className="space-y-1">
                <Label htmlFor="f-tag" className="text-xs text-muted-foreground">Tag</Label>
                <Select value={tag || ANY} onValueChange={(v) => go({ tag: v === ANY ? "" : v })}>
                  <SelectTrigger id="f-tag"><SelectValue placeholder="Any tag" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any tag</SelectItem>
                    {tags.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-feel" className="text-xs text-muted-foreground">How it feels</Label>
                <Select value={sentiment || ANY} onValueChange={(v) => go({ sentiment: v === ANY ? "" : v })}>
                  <SelectTrigger id="f-feel"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any</SelectItem>
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="negative">Negative</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                    <SelectItem value="none">Not labelled yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-source" className="text-xs text-muted-foreground">Where it came from</Label>
                <Select value={source || ANY} onValueChange={(v) => go({ source: v === ANY ? "" : v })}>
                  <SelectTrigger id="f-source"><SelectValue placeholder="Anywhere" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Anywhere</SelectItem>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>{SOURCE_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-days" className="text-xs text-muted-foreground">When</Label>
                <Select value={String(days)} onValueChange={(v) => go({ days: v === "0" ? "" : v })}>
                  <SelectTrigger id="f-days"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Any time</SelectItem>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DirectoryFilter
                workspaceId={workspaceId}
                kind="person"
                value={personId}
                label={person?.name ?? ""}
                onChange={(id) => go({ personId: id })}
              />
              <DirectoryFilter
                workspaceId={workspaceId}
                kind="account"
                value={accountId}
                label={account?.name ?? ""}
                onChange={(id) => go({ accountId: id })}
              />
              <div className="flex items-center justify-between pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    go({ tag: "", sentiment: "", source: "", personId: "", accountId: "", days: "", kind: "", q: "", m: "" })
                  }
                >
                  Reset filters
                </Button>
                <Button type="button" size="sm" onClick={() => setFiltersOpen(false)}>
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Select value={sort} onValueChange={(v) => go({ sort: v === "newest" ? "" : v })} disabled={meaning}>
            <SelectTrigger className="w-36" aria-label="Order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>

          <ToggleGroup
            type="single"
            value={board ? "board" : "table"}
            onValueChange={(v) => {
              if (v) go({ view: v === "board" ? "board" : "" });
            }}
            aria-label="How to show quotes"
            className="ml-auto"
          >
            <ToggleGroupItem value="table" aria-label="Show as a table">Table</ToggleGroupItem>
            <ToggleGroupItem value="board" aria-label="Show as a board">Board</ToggleGroupItem>
          </ToggleGroup>

          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!canSaveView} title={canSaveView ? "Save these filters for everyone" : "Choose a filter, search or order first"}>
                <BookmarkPlus aria-hidden="true" /> Save view
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save this view</DialogTitle>
                <DialogDescription>
                  Everyone in the workspace can use it. {meaning ? "It keeps the meaning search." : "It keeps the filters and order."}
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = String(new FormData(e.currentTarget).get("name") ?? "");
                  const r = await saveQuoteViewAction(workspaceId, { ...viewInput, name });
                  if (r.error) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success(r.notice ?? "Saved.");
                  setSaveOpen(false);
                  router.refresh();
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="view-name">Name</Label>
                  <Input id="view-name" name="name" required maxLength={60} placeholder="Negative security quotes" />
                </div>
                <DialogFooter>
                  <Button type="submit">Save view</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
          {meaning ? (
            <>
              <p className="text-xs text-muted-foreground">
                Meaning search looks at every quote; filters are paused until you clear it.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => go({ m: "", q: "" })}
              >
                <X aria-hidden="true" /> Clear search
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {meaningCount ?? 0} closest {meaningCount === 1 ? "match" : "matches"}
              </span>
            </>
          ) : filters.length > 0 ? (
            <>
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => go(f.clear)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted"
                  aria-label={`Remove the filter ${f.label}`}
                >
                  {f.label}
                  <X aria-hidden="true" className="size-3" />
                </button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => go({ tag: "", sentiment: "", source: "", personId: "", accountId: "", days: "", kind: "", q: "", m: "" })}>
                Clear all
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {total} quote{total === 1 ? "" : "s"}
                {loaded < total ? ` · showing ${loaded}` : ""}
              </span>
            </>
          ) : (
            <span className="ml-auto text-xs text-muted-foreground">
              {total} quote{total === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename this view</DialogTitle>
            <DialogDescription>
              Everyone in the workspace sees the new name.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!activeView) return;
              const r = await renameQuoteViewAction(workspaceId, activeView.id, renameTo);
              if (r.error) {
                toast.error(r.error);
                return;
              }
              toast.success(r.notice ?? "Renamed.");
              setRenaming(false);
              router.refresh();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="rename-view">Name</Label>
              <Input
                id="rename-view"
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                required
                maxLength={60}
              />
            </div>
            <DialogFooter>
              <Button type="submit">Rename</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
