"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Search, X } from "lucide-react";
import { DirectoryFilter } from "@/components/directory-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export type PersonEmailFilter = "" | "with" | "without";

const EMAIL_LABEL: Record<string, string> = {
  with: "Has an email",
  without: "No email",
};

/** Search, company and email filters for the people list, with what is on shown as removable chips. */
export function PeopleToolbar({
  workspaceId,
  q,
  account,
  email,
  total,
  loaded,
}: {
  workspaceId: string;
  q: string;
  account?: { id: string; name: string };
  email: PersonEmailFilter;
  total: number;
  loaded: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [draft, setDraft] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    setDraft(q);
  }

  function go(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp.toString());
    next.set("tab", "people");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("cursor");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const chips: { key: string; label: string; clear: Record<string, string | undefined> }[] = [];
  if (account) chips.push({ key: "account", label: `Company: ${account.name}`, clear: { accountId: "" } });
  if (email) chips.push({ key: "email", label: EMAIL_LABEL[email] ?? email, clear: { email: "" } });
  if (q) chips.push({ key: "q", label: `“${q}”`, clear: { q: "" } });
  const filterCount = chips.length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-2 p-2.5" role="search" aria-label="Filter people">
        <form
          className="relative min-w-52 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: draft.trim().slice(0, 200) });
          }}
        >
          <Label htmlFor="people-search" className="sr-only">
            Search people by name or email
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="people-search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            placeholder="Search name or email"
            className="pl-8"
          />
        </form>

        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter aria-hidden="true" />
              Filters
              {filterCount > 0 ? (
                <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[0.65rem]">
                  {filterCount}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[75vh] w-80 space-y-3 overflow-y-auto">
            <DirectoryFilter
              workspaceId={workspaceId}
              kind="account"
              value={account?.id ?? ""}
              label={account?.name ?? ""}
              onChange={(id) => go({ accountId: id })}
            />
            <div className="space-y-1">
              <Label htmlFor="people-email" className="text-xs text-muted-foreground">
                Email
              </Label>
              <Select
                value={email || "any"}
                onValueChange={(v) => go({ email: v === "any" ? "" : v })}
              >
                <SelectTrigger id="people-email">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Anyone</SelectItem>
                  <SelectItem value="with">With an email</SelectItem>
                  <SelectItem value="without">Without an email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => go({ accountId: "", email: "", q: "" })}
              >
                Reset filters
              </Button>
              <Button type="button" size="sm" onClick={() => setFiltersOpen(false)}>
                Done
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <span className="ml-auto text-xs text-muted-foreground">
          {total} {total === 1 ? "person" : "people"}
          {loaded < total ? ` · showing ${loaded}` : ""}
        </span>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => go(c.clear)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted"
              aria-label={`Remove the filter ${c.label}`}
            >
              {c.label}
              <X aria-hidden="true" className="size-3" />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go({ accountId: "", email: "", q: "" })}
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}
