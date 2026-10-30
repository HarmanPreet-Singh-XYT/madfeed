"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Copy, GitMerge, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  accountPeopleAction,
  type AccountPerson,
} from "@/app/(app)/w/[workspaceId]/people/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalTime } from "@/components/local-time";
import { formatValue } from "@/lib/format";
import type { CompanyRow } from "./types";

/** A date people read, fixed to UTC so the server's rendering never depends on a locale. */
function longDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One company: what it is worth, who works there, and the actions on it. The
 * list stays behind it, like the person panel.
 */
export function CompanyDetail({
  workspaceId,
  company,
  canEdit,
  isAdmin,
  open,
  onOpenChange,
  onEdit,
  onMerge,
}: {
  workspaceId: string;
  company: CompanyRow | null;
  canEdit: boolean;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (company: CompanyRow) => void;
  onMerge?: (company: CompanyRow) => void;
}) {
  const [data, setData] = useState<{
    accountId: string;
    people?: AccountPerson[];
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !company) return;
    let live = true;
    accountPeopleAction(workspaceId, company.id).then((r) => {
      if (live) setData({ accountId: company.id, people: r.people, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [open, company, workspaceId, attempt]);

  const loading = Boolean(company) && data?.accountId !== company?.id;
  const people = data && data.accountId === company?.id ? data.people : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {company ? (
          <>
            <SheetHeader className="border-b border-border pb-4">
              <div className="flex items-center gap-3 pr-8">
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-tint-blue text-foreground"
                >
                  <Building2 className="size-5" />
                </span>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{company.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {company.domain || "No domain recorded"}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Revenue</dt>
                  <dd className="font-medium tabular-nums">
                    {company.revenue ? formatValue(company.revenue) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Plan</dt>
                  <dd>{company.plan || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Renews</dt>
                  <dd>{company.renewalDate ? longDate(company.renewalDate) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">People</dt>
                  <dd className="tabular-nums">{company.peopleCount}</dd>
                </div>
              </dl>

              <section aria-labelledby="company-people" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="company-people" className="text-sm font-semibold">
                    People here
                  </h2>
                  <Link
                    href={`/w/${workspaceId}/people?tab=people&accountId=${company.id}`}
                    className="text-xs text-link hover:underline"
                  >
                    See all
                  </Link>
                </div>
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full rounded-lg" />
                    <Skeleton className="h-12 w-full rounded-lg" />
                  </div>
                ) : data?.error ? (
                  <div className="space-y-2">
                    <p className="text-sm text-destructive">{data.error}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAttempt((n) => n + 1)}
                    >
                      Try again
                    </Button>
                  </div>
                ) : people && people.length > 0 ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {people.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{p.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.email ?? "No email"}
                          </span>
                        </span>
                        <Badge variant="muted" className="shrink-0">
                          {p.quoteCount} quote{p.quoteCount === 1 ? "" : "s"}
                        </Badge>
                        <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                          {p.lastHeardAt ? (
                            <LocalTime iso={p.lastHeardAt} relative />
                          ) : (
                            "Never"
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    Nobody is recorded at {company.name} yet.
                  </p>
                )}
              </section>

              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                A company&apos;s value is what makes each request&apos;s impact
                countable in money, not just in votes.
              </p>
            </div>

            <SheetFooter className="border-t border-border">
              <div className="flex flex-wrap gap-2">
                {canEdit && onEdit ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onEdit(company)}>
                    <Pencil aria-hidden="true" /> Edit
                  </Button>
                ) : null}
                {isAdmin && onMerge ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onMerge(company)}>
                    <GitMerge aria-hidden="true" /> Merge
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!company.domain}
                  onClick={() => {
                    if (!company.domain) return;
                    navigator.clipboard
                      .writeText(company.domain)
                      .then(() => toast.success("Domain copied."))
                      .catch(() => toast.error("Your browser would not let us copy."));
                  }}
                >
                  <Copy aria-hidden="true" /> Domain
                </Button>
              </div>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
