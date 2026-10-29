"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { Segmented } from "@/components/app/panel";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A Radix Select cannot use an empty string as a value; this stands in for "any kind". */
const ANY = "__any";

export type NoteFilters = {
  state: string;
  q: string;
  type: string;
  view?: string;
  month?: string;
};

export function noteHref(
  workspaceId: string,
  f: NoteFilters,
  patch: Partial<NoteFilters & { cursor: string }> = {},
) {
  const next = { ...f, ...patch };
  const p = new URLSearchParams();
  if (next.view) p.set("view", next.view);
  if (next.month) p.set("month", next.month);
  if (next.state) p.set("state", next.state);
  if (next.type) p.set("type", next.type);
  if (next.q) p.set("q", next.q);
  if (patch.cursor) p.set("cursor", patch.cursor);
  const qs = p.toString();
  return `/w/${workspaceId}/releases${qs ? `?${qs}` : ""}`;
}

/**
 * State tabs, a kind filter and title search in one row. Every control changes the address, so a filtered
 * list can be linked to, reloaded and gone back to.
 */
export function NoteFiltersBar({
  workspaceId,
  filters,
  tabs,
  view = "list",
  month,
}: {
  workspaceId: string;
  filters: NoteFilters;
  tabs: { key: string; label: string; count: number }[];
  view?: "list" | "calendar";
  month?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  // Follow the address when it changes from outside (a tab, a cleared filter) without remounting.
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  const go = (patch: Partial<NoteFilters>) =>
    router.push(noteHref(workspaceId, { ...filters, ...patch }));

  return (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
      <Segmented
        label="View"
        items={[
          {
            href: noteHref(workspaceId, filters, { view: "", month: "" }),
            label: "List",
            active: view === "list",
          },
          {
            href: noteHref(workspaceId, { ...filters, state: "" }, { view: "calendar", month }),
            label: "Schedule",
            active: view === "calendar",
          },
        ]}
      />
      {view === "list" ? (
        <>
          <span
            aria-hidden="true"
            className="hidden h-6 w-px bg-border xl:block"
          />
          <Segmented
            label="Filter by state"
            items={tabs.map((t) => ({
              href: noteHref(workspaceId, filters, { state: t.key }),
              label: `${t.label} ${t.count}`,
              active: filters.state === t.key,
            }))}
          />
        </>
      ) : null}
      <div className="xl:ml-auto xl:w-56">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim().slice(0, 100) });
          }}
          className="relative"
        >
          <label htmlFor="note-q" className="sr-only">
            Search release notes
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="note-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
            placeholder="Search titles"
            enterKeyHint="search"
            className="pl-8"
          />
        </form>
      </div>
      <Select
        value={filters.type || ANY}
        onValueChange={(v) => go({ type: v === ANY ? "" : v })}
      >
        <SelectTrigger id="note-type" aria-label="Kind" className="sm:w-36">
          <SelectValue placeholder="Any kind" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any kind</SelectItem>
          <SelectItem value="new">New</SelectItem>
          <SelectItem value="improved">Improved</SelectItem>
          <SelectItem value="fixed">Fixed</SelectItem>
        </SelectContent>
      </Select>
      {filters.q || filters.type ? (
        <Link
          href={noteHref(workspaceId, filters, { q: "", type: "" })}
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <X aria-hidden="true" className="size-3" />
          Clear
        </Link>
      ) : null}
    </div>
  );
}
