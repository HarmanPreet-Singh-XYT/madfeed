"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, GitMerge, Mail, MoreHorizontal, Pencil, Quote as QuoteIcon } from "lucide-react";
import { toast } from "sonner";
import { deletePersonAction } from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
              <TableRow key={p.id} className="align-middle">
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
              {avatar(p)}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setViewing(p)}
                  className="block truncate text-left font-medium"
                >
                  {p.name}
                </button>
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
