"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { setRequestTagsAction } from "@/app/(app)/w/[workspaceId]/research/actions";
import { TagChip, TagPicker, type TagLite } from "@/components/tag-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** How many chips fit in a table cell before the rest fold into "+n". */
const SHOWN = 2;

/**
 * The tags on a request, editable where you see them. Each tick in the list saves straight away (a request can carry
 * up to ten); if the save is refused the ticks go back and the reason is shown. People who can't edit see the chips.
 */
export function InlineTags({
  workspaceId,
  requestId,
  requestTitle,
  current,
  all,
  canEdit,
}: {
  workspaceId: string;
  requestId: string;
  requestTitle: string;
  current: TagLite[];
  all: TagLite[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState(current.map((t) => t.id));
  // Follow the server when the tags change somewhere else, without remounting the open list.
  const [seen, setSeen] = useState(current.map((t) => t.id).join());
  const now = current.map((t) => t.id).join();
  if (seen !== now) {
    setSeen(now);
    setSelected(current.map((t) => t.id));
  }
  const [, start] = useTransition();

  const byId = new Map([...all, ...current].map((t) => [t.id, t]));
  const shown = selected
    .map((id) => byId.get(id))
    .filter((t): t is TagLite => Boolean(t));

  function change(next: string[]) {
    const before = selected;
    setSelected(next);
    start(async () => {
      const r = await setRequestTagsAction(workspaceId, requestId, next);
      if (r.error) {
        setSelected(before);
        toast.error(r.error);
      }
    });
  }

  // The name starts with the words on the button, so what is read out matches what is seen.
  const seenText =
    shown.length === 0
      ? "Add tag"
      : shown
          .slice(0, SHOWN)
          .map((t) => t.name)
          .join(" ") +
        (shown.length > SHOWN ? ` +${shown.length - SHOWN}` : "");
  const chips = (
    <span className="flex flex-wrap items-center gap-1">
      {shown.slice(0, SHOWN).map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {shown.length > SHOWN ? (
        <span className="text-xs text-muted-foreground">
          +{shown.length - SHOWN}
        </span>
      ) : null}
    </span>
  );

  if (!canEdit) {
    return shown.length === 0 ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      chips
    );
  }
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${seenText}. Change tags of ${requestTitle}`}
        className="group inline-flex min-h-7 items-center gap-1 rounded-md px-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {shown.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Plus aria-hidden="true" className="size-3" />
            Add tag
          </span>
        ) : (
          chips
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        {all.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no tags yet. Add some under Research, Manage tags.
          </p>
        ) : (
          <TagPicker
            legend="Tags on this request"
            tags={all}
            selected={selected}
            onChange={change}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
