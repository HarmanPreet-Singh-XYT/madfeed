"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, GitMerge, Mail, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  personQuotesAction,
  type PersonQuote,
} from "@/app/(app)/w/[workspaceId]/people/actions";
import { deletePersonAction } from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { ConfirmDelete } from "@/components/confirm-delete";
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
import { PersonEditDialog } from "./person-edit-dialog";
import { avatarTint, initials, type AccountRow, type PersonRow } from "./types";

/**
 * One person: who they are, what they have said, and the actions on them. The
 * list stays behind it, so moving through people never loses your place.
 */
export function PersonDetail({
  workspaceId,
  person,
  accounts,
  canEdit,
  isAdmin,
  open,
  onOpenChange,
  onMerge,
}: {
  workspaceId: string;
  person: PersonRow | null;
  accounts: AccountRow[];
  canEdit: boolean;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge?: (person: PersonRow) => void;
}) {
  const [data, setData] = useState<{
    personId: string;
    quotes?: PersonQuote[];
    error?: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !person) return;
    let live = true;
    personQuotesAction(workspaceId, person.id).then((r) => {
      if (live) setData({ personId: person.id, quotes: r.quotes, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [open, person, workspaceId, attempt]);

  const loading = Boolean(person) && data?.personId !== person?.id;
  const quotes = data && data.personId === person?.id ? data.quotes : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {person ? (
          <>
            <SheetHeader className="border-b border-border pb-4">
              <div className="flex items-center gap-3 pr-8">
                <span
                  aria-hidden="true"
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarTint(person.name)}`}
                >
                  {initials(person.name)}
                </span>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{person.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {person.accountName ?? "No company"}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Email</dt>
                  <dd className="break-all">
                    {person.email ? (
                      <a className="text-link hover:underline" href={`mailto:${person.email}`}>
                        {person.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">None yet</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Added</dt>
                  <dd>
                    {person.createdAt ? <LocalTime iso={person.createdAt} /> : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Quotes</dt>
                  <dd className="tabular-nums">{person.quoteCount ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Last heard</dt>
                  <dd>
                    {person.lastHeardAt ? (
                      <LocalTime iso={person.lastHeardAt} relative />
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </dd>
                </div>
              </dl>

              <section aria-labelledby="person-quotes" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="person-quotes" className="text-sm font-semibold">
                    What they said
                  </h2>
                  <Link
                    href={`/w/${workspaceId}/quotes?personId=${person.id}`}
                    className="text-xs text-link hover:underline"
                  >
                    See all quotes
                  </Link>
                </div>
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-14 w-full rounded-lg" />
                    <Skeleton className="h-14 w-full rounded-lg" />
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
                ) : quotes && quotes.length > 0 ? (
                  <ul className="space-y-2">
                    {quotes.map((q) => (
                      <li
                        key={q.kind + q.id}
                        className="rounded-lg border border-border p-2.5 text-sm"
                      >
                        <p className="line-clamp-3">“{q.text}”</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={q.kind === "highlight" ? "tint-sky" : "outline"}>
                            {q.kind === "highlight" ? "Highlight" : "Evidence"}
                          </Badge>
                          <Link
                            href={`/w/${workspaceId}/sources/${q.sourceItemId}`}
                            className="max-w-40 truncate text-link underline underline-offset-2 hover:no-underline"
                          >
                            {q.sourceTitle || "A source"}
                          </Link>
                          {q.requestId && q.requestTitle ? (
                            <>
                              <span>·</span>
                              <Link
                                href={`/w/${workspaceId}/requests/${q.requestId}`}
                                className="max-w-40 truncate text-link underline underline-offset-2 hover:no-underline"
                              >
                                {q.requestTitle}
                              </Link>
                            </>
                          ) : null}
                          <span>·</span>
                          <LocalTime iso={q.at} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No quotes from {person.name} yet.
                  </p>
                )}
              </section>
            </div>

            <SheetFooter className="border-t border-border">
              <div className="flex flex-wrap gap-2">
                {canEdit ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Pencil aria-hidden="true" /> Edit
                  </Button>
                ) : null}
                {person.email ? (
                  <>
                    <Button asChild variant="outline" size="sm">
                      <a href={`mailto:${person.email}`}>
                        <Mail aria-hidden="true" /> Email
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(person.email ?? "")
                          .then(() => toast.success("Email copied."))
                          .catch(() => toast.error("Your browser would not let us copy."))
                      }
                    >
                      <Copy aria-hidden="true" /> Copy
                    </Button>
                  </>
                ) : null}
                {person.accountName ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/w/${workspaceId}/people?tab=people&accountId=${person.accountId}`}>
                      {person.accountName}
                    </Link>
                  </Button>
                ) : null}
                {isAdmin && onMerge ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onMerge(person)}
                  >
                    <GitMerge aria-hidden="true" /> Merge
                  </Button>
                ) : null}
                {isAdmin ? (
                  <ConfirmDelete
                    compact
                    label={`Delete ${person.name}`}
                    consequences={`This removes ${person.name}, everything they said (quotes, conversations, recordings and highlights) and any messages written to them. Their opt-out, if they have one, is kept so nobody can write to them again. This can't be undone.`}
                    confirmLabel={`Yes, delete ${person.name}`}
                    action={deletePersonAction.bind(null, workspaceId, person.id)}
                    thenGo={`/w/${workspaceId}/people`}
                  />
                ) : null}
              </div>
            </SheetFooter>

            <PersonEditDialog
              workspaceId={workspaceId}
              person={person}
              accounts={accounts}
              open={editing}
              onOpenChange={setEditing}
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
