"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Company search and count, in the same shape as the people toolbar so the two tabs feel like one page. */
export function CompanyToolbar({ q, total }: { q: string; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [draft, setDraft] = useState(q);
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    setDraft(q);
  }

  function go(next: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("tab", "companies");
    if (next) params.set("q", next);
    else params.delete("q");
    params.delete("cursor");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div
        role="search"
        aria-label="Search companies"
        className="flex flex-wrap items-center gap-2 p-2.5"
      >
        <form
          className="relative min-w-52 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go(draft.trim().slice(0, 200));
          }}
        >
          <Label htmlFor="companies-q" className="sr-only">
            Search companies by name or domain
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="companies-q"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            placeholder="Search name or domain"
            className="pl-8"
          />
        </form>
        <span className="ml-auto text-xs text-muted-foreground">
          {total} {total === 1 ? "company" : "companies"}
        </span>
      </div>
      {q ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2.5 py-2">
          <button
            type="button"
            onClick={() => {
              setDraft("");
              go("");
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted"
            aria-label={`Remove the search “${q}”`}
          >
            “{q}”
            <X aria-hidden="true" className="size-3" />
          </button>
          <Button variant="ghost" size="sm" onClick={() => { setDraft(""); go(""); }}>
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}
