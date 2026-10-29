"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookmarkPlus, Search, X } from "lucide-react";
import { SaveViewForm } from "@/components/save-view-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** A Radix Select cannot use an empty string as a value; this stands in for "no filter". */
const ANY = "__any";

type Filters = { status: string; tag: string; q: string; sort: string };

function hrefFor(base: string, f: Filters) {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.tag) p.set("tag", f.tag);
  if (f.q) p.set("q", f.q);
  if (f.sort && f.sort !== "newest") p.set("sort", f.sort);
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * The toolbar above the request list: search, the three filters and the order in one card, with whatever is on
 * shown as removable chips underneath. A view can be saved from the same place once the list has been narrowed.
 */
export function RequestFilters({
  workspaceId,
  base,
  filters,
  statuses,
  tags,
  canSave,
}: {
  workspaceId: string;
  base: string;
  filters: Filters;
  statuses: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  canSave: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  // Follow the address when it changes from outside (a saved view, a removed chip) without remounting.
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  const go = (patch: Partial<Filters>) =>
    router.push(hrefFor(base, { ...filters, ...patch }));

  const statusName = statuses.find((s) => s.id === filters.status)?.name;
  const tagName = tags.find((t) => t.id === filters.tag)?.name;
  const chips: { key: string; label: string; remove: Filters }[] = [];
  if (statusName)
    chips.push({
      key: "status",
      label: `Status: ${statusName}`,
      remove: { ...filters, status: "" },
    });
  if (tagName)
    chips.push({
      key: "tag",
      label: `Tag: ${tagName}`,
      remove: { ...filters, tag: "" },
    });
  if (filters.q)
    chips.push({
      key: "q",
      label: `Title has “${filters.q}”`,
      remove: { ...filters, q: "" },
    });
  if (filters.sort !== "newest")
    chips.push({
      key: "sort",
      label: "Most revenue first",
      remove: { ...filters, sort: "newest" },
    });

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div
        role="search"
        aria-label="Filter requests"
        className="flex flex-wrap items-center gap-2 p-2.5"
      >
        <form
          className="relative min-w-48 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim().slice(0, 100) });
          }}
        >
          <label htmlFor="f-q" className="sr-only">
            Search titles
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="f-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
            placeholder="Search titles"
            enterKeyHint="search"
            className="w-full bg-transparent pl-8"
          />
        </form>
        <Select
          value={filters.status || ANY}
          onValueChange={(v) => go({ status: v === ANY ? "" : v })}
        >
          <SelectTrigger id="f-status" aria-label="Status" className="w-40">
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any status</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.tag || ANY}
          onValueChange={(v) => go({ tag: v === ANY ? "" : v })}
        >
          <SelectTrigger id="f-tag" aria-label="Tag" className="w-36">
            <SelectValue placeholder="Any tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any tag</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.sort} onValueChange={(v) => go({ sort: v })}>
          <SelectTrigger id="f-sort" aria-label="Order by" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="value">Most revenue first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
          <ul className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <li key={c.key}>
                <Link
                  href={hrefFor(base, c.remove)}
                  aria-label={`Remove filter ${c.label}`}
                  className="inline-flex min-h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-xs font-medium transition-colors hover:bg-accent"
                >
                  {c.label}
                  <X aria-hidden="true" className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={base}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear all
          </Link>
          {canSave ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                >
                  <BookmarkPlus aria-hidden="true" />
                  Save view
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <SaveViewForm
                  workspaceId={workspaceId}
                  status={filters.status}
                  tag={filters.tag}
                  q={filters.q}
                  sort={filters.sort}
                />
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
