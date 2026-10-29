"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setSentimentAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { Badge } from "@/components/ui/badge";
import { TagChip, type TagLite } from "@/components/tag-picker";
import { cn } from "@/lib/utils";
import { FeelingPill } from "./feeling-pill";
import { QuoteDetail } from "./quote-detail";
import type { Finding } from "./quote-table";
import { FEELING_LOOK, feelingOf, quoteKey, snippet, type Feeling, type QuoteRow } from "./types";

const COLUMNS: Feeling[] = ["positive", "neutral", "negative", "mixed", "none"];

/** Quotes grouped by how they feel. A card can be dragged to another column, which saves that feeling. */
export function QuoteBoard({
  workspaceId,
  rows,
  tags,
  canWrite,
  findings,
}: {
  workspaceId: string;
  rows: QuoteRow[];
  tags: TagLite[];
  canWrite: boolean;
  findings: Finding[];
}) {
  const router = useRouter();
  const [over, setOver] = useState<Feeling | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const detail = rows.find((r) => quoteKey(r) === openKey) ?? null;

  function move(row: QuoteRow, to: Feeling) {
    if (!canWrite || feelingOf(row.sentiment) === to) return;
    void (async () => {
      const r = await setSentimentAction(workspaceId, row.kind, row.id, to);
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success(`Moved to ${FEELING_LOOK[to].label.toLowerCase()}.`);
      router.refresh();
    })();
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((f) => {
          const items = rows.filter((r) => feelingOf(r.sentiment) === f);
          return (
            <section
              key={f}
              aria-labelledby={`col-${f}`}
              onDragOver={(e) => {
                if (!canWrite) return;
                e.preventDefault();
                setOver(f);
              }}
              onDragLeave={() => setOver((cur) => (cur === f ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const key = e.dataTransfer.getData("text/quote");
                const row = rows.find((r) => quoteKey(r) === key);
                if (row) move(row, f);
              }}
              className={cn(
                "space-y-3 rounded-xl border border-border bg-card/60 p-3 transition-colors",
                over === f && "border-ring bg-muted",
              )}
            >
              <h2 id={`col-${f}`} className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden="true" className={cn("size-2 rounded-full", FEELING_LOOK[f].dot)} />
                {FEELING_LOOK[f].label}
                <span className="font-normal text-muted-foreground">({items.length})</span>
              </h2>
              <ul className="space-y-2">
                {items.map((row) => (
                  <li key={quoteKey(row)}>
                    <article
                      draggable={canWrite}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/quote", quoteKey(row));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className={cn(
                        "space-y-2 rounded-lg border border-border bg-card p-2.5 text-sm shadow-xs",
                        canWrite && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenKey(quoteKey(row))}
                        className="line-clamp-4 text-left hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        “{row.text}”
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {row.personName ? `${row.personName} · ` : ""}
                        {row.sourceTitle || "A source"}
                      </p>
                      {row.tags.length ? (
                        <span className="flex flex-wrap gap-1">
                          {row.tags.slice(0, 1).map((t) => (
                            <TagChip key={t.id} tag={t} />
                          ))}
                          {row.tags.length > 1 ? (
                            <span className="text-xs text-muted-foreground">+{row.tags.length - 1}</span>
                          ) : null}
                        </span>
                      ) : null}
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={row.kind === "highlight" ? "tint-sky" : "outline"}>
                          {row.kind === "highlight" ? "Highlight" : "Evidence"}
                        </Badge>
                        <FeelingPill
                          workspaceId={workspaceId}
                          kind={row.kind}
                          id={row.id}
                          value={row.sentiment}
                          source={row.sentimentSource}
                          canWrite={canWrite}
                          quote={snippet(row.text, 30)}
                        />
                      </div>
                    </article>
                  </li>
                ))}
                {items.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-border px-2 py-6 text-center text-xs text-muted-foreground">
                    {canWrite ? "Drag a quote here." : "Nothing here."}
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
      <QuoteDetail
        workspaceId={workspaceId}
        row={detail}
        tags={tags}
        findings={findings}
        canWrite={canWrite}
        open={Boolean(detail)}
        onOpenChange={(o) => {
          if (!o) setOpenKey(null);
        }}
      />
    </div>
  );
}
