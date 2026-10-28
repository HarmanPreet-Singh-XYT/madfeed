"use client";

import { useState, useTransition } from "react";
import { setRequestTagsAction } from "@/app/(app)/w/[workspaceId]/research/actions";
import { FormError } from "./form-message";
import { TagChip, TagPicker, type TagLite } from "./tag-picker";
import { Button } from "@/components/ui/button";

export function RequestTags({
  workspaceId,
  requestId,
  all,
  current,
  canEdit,
}: {
  workspaceId: string;
  requestId: string;
  all: TagLite[];
  current: TagLite[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState(current.map((t) => t.id));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Tags</span>
        {current.length === 0 ? (
          <span className="text-sm text-muted-foreground">None yet</span>
        ) : (
          current.map((t) => <TagChip key={t.id} tag={t} />)
        )}
        {canEdit && all.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            Edit tags
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <TagPicker
        legend="Tags on this request"
        tags={all}
        selected={selected}
        onChange={setSelected}
        disabled={pending}
      />
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(undefined);
              const r = await setRequestTagsAction(
                workspaceId,
                requestId,
                selected,
              );
              if (r.error) setError(r.error);
              else setEditing(false);
            })
          }
        >
          {pending ? "Saving…" : "Save tags"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
