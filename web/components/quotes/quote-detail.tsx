"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, FilePlus, Link2, Trash2 } from "lucide-react";
import { deleteHighlightAction, setHighlightTagsAction } from "@/app/(app)/w/[workspaceId]/research/actions";
import { addQuoteToFindingAction } from "@/app/(app)/w/[workspaceId]/quotes/actions";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Finding } from "./quote-table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TagChip, TagPicker, type TagLite } from "@/components/tag-picker";
import { LocalTime } from "@/components/local-time";
import { FeelingPill } from "./feeling-pill";
import { SOURCE_LABEL, snippet, type QuoteRow } from "./types";

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Your browser would not let us copy. Select the text and copy it by hand.");
  }
}

/** One quote, its provenance, and the things a person can do with it — without leaving the list. */
export function QuoteDetail({
  workspaceId,
  row,
  tags,
  findings,
  canWrite,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  row: QuoteRow | null;
  tags: TagLite[];
  findings: Finding[];
  canWrite: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [seen, setSeen] = useState<string>("");
  const now = row ? row.tags.map((t) => t.id).join() : "";
  if (row && seen !== now) {
    setSeen(now);
    setSelected(row.tags.map((t) => t.id));
  }

  const link =
    row && typeof window !== "undefined"
      ? `${window.location.origin}/w/${workspaceId}/quotes?open=${row.kind}:${row.id}`
      : "";

  function saveTags(next: string[]) {
    if (!row) return;
    const before = selected;
    setSelected(next);
    void (async () => {
      const r = await setHighlightTagsAction(workspaceId, row.id, next);
      if (r.error) {
        setSelected(before);
        toast.error(r.error);
        return;
      }
      toast.success("Tags saved.");
      router.refresh();
    })();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {row ? (
          <>
            <SheetHeader className="border-b border-border pb-4">
              <div className="flex flex-wrap items-center gap-2 pr-8">
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
                  size="md"
                />
              </div>
              <SheetTitle className="sr-only">Quote detail</SheetTitle>
              <SheetDescription className="sr-only">
                The full quote, where it came from, and what you can do with it.
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <blockquote className="font-display text-lg leading-relaxed text-balance">
                “{row.text}”
              </blockquote>

              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">From</dt>
                  <dd>
                    <Link
                      href={`/w/${workspaceId}/sources/${row.sourceItemId}`}
                      className="text-link underline underline-offset-2 hover:no-underline"
                    >
                      {row.sourceTitle || "A source"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {SOURCE_LABEL[row.sourceKind] ?? row.sourceKind} ·{" "}
                      <LocalTime iso={row.at} />
                    </span>
                  </dd>
                </div>
                {row.personName ? (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      Said by
                    </dt>
                    <dd>
                      {row.personName}
                      {row.accountName ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.accountName}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {row.requestId && row.requestTitle ? (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">
                      Evidence for
                    </dt>
                    <dd>
                      <Link
                        href={`/w/${workspaceId}/requests/${row.requestId}`}
                        className="text-link underline underline-offset-2 hover:no-underline"
                      >
                        {row.requestTitle}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Tags</dt>
                  <dd className="mt-1.5">
                    {row.kind === "evidence" ? (
                      row.tags.length ? (
                        <span className="flex flex-wrap gap-1">
                          {row.tags.map((t) => (
                            <TagChip key={t.id} tag={t} />
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No tags on its request.</span>
                      )
                    ) : canWrite ? (
                      <TagPicker
                        legend="Tags on this highlight"
                        tags={tags}
                        selected={selected}
                        onChange={saveTags}
                      />
                    ) : row.tags.length ? (
                      <span className="flex flex-wrap gap-1">
                        {row.tags.map((t) => (
                          <TagChip key={t.id} tag={t} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No tags.</span>
                    )}
                    {row.kind === "evidence" ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Evidence takes the tags of the request it supports.
                      </p>
                    ) : null}
                  </dd>
                </div>
              </dl>

              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Stored word for word. Quotes are never edited, so every claim keeps
                a source.
              </p>
            </div>

            <SheetFooter className="border-t border-border">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copy(
                      `“${row.text}” — ${row.sourceTitle || "a source"}, ${new Date(row.at).toLocaleDateString()}`,
                      "Quote",
                    )
                  }
                >
                  <Copy aria-hidden="true" /> Copy quote
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(link, "Link")}
                >
                  <Link2 aria-hidden="true" /> Copy link
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/w/${workspaceId}/sources/${row.sourceItemId}`}>
                    <ExternalLink aria-hidden="true" /> Open source
                  </Link>
                </Button>
                {canWrite ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        <FilePlus aria-hidden="true" /> Add to finding
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                      {findings.filter((f) => f.state === "draft").length === 0 ? (
                        <DropdownMenuItem asChild>
                          <Link href={`/w/${workspaceId}/findings`}>
                            Start a findings document
                          </Link>
                        </DropdownMenuItem>
                      ) : (
                        findings
                          .filter((f) => f.state === "draft")
                          .map((f) => (
                            <DropdownMenuItem
                              key={f.id}
                              onSelect={async () => {
                                const r = await addQuoteToFindingAction(
                                  workspaceId,
                                  f.id,
                                  row.kind,
                                  row.id,
                                );
                                if (r.error) toast.error(r.error);
                                else {
                                  toast.success(r.notice ?? "Added to the finding.", {
                                    action: {
                                      label: "Open",
                                      onClick: () =>
                                        router.push(`/w/${workspaceId}/findings/${f.id}`),
                                    },
                                  });
                                }
                              }}
                            >
                              {f.title}
                            </DropdownMenuItem>
                          ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {row.kind === "highlight" && canWrite ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="text-destructive">
                        <Trash2 aria-hidden="true" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent size="sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this highlight?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The source stays; only this highlight is removed. This cannot
                          be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            const r = await deleteHighlightAction(workspaceId, row.id);
                            if (r.error) {
                              toast.error(r.error);
                              return;
                            }
                            toast.success("Highlight deleted.");
                            onOpenChange(false);
                            router.refresh();
                          }}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
