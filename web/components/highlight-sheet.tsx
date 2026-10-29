"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Copy, Play } from "lucide-react";
import { toast } from "sonner";
import {
  createTagInlineAction,
  deleteHighlightAction,
  highlightContextAction,
  setHighlightTagsAction,
  type HighlightContext,
} from "@/app/(app)/w/[workspaceId]/research/actions";
import { clock } from "@/lib/format";
import { LocalTime } from "./local-time";
import { TagChip, TagPicker, type TagLite } from "./tag-picker";
import type { HighlightView } from "./highlight-card";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * One highlight, read in its conversation. The point is to answer "what was
 * being said around this?" without leaving the list, so opening the full
 * conversation is a link and never the only way to see context.
 */
export function HighlightSheet({
  workspaceId,
  highlight,
  allTags,
  canEdit,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  highlight: HighlightView | undefined;
  allTags: TagLite[];
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {highlight ? (
          <Body
            key={highlight.id}
            workspaceId={workspaceId}
            highlight={highlight}
            allTags={allTags}
            canEdit={canEdit}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  workspaceId,
  highlight: h,
  allTags,
  canEdit,
  onClose,
}: {
  workspaceId: string;
  highlight: HighlightView;
  allTags: TagLite[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const [context, setContext] = useState<HighlightContext>();
  const [failed, setFailed] = useState<string>();
  const [draft, setDraft] = useState<string[]>(h.tags.map((t) => t.id));
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const loading = !context && !failed;

  useEffect(() => {
    let live = true;
    highlightContextAction(workspaceId, h.sourceItemId, h.spanStart, h.spanEnd)
      .then((r) => {
        if (!live) return;
        if (r.error) setFailed(r.error);
        else setContext(r.context);
      })
      .catch(() => {
        if (live) setFailed("The conversation could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, [workspaceId, h.id, h.sourceItemId, h.spanStart, h.spanEnd]);

  function saveTags() {
    start(async () => {
      const r = await setHighlightTagsAction(workspaceId, h.id, draft);
      if (r.error) {
        setError(r.error);
        return;
      }
      setError(undefined);
      toast.success(r.notice ?? "Saved.");
    });
  }

  function remove() {
    start(async () => {
      const r = await deleteHighlightAction(workspaceId, h.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setConfirm(false);
      onClose();
      toast.success("Highlight removed");
    });
  }

  const query = `?s=${h.spanStart}&e=${h.spanEnd}`;

  return (
    <>
      <SheetHeader>
        <SheetTitle>Read in context</SheetTitle>
        <SheetDescription>
          {h.sourceTitle || "A conversation"} · <LocalTime iso={h.createdAt} />
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-6">
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-7">
          {loading ? (
            <span
              className="block space-y-2"
              role="status"
              aria-label="Loading the conversation"
            >
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </span>
          ) : (
            <p>
              {context?.before ? (
                <span className="text-muted-foreground">{context.before} </span>
              ) : null}
              <mark className="rounded bg-tint-blue px-1 font-medium text-foreground">
                “{h.quote}”
              </mark>
              {context?.after ? (
                <span className="text-muted-foreground"> {context.after}</span>
              ) : null}
            </p>
          )}
        </div>
        {failed ? (
          <p className="text-sm text-muted-foreground">
            The words around this could not be loaded.{" "}
            <Link
              href={`/w/${workspaceId}/sources/${h.sourceItemId}${query}#quote`}
              className="text-link underline underline-offset-4 hover:text-foreground"
            >
              Open the conversation
            </Link>
            .
          </p>
        ) : null}
        {h.note ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Note: </span>
            {h.note}
          </p>
        ) : null}
        {!canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {h.tags.length === 0 ? (
              <span className="text-sm text-muted-foreground">No tags</span>
            ) : (
              h.tags.map((t) => <TagChip key={t.id} tag={t} />)
            )}
          </div>
        ) : null}
        {canEdit ? (
          <div className="space-y-3">
            <TagPicker
              legend="Tags"
              tags={allTags}
              selected={draft}
              onChange={setDraft}
              disabled={pending}
              onCreate={(name) =>
                createTagInlineAction(workspaceId, name).then((r) => ({
                  error: r.error,
                  tag: r.tag,
                }))
              }
            />
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={saveTags}
            >
              {pending ? "Saving…" : "Save tags"}
            </Button>
          </div>
        ) : null}
        <FormError message={error} />
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button asChild variant="outline">
            <Link href={`/w/${workspaceId}/sources/${h.sourceItemId}${query}#quote`}>
              Open the conversation
            </Link>
          </Button>
          {h.startMs !== undefined ? (
            <Button asChild variant="outline">
              <Link
                href={`/w/${workspaceId}/sources/${h.sourceItemId}${query}&t=${h.startMs}#quote`}
              >
                <Play aria-hidden="true" />
                Play from {clock(h.startMs)}
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              navigator.clipboard
                ?.writeText(h.quote)
                .then(() => toast.success("Quote copied."))
                .catch(() => toast.error("Could not copy the quote."));
            }}
          >
            <Copy aria-hidden="true" />
            Copy quote
          </Button>
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-tint-coral hover:text-destructive"
              onClick={() => setConfirm(true)}
            >
              Remove…
            </Button>
          ) : null}
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this highlight?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation is not changed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                remove();
              }}
            >
              {pending ? "Removing…" : "Yes, remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
