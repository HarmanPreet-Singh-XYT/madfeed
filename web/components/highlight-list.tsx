"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addTagsToHighlightsAction,
  createTagInlineAction,
  deleteHighlightsAction,
} from "@/app/(app)/w/[workspaceId]/research/actions";
import { HighlightCard, type HighlightView } from "./highlight-card";
import { HighlightSheet } from "./highlight-sheet";
import { TagPicker, type TagLite } from "./tag-picker";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

/** The feed, with selection so a whole call's worth of passages can be tagged at once. */
export function HighlightList({
  workspaceId,
  highlights,
  allTags,
  canEdit,
}: {
  workspaceId: string;
  highlights: HighlightView[];
  allTags: TagLite[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const ids = highlights.map((h) => h.id);
  const open = highlights.find((h) => h.id === openId);
  const allChosen = ids.length > 0 && selected.length === ids.length;

  function toggle(id: string, on: boolean) {
    setSelected((v) => (on ? [...v, id] : v.filter((x) => x !== id)));
  }

  function clear() {
    setSelected([]);
    setTagIds([]);
    setTagOpen(false);
  }

  function applyTags() {
    const ids = selected;
    start(async () => {
      const r = await addTagsToHighlightsAction(workspaceId, ids, tagIds);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.notice ?? "Tagged.");
      clear();
    });
  }

  function removeSelected() {
    const ids = selected;
    start(async () => {
      const r = await deleteHighlightsAction(workspaceId, ids);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setConfirm(false);
      toast.success(r.notice ?? "Removed.");
      clear();
    });
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {highlights.map((h) => (
          <HighlightCard
            key={h.id}
            workspaceId={workspaceId}
            highlight={h}
            allTags={allTags}
            canEdit={canEdit}
            selected={selected.includes(h.id)}
            onSelect={(on) => toggle(h.id, on)}
            onOpen={() => setOpenId(h.id)}
          />
        ))}
      </ul>

      {selected.length > 0 ? (
        <div
          role="region"
          aria-label="Selected highlights"
          aria-live="polite"
          className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-card"
        >
          <span className="text-sm font-medium">
            {selected.length} selected
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(allChosen ? [] : ids)}
          >
            {allChosen ? "Clear selection" : "Select all on this page"}
          </Button>
          <span className="flex-1" />
          <Popover open={tagOpen} onOpenChange={setTagOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                Tag…
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <TagPicker
                legend="Add these tags"
                tags={allTags}
                selected={tagIds}
                onChange={setTagIds}
                disabled={pending}
                onCreate={(name) =>
                  createTagInlineAction(workspaceId, name).then((r) => ({
                    error: r.error,
                    tag: r.tag,
                  }))
                }
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTagOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || tagIds.length === 0}
                  onClick={applyTags}
                >
                  {pending ? "Tagging…" : `Tag ${selected.length}`}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-tint-coral hover:text-destructive"
            onClick={() => setConfirm(true)}
          >
            Remove…
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            Done
          </Button>
        </div>
      ) : null}

      <HighlightSheet
        workspaceId={workspaceId}
        highlight={open}
        allTags={allTags}
        canEdit={canEdit}
        open={openId !== null}
        onOpenChange={(v) => {
          if (!v) setOpenId(null);
        }}
      />

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selected.length} highlight
              {selected.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The conversations are not changed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                removeSelected();
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
