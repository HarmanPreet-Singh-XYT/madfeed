"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createHighlightAction,
  createTagInlineAction,
  deleteHighlightAction,
  setHighlightTagsAction,
} from "@/app/(app)/w/[workspaceId]/research/actions";
import { clock } from "@/lib/format";
import { FormError } from "./form-message";
import { LocalTime } from "./local-time";
import { TagChip, TagPicker, type TagLite } from "./tag-picker";
import { link } from "./ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

export type HighlightView = {
  id: string;
  sourceItemId: string;
  sourceTitle: string;
  spanStart: number;
  spanEnd: number;
  quote: string;
  note: string;
  startMs?: number;
  createdAt: string;
  tags: TagLite[];
};

export function HighlightCard({
  workspaceId,
  highlight,
  allTags,
  canEdit,
  selected,
  onSelect,
  onOpen,
}: {
  workspaceId: string;
  highlight: HighlightView;
  allTags: TagLite[];
  canEdit: boolean;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  onOpen?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(highlight.tags.map((t) => t.id));
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const h = highlight;

  function saveTags(
    tagIds: string[],
    opts?: { message?: string; undo?: string[]; after?: () => void },
  ) {
    start(async () => {
      const r = await setHighlightTagsAction(workspaceId, h.id, tagIds);
      if (r.error) {
        setError(r.error);
        return;
      }
      setError(undefined);
      setDraft(tagIds);
      opts?.after?.();
      const undo = opts?.undo;
      toast.success(
        opts?.message ?? "Saved.",
        undo
          ? {
              action: {
                label: "Undo",
                onClick: () => saveTags(undo, { message: "Put back." }),
              },
            }
          : undefined,
      );
    });
  }

  async function copyLink() {
    const url = `${window.location.origin}/w/${workspaceId}/sources/${h.sourceItemId}?s=${h.spanStart}&e=${h.spanEnd}#quote`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Your browser wouldn't let us copy. Copy the address bar.");
    }
  }

  function removeTag(tag: TagLite) {
    const before = h.tags.map((t) => t.id);
    saveTags(
      before.filter((id) => id !== tag.id),
      {
        message: `“${tag.name}” taken off`,
        undo: before,
      },
    );
  }

  function remove() {
    start(async () => {
      const r = await deleteHighlightAction(workspaceId, h.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setConfirm(false);
      toast.success("Highlight removed", {
        action: {
          label: "Undo",
          onClick: async () => {
            const back = await createHighlightAction(
              workspaceId,
              h.sourceItemId,
              h.spanStart,
              h.spanEnd,
              h.quote,
              h.tags.map((t) => t.id),
              h.note,
            );
            if (back.error) toast.error(back.error);
          },
        },
      });
    });
  }

  return (
    <Card
      asChild
      className={`[--card-spacing:0px] space-y-3 p-4 ${selected ? "ring-2 ring-primary/60" : ""}`}
    >
      <li>
        <div className="flex items-start justify-between gap-3">
          {canEdit && onSelect ? (
            <label className="inline-flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={selected ?? false}
                onCheckedChange={(v) => onSelect(v === true)}
                aria-label={`Select the highlight “${h.quote.slice(0, 60)}”`}
              />
              <span className="sr-only">Select</span>
            </label>
          ) : (
            <span />
          )}
          <LocalTime iso={h.createdAt} />
        </div>
        <blockquote className="border-l-2 border-primary/40 pl-3 text-[0.9375rem] leading-7">
          “{h.quote}”
        </blockquote>
        {h.note ? (
          <p className="text-sm text-muted-foreground">Note: {h.note}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {h.tags.length === 0 ? (
            <span className="text-sm text-muted-foreground">No tags</span>
          ) : (
            h.tags.map((t) => (
              <TagChip
                key={t.id}
                tag={t}
                onRemove={canEdit ? () => removeTag(t) : undefined}
              />
            ))
          )}
        </div>
        <p className="text-sm">
          <Link
            href={`/w/${workspaceId}/sources/${h.sourceItemId}?s=${h.spanStart}&e=${h.spanEnd}#quote`}
            className={link}
          >
            See it in the conversation
          </Link>
          {h.startMs !== undefined ? (
            <>
              {" · "}
              <Link
                href={`/w/${workspaceId}/sources/${h.sourceItemId}?s=${h.spanStart}&e=${h.spanEnd}&t=${h.startMs}#quote`}
                className={link}
              >
                Play from {clock(h.startMs)}
              </Link>
            </>
          ) : null}
          {" · "}
          <button
            type="button"
            onClick={() => void copyLink()}
            className="rounded-sm text-link underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Copy link
          </button>
          {h.sourceTitle ? (
            <span className="text-muted-foreground"> · {h.sourceTitle}</span>
          ) : null}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {onOpen ? (
              <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
                Read in context
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(h.tags.map((t) => t.id));
                setEditing((v) => !v);
              }}
              aria-expanded={editing}
            >
              Edit tags
            </Button>
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-tint-coral hover:text-destructive"
                >
                  Remove highlight
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this highlight?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The conversation is not changed. You can take this back
                    straight after, from the message at the bottom.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>
                    Keep it
                  </AlertDialogCancel>
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
          </div>
        ) : null}
        {editing ? (
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
              onClick={() =>
                saveTags(draft, { after: () => setEditing(false) })
              }
            >
              {pending ? "Saving…" : "Save tags"}
            </Button>
          </div>
        ) : null}
        <FormError message={error} />
      </li>
    </Card>
  );
}
