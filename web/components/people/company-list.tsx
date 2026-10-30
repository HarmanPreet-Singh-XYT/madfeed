"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatValue, plural } from "@/lib/format";
import { CompanyDetail } from "./company-detail";
import { MergeCompanyDialog } from "./merge-company-dialog";
import { AccountEditDialog } from "./account-edit-dialog";
import type { CompanyRow } from "./types";

type Row = CompanyRow;

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
 * Companies with the one number that matters for ranking a request — their value — in the same place on every
 * row, and the rest (plan, renewal, people) as small facts underneath.
 */
export function CompanyList({
  workspaceId,
  rows,
  canEdit,
  isAdmin,
}: {
  workspaceId: string;
  rows: Row[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [merging, setMerging] = useState<Row | null>(null);

  return (
    <>
      <Card asChild className="[--card-spacing:0px] py-0">
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setViewing(a)}
                  className="block max-w-full truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  {a.name}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {a.domain || "No domain recorded"}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge asChild variant="muted" className="hover:bg-muted">
                    <Link
                      href={`/w/${workspaceId}/people?tab=people&accountId=${a.id}`}
                      title={`Everyone at ${a.name}`}
                    >
                      {plural(a.peopleCount, "person", "people")}
                    </Link>
                  </Badge>
                  {a.plan ? <Badge variant="outline">{a.plan}</Badge> : null}
                  {a.renewalDate ? (
                    <Badge variant="outline">
                      Renews {longDate(a.renewalDate)}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-display text-lg font-semibold tabular-nums">
                    {a.revenue ? formatValue(a.revenue) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.revenue ? "revenue" : "no revenue recorded"}
                  </p>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(a)}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <CompanyDetail
        workspaceId={workspaceId}
        company={viewing}
        canEdit={canEdit}
        isAdmin={isAdmin}
        open={Boolean(viewing)}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
        onEdit={(c) => {
          setViewing(null);
          setEditing(c);
        }}
        onMerge={(c) => {
          setViewing(null);
          setMerging(c);
        }}
      />
      <MergeCompanyDialog
        workspaceId={workspaceId}
        source={merging}
        suggestions={rows.map((a) => ({ id: a.id, name: a.name }))}
        open={Boolean(merging)}
        onOpenChange={(o) => {
          if (!o) setMerging(null);
        }}
        onMerged={() => {
          if (viewing?.id === merging?.id) setViewing(null);
          setMerging(null);
        }}
      />
      {canEdit ? (
        <AccountEditDialog
          workspaceId={workspaceId}
          account={editing}
          open={Boolean(editing)}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
