"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Download, GitMerge, Mail, MoreHorizontal, Pencil, Quote as QuoteIcon, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deletePersonAction } from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Badge } from "@/components/ui/badge";
import { deletePeopleAction } from "@/app/(app)/w/[workspaceId]/people/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalTime } from "@/components/local-time";
import { PersonDetail } from "./person-detail";
import { PersonEditDialog } from "./person-edit-dialog";
import { MergePersonDialog } from "./merge-dialog";
import { MergeSelectedDialog } from "./merge-selected-dialog";
import { avatarTint, initials, type AccountRow, type PersonRow } from "./types";

/**
 * The people list. A name opens the person beside the list; email, company and
 * quote count are one click from the row; an admin can delete with the usual
 * explanation of what goes.
 */
export function PeopleTable({
  workspaceId,
  rows,
  accounts,
  canEdit,
  isAdmin,
}: {
  workspaceId: string;
  rows: PersonRow[];
  accounts: AccountRow[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [viewing, setViewing] = useState<PersonRow | null>(null);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [merging, setMerging] = useState<PersonRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeSelected, setMergeSelected] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [pending, start] = useTransition();
  const [active, setActive] = useState(-1);
  const router = useRouter();

  const selectedRows = rows.filter((p) => selected.has(p.id));
  const allOnPage = rows.length > 0 && selectedRows.length === rows.length;
  const some = selectedRows.length > 0 && !allOnPage;

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyEmails() {
    const emails = selectedRows.map((p) => p.email).filter((e): e is string => Boolean(e));
    if (emails.length === 0) {
      toast.info("Nobody in the selection has an email.");
      return;
    }
    navigator.clipboard
      .writeText(emails.join(", "))
      .then(() =>
        toast.success(`${emails.length} email${emails.length === 1 ? "" : "s"} copied.`),
      )
      .catch(() => toast.error("Your browser would not let us copy."));
  }

  function exportSelected() {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [["Name", "Email", "Company", "Quotes", "Last heard", "Added"].join(",")];
    for (const p of selectedRows) {
      lines.push(
        [
          cell(p.name),
          cell(p.email ?? ""),
          cell(p.accountName ?? ""),
          cell(String(p.quoteCount ?? 0)),
          cell(p.lastHeardAt ? new Date(p.lastHeardAt).toISOString() : ""),
          cell(p.createdAt ? new Date(p.createdAt).toISOString() : ""),
        ].join(","),
      );
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `people-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function deleteSelected() {
    start(async () => {
      const r = await deletePeopleAction(workspaceId, selectedRows.map((p) => p.id));
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.notice ?? "Deleted.");
      setSelected(new Set());
      setUnderstood(false);
      router.refresh();
    });
  }

  const pair: [PersonRow, PersonRow] | null =
    selectedRows.length === 2 ? [selectedRows[0], selectedRows[1]] : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (e.key === "/" ) {
        const search = document.getElementById("people-search") as HTMLInputElement | null;
        if (search) {
          e.preventDefault();
          search.focus();
        }
        return;
      }
      if (e.key === "Escape") {
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
        toggle(rows[active].id);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        setViewing(rows[active]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const personLink = (p: PersonRow) => `/w/${workspaceId}/people?tab=people&accountId=${p.accountId}`;

  const menu = (p: PersonRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {canEdit ? (
          <DropdownMenuItem onSelect={() => setEditing(p)}>
            <Pencil aria-hidden="true" /> Edit person
          </DropdownMenuItem>
        ) : null}
        {p.email ? (
          <>
            <DropdownMenuItem
              onSelect={() =>
                navigator.clipboard
                  .writeText(p.email ?? "")
                  .then(() => toast.success("Email copied."))
                  .catch(() => toast.error("Your browser would not let us copy."))
              }
            >
              <Copy aria-hidden="true" /> Copy email
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`mailto:${p.email}`}>
                <Mail aria-hidden="true" /> Email {p.name.split(" ")[0]}
              </a>
            </DropdownMenuItem>
          </>
        ) : null}
        {isAdmin ? (
          <DropdownMenuItem onSelect={() => setMerging(p)}>
            <GitMerge aria-hidden="true" /> Merge into another person…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setViewing(p)}>
          Open details
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/w/${workspaceId}/quotes?personId=${p.id}`}>
            <QuoteIcon aria-hidden="true" /> Their quotes
          </Link>
        </DropdownMenuItem>
        {p.accountId ? (
          <DropdownMenuItem asChild>
            <Link href={personLink(p)}>{p.accountName ?? "Their company"}</Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const avatar = (p: PersonRow) => (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTint(p.name)}`}
    >
      {initials(p.name)}
    </span>
  );

  const heard = (p: PersonRow) =>
    p.lastHeardAt ? (
      <LocalTime iso={p.lastHeardAt} relative />
    ) : (
      <span className="text-muted-foreground">Never</span>
    );

  return (
    <div className="space-y-2">
      <Card className="hidden gap-0 overflow-hidden py-0 md:block">
        <Table>
          <TableCaption className="sr-only">People, A to Z</TableCaption>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-transparent">
              <TableHead scope="col" className="w-10 px-3">
                <Checkbox
                  checked={allOnPage ? true : some ? "indeterminate" : false}
                  onCheckedChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((p) => p.id)))}
                  aria-label={allOnPage ? "Deselect every person on this page" : "Select every person on this page"}
                />
              </TableHead>
              <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground">Person</TableHead>
              <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground">Email</TableHead>
              <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground">Company</TableHead>
              <TableHead scope="col" className="px-4 text-right text-xs font-medium text-muted-foreground">Quotes</TableHead>
              <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground">Last heard</TableHead>
              <TableHead scope="col" className="w-16 px-2"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow
                key={p.id}
                className="align-middle"
                data-state={selected.has(p.id) ? "selected" : undefined}
              >
                <TableCell className="px-3 py-2.5">
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    {avatar(p)}
                    <button
                      type="button"
                      onClick={() => setViewing(p)}
                      className="truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {p.name}
                    </button>
                    {p.similarName ? (
                      <Badge
                        variant="tint-amber"
                        title="Another person in this workspace has the same name, so this may be a duplicate"
                      >
                        Possible duplicate
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="max-w-56 px-4 py-2.5">
                  {p.email ? (
                    <a
                      href={`mailto:${p.email}`}
                      className="block truncate text-muted-foreground hover:underline"
                      title={p.email}
                    >
                      {p.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-44 px-4 py-2.5">
                  {p.accountId ? (
                    <Link
                      href={personLink(p)}
                      className="block truncate text-link underline underline-offset-2 hover:no-underline"
                      title={`Everyone at ${p.accountName}`}
                    >
                      {p.accountName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No company</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2.5 text-right tabular-nums">
                  {p.quoteCount ? (
                    <Link
                      href={`/w/${workspaceId}/quotes?personId=${p.id}`}
                      className="text-link underline underline-offset-2 hover:no-underline"
                      title={`Quotes from ${p.name}`}
                    >
                      {p.quoteCount}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2.5 text-muted-foreground">{heard(p)}</TableCell>
                <TableCell className="px-2 py-2.5">
                  <span className="flex items-center justify-end gap-1">
                    {menu(p)}
                    {isAdmin ? (
                      <ConfirmDelete
                        compact
                        label={`Delete ${p.name}`}
                        consequences={`This removes ${p.name}, everything they said (quotes, conversations, recordings and highlights) and any messages written to them. Their opt-out, if they have one, is kept so nobody can write to them again. This can't be undone.`}
                        confirmLabel={`Yes, delete ${p.name}`}
                        action={deletePersonAction.bind(null, workspaceId, p.id)}
                      />
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ul className="space-y-2 md:hidden">
        {rows.map((p) => (
          <li key={p.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-2.5">
              <Checkbox
                checked={selected.has(p.id)}
                onCheckedChange={() => toggle(p.id)}
                aria-label={`Select ${p.name}`}
                className="mt-1.5"
              />
              {avatar(p)}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setViewing(p)}
                  className="block truncate text-left font-medium"
                >
                  {p.name}
                </button>
                {p.similarName ? (
                  <Badge variant="tint-amber" className="mt-1">
                    Possible duplicate
                  </Badge>
                ) : null}
                <p className="truncate text-sm text-muted-foreground">
                  {p.email ?? "No email"}
                </p>
              </div>
              {menu(p)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-10 text-xs text-muted-foreground">
              {p.accountId ? (
                <Link href={personLink(p)} className="text-link underline underline-offset-2">
                  {p.accountName}
                </Link>
              ) : (
                <span>No company</span>
              )}
              <span>·</span>
              <span>
                {p.quoteCount ?? 0} quote{p.quoteCount === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>{heard(p)}</span>
            </div>
            {isAdmin ? (
              <div className="mt-2 flex justify-end">
                <ConfirmDelete
                  compact
                  label={`Delete ${p.name}`}
                  consequences={`This removes ${p.name}, everything they said (quotes, conversations, recordings and highlights) and any messages written to them. Their opt-out, if they have one, is kept so nobody can write to them again. This can't be undone.`}
                  confirmLabel={`Yes, delete ${p.name}`}
                  action={deletePersonAction.bind(null, workspaceId, p.id)}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {selectedRows.length > 0 ? (
        <div
          role="region"
          aria-label="Actions for the selected people"
          className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-border bg-popover p-2 shadow-lg"
        >
          <span className="px-1 text-sm font-medium">{selectedRows.length} selected</span>
          {isAdmin ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedRows.length !== 2}
              title={
                selectedRows.length === 2
                  ? "Merge these two into one person"
                  : "Choose exactly two people to merge"
              }
              onClick={() => setMergeSelected(true)}
            >
              <GitMerge aria-hidden="true" /> Merge…
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={copyEmails}>
            <Copy aria-hidden="true" /> Copy emails
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={exportSelected}>
            <Download aria-hidden="true" /> Export
          </Button>
          {isAdmin ? (
            <AlertDialog
              onOpenChange={(o) => {
                if (!o) setUnderstood(false);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending}>
                  <Trash2 aria-hidden="true" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {selectedRows.length} {selectedRows.length === 1 ? "person" : "people"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes {selectedRows.map((p) => p.name).join(", ")} and everything
                    they said (quotes, conversations, recordings and highlights) and any
                    messages written to them. Their opt-outs are kept so nobody can write
                    to them again. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="bulk-delete-confirm"
                    checked={understood}
                    onCheckedChange={(v) => setUnderstood(v === true)}
                  />
                  <Label htmlFor="bulk-delete-confirm" className="text-sm font-normal">
                    I understand this cannot be undone.
                  </Label>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <AlertDialogAction disabled={!understood || pending} onClick={deleteSelected}>
                    Delete {selectedRows.length}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            <X aria-hidden="true" /> Deselect
          </Button>
        </div>
      ) : null}

      <p className="hidden text-xs text-muted-foreground md:block">
        j / k move · x selects · Enter opens · / searches
      </p>

      <PersonDetail
        workspaceId={workspaceId}
        person={viewing}
        accounts={accounts}
        canEdit={canEdit}
        isAdmin={isAdmin}
        open={Boolean(viewing)}
        onOpenChange={(o) => {
          if (!o) setViewing(null);
        }}
        onMerge={(p) => {
          setViewing(null);
          setMerging(p);
        }}
      />
      <PersonEditDialog
        workspaceId={workspaceId}
        person={editing}
        accounts={accounts}
        open={Boolean(editing)}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      />
      <MergeSelectedDialog
        workspaceId={workspaceId}
        pair={pair}
        open={mergeSelected}
        onOpenChange={(o) => {
          if (!o) setMergeSelected(false);
        }}
        onMerged={() => setSelected(new Set())}
      />
      <MergePersonDialog
        workspaceId={workspaceId}
        source={merging}
        suggestions={rows.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          hint: p.accountName,
        }))}
        open={Boolean(merging)}
        onOpenChange={(o) => {
          if (!o) setMerging(null);
        }}
        onMerged={() => {
          if (viewing?.id === merging?.id) setViewing(null);
          setMerging(null);
        }}
      />
    </div>
  );
}
