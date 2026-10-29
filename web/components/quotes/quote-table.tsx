"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Copy, Download, ExternalLink, FilePlus, Link2, MoreHorizontal, X } from "lucide-react";
import { addQuoteToFindingAction, labelQuotesAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { addTagsToHighlightsAction, deleteHighlightsAction } from "@/app/(app)/w/[workspaceId]/research/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TagChip, type TagLite } from "@/components/tag-picker";
import { LocalTime } from "@/components/local-time";
import { cn } from "@/lib/utils";
import { FeelingPill } from "./feeling-pill";
import { QuoteDetail } from "./quote-detail";
import { FEELING_LOOK, quoteKey, SOURCE_LABEL, snippet, type Feeling, type QuoteRow } from "./types";

const FEELINGS: Feeling[] = ["positive", "neutral", "negative", "mixed", "none"];

export type Finding = { id: string; title: string; state: "draft" | "published" };

function copy(text: string, what: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${what} copied.`))
    .catch(() => toast.error("Your browser would not let us copy. Select the text and copy it by hand."));
}

function quoteLine(row: QuoteRow) {
  return `“${row.text}” — ${row.sourceTitle || "a source"}, ${new Date(row.at).toLocaleDateString()}`;
}

/**
 * The quote list. Rows can be selected and acted on together; the quote itself
 * opens a detail panel; every action keeps the list in place.
 */
export function QuoteTable({
  workspaceId,
  rows,
  tags,
  canWrite,
  initialOpen,
  findings,
}: {
  workspaceId: string;
  rows: QuoteRow[];
  tags: TagLite[];
  canWrite: boolean;
  initialOpen?: string;
  findings: Finding[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(initialOpen ?? null);
  const [active, setActive] = useState(-1);
  const [pending, start] = useTransition();

  const keys = useMemo(() => rows.map(quoteKey), [rows]);
  const selectedRows = rows.filter((r) => selected.has(quoteKey(r)));
  const allOnPage = rows.length > 0 && selectedRows.length === rows.length;
  const some = selectedRows.length > 0 && !allOnPage;
  const detail = rows.find((r) => quoteKey(r) === openKey) ?? null;
  const exportParams = new URLSearchParams(sp.toString());
  exportParams.delete("open");
  exportParams.delete("afterAt");
  exportParams.delete("afterId");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [data-slot='popover-content']")) return;
      if (e.key === "Escape" && openKey) {
        setOpenKey(null);
        setActive(-1);
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(rows.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === "x" && active >= 0) {
        e.preventDefault();
        toggle(keys[active]);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        setOpenKey(keys[active]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggle(key: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allOnPage ? new Set() : new Set(keys));
  }

  function labelAll(label: Feeling) {
    const items = selectedRows.map((r) => ({ kind: r.kind, id: r.id }));
    start(async () => {
      const r = await labelQuotesAction(workspaceId, items, label);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.notice ?? "Saved.");
      setSelected(new Set());
      router.refresh();
    });
  }

  function tagAll(tagId: string) {
    const ids = selectedRows.map((r) => r.id);
    start(async () => {
      const r = await addTagsToHighlightsAction(workspaceId, ids, [tagId]);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.notice ?? "Tagged.");
      setSelected(new Set());
      router.refresh();
    });
  }

  function deleteSelected() {
    const ids = selectedRows.filter((r) => r.kind === "highlight").map((r) => r.id);
    if (ids.length === 0) return;
    start(async () => {
      const r = await deleteHighlightsAction(workspaceId, ids);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(`Removed ${ids.length} highlight${ids.length === 1 ? "" : "s"}.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  function addToFinding(row: QuoteRow, docId: string) {
    start(async () => {
      const r = await addQuoteToFindingAction(workspaceId, docId, row.kind, row.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.notice ?? "Added to the finding.");
      router.refresh();
    });
  }

  const tagsCell = (row: QuoteRow) =>
    row.tags.length === 0 ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className="flex flex-wrap items-center gap-1">
        {row.tags.slice(0, 2).map((t) => (
          <TagChip key={t.id} tag={t} />
        ))}
        {row.tags.length > 2 ? (
          <span className="text-xs text-muted-foreground">+{row.tags.length - 2}</span>
        ) : null}
      </span>
    );

  const rowMenu = (row: QuoteRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for “${snippet(row.text, 40)}”`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => copy(quoteLine(row), "Quote")}>
          <Copy aria-hidden="true" /> Copy quote
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            copy(
              `${window.location.origin}/w/${workspaceId}/quotes?open=${row.kind}:${row.id}`,
              "Link",
            )
          }
        >
          <Link2 aria-hidden="true" /> Copy link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setOpenKey(quoteKey(row))}>
          Open details
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/w/${workspaceId}/sources/${row.sourceItemId}`}>
            <ExternalLink aria-hidden="true" /> Open source
          </Link>
        </DropdownMenuItem>
        {canWrite ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FilePlus aria-hidden="true" /> Add to finding
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                {findings.filter((f) => f.state === "draft").length === 0 ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/w/${workspaceId}/findings`}>Start a findings document</Link>
                  </DropdownMenuItem>
                ) : (
                  findings
                    .filter((f) => f.state === "draft")
                    .map((f) => (
                      <DropdownMenuItem key={f.id} onSelect={() => addToFinding(row, f.id)}>
                        {f.title}
                      </DropdownMenuItem>
                    ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        ) : null}
        {row.kind === "highlight" && canWrite ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setOpenKey(quoteKey(row))}>
              Delete highlight…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <Table>
          <TableCaption className="sr-only">
            Quotes, with selection and actions. j and k move, x selects, Enter opens.
          </TableCaption>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-transparent">
              <TableHead scope="col" className="w-10 px-3">
                <Checkbox
                  checked={allOnPage ? true : some ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label={allOnPage ? "Deselect every quote on this page" : "Select every quote on this page"}
                />
              </TableHead>
              <TableHead scope="col" className="px-3 text-xs font-medium text-muted-foreground">Quote</TableHead>
              <TableHead scope="col" className="px-3 text-xs font-medium text-muted-foreground">Kind</TableHead>
              <TableHead scope="col" className="px-3 text-xs font-medium text-muted-foreground">From</TableHead>
              <TableHead scope="col" className="px-3 text-xs font-medium text-muted-foreground">Tags</TableHead>
              <TableHead scope="col" className="px-3 text-xs font-medium text-muted-foreground">Feels</TableHead>
              <TableHead scope="col" className="px-3 text-xs font-medium text-muted-foreground">Date</TableHead>
              <TableHead scope="col" className="w-10 px-2"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const key = quoteKey(row);
              return (
                <TableRow
                  key={key}
                  data-state={selected.has(key) ? "selected" : undefined}
                  className={cn("align-top", active === i && "ring-2 ring-ring/40 ring-inset")}
                >
                  <TableCell className="px-3 py-2.5">
                    <Checkbox
                      checked={selected.has(key)}
                      onCheckedChange={() => toggle(key)}
                      aria-label={`Select “${snippet(row.text, 40)}”`}
                    />
                  </TableCell>
                  <TableCell className="max-w-md px-3 py-2.5 whitespace-normal">
                    <button
                      type="button"
                      onClick={() => {
                        setActive(i);
                        setOpenKey(key);
                      }}
                      className="line-clamp-2 text-left hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      “{row.text}”
                    </button>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <Badge variant={row.kind === "highlight" ? "tint-sky" : "outline"}>
                      {row.kind === "highlight" ? "Highlight" : "Evidence"}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 whitespace-normal">
                    <Link
                      href={`/w/${workspaceId}/sources/${row.sourceItemId}`}
                      className="line-clamp-2 hover:underline"
                    >
                      {row.sourceTitle || "A source"}
                    </Link>
                    {row.personName ? (
                      <span className="line-clamp-1 text-xs">
                        {row.personName}
                        {row.accountName ? ` · ${row.accountName}` : ""}
                      </span>
                    ) : null}
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {SOURCE_LABEL[row.sourceKind] ?? row.sourceKind}
                      {row.requestTitle ? ` · ${row.requestTitle}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 whitespace-normal">{tagsCell(row)}</TableCell>
                  <TableCell className="px-3 py-2.5">
                    <FeelingPill
                      workspaceId={workspaceId}
                      kind={row.kind}
                      id={row.id}
                      value={row.sentiment}
                      source={row.sentimentSource}
                      canWrite={canWrite}
                      quote={snippet(row.text, 40)}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                    <LocalTime iso={row.at} />
                  </TableCell>
                  <TableCell className="px-2 py-2.5">{rowMenu(row)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((row) => {
          const key = quoteKey(row);
          return (
            <li
              key={key}
              data-state={selected.has(key) ? "selected" : undefined}
              className="rounded-xl border border-border bg-card p-3 data-[state=selected]:ring-2 data-[state=selected]:ring-ring/40"
            >
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={selected.has(key)}
                  onCheckedChange={() => toggle(key)}
                  aria-label={`Select “${snippet(row.text, 40)}”`}
                  className="mt-1"
                />
                <button
                  type="button"
                  onClick={() => setOpenKey(key)}
                  className="line-clamp-3 flex-1 text-left"
                >
                  “{row.text}”
                </button>
                {rowMenu(row)}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
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
                  quote={snippet(row.text, 40)}
                />
                <span className="text-xs text-muted-foreground">
                  {row.personName ? `${row.personName} · ` : ""}
                  {row.sourceTitle || "A source"} · <LocalTime iso={row.at} />
                </span>
              </div>
              {row.tags.length ? <div className="mt-2 pl-6">{tagsCell(row)}</div> : null}
            </li>
          );
        })}
      </ul>

      <p className="hidden text-xs text-muted-foreground md:block">
        j / k move · x selects · Enter opens · Esc closes
      </p>

      {selectedRows.length > 0 ? (
        <div
          role="region"
          aria-label="Actions for the selected quotes"
          className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-border bg-popover p-2 shadow-lg"
        >
          <span className="px-1 text-sm font-medium">
            {selectedRows.length} selected
          </span>
          {canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  Set feeling
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {FEELINGS.map((f) => (
                  <DropdownMenuItem key={f} onSelect={() => labelAll(f)}>
                    <span aria-hidden="true" className={cn("size-2 rounded-full", FEELING_LOOK[f].dot)} />
                    {FEELING_LOOK[f].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {canWrite &&
          selectedRows.every((r) => r.kind === "highlight") &&
          tags.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  Add tag
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-64 overflow-y-auto">
                {tags.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => tagAll(t.id)}>
                    {t.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(selectedRows.map(quoteLine).join("\n\n"), "Quotes")}
          >
            <Copy aria-hidden="true" /> Copy
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/w/${workspaceId}/quotes/export?${exportParams.toString()}`}>
              <Download aria-hidden="true" /> Export
            </a>
          </Button>
          {canWrite && selectedRows.some((r) => r.kind === "highlight") ? (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteSelected} disabled={pending}>
              Delete highlights
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            <X aria-hidden="true" /> Deselect
          </Button>
        </div>
      ) : null}

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
