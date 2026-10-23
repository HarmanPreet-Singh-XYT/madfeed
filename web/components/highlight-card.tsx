"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  deleteHighlightAction,
  setHighlightTagsAction,
} from "@/app/(app)/w/[workspaceId]/research/actions";
import { FormError } from "./form-message";
import { TagChip, TagPicker, type TagLite } from "./tag-picker";
import { btn, card, link } from "./ui";

export type HighlightView = {
  id: string;
  sourceItemId: string;
  sourceTitle: string;
  spanStart: number;
  spanEnd: number;
  quote: string;
  note: string;
  tags: TagLite[];
};

export function HighlightCard({
  workspaceId,
  highlight,
  allTags,
  canEdit,
}: {
  workspaceId: string;
  highlight: HighlightView;
  allTags: TagLite[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(highlight.tags.map((t) => t.id));
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const h = highlight;

  function run(
    fn: () => ReturnType<typeof deleteHighlightAction>,
    after?: () => void,
  ) {
    setError(undefined);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else after?.();
    });
  }

  return (
    <li className={`${card} space-y-3`}>
      <blockquote className="border-l-4 border-border pl-3 leading-7">
        “{h.quote}”
      </blockquote>
      {h.note ? <p className="text-sm text-muted">Note: {h.note}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {h.tags.length === 0 ? (
          <span className="text-sm text-muted">No tags</span>
        ) : (
          h.tags.map((t) => <TagChip key={t.id} tag={t} />)
        )}
      </div>
      <p className="text-sm">
        <Link
          href={`/w/${workspaceId}/sources/${h.sourceItemId}?s=${h.spanStart}&e=${h.spanEnd}#quote`}
          className={link}
        >
          See it in the conversation
        </Link>
        {h.sourceTitle ? (
          <span className="text-muted"> · {h.sourceTitle}</span>
        ) : null}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
          >
            Edit tags
          </button>
          {!confirm ? (
            <button
              type="button"
              className={btn}
              onClick={() => setConfirm(true)}
            >
              Remove highlight
            </button>
          ) : (
            <span
              role="group"
              aria-label="Confirm removal"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm">
                Remove this highlight? The conversation is not changed.
              </span>
              <button
                type="button"
                className={btn}
                disabled={pending}
                onClick={() =>
                  run(() => deleteHighlightAction(workspaceId, h.id))
                }
              >
                Yes, remove
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => setConfirm(false)}
              >
                Keep
              </button>
            </span>
          )}
        </div>
      ) : null}
      {editing ? (
        <div className="space-y-3">
          <TagPicker
            legend="Tags"
            tags={allTags}
            selected={selected}
            onChange={setSelected}
            disabled={pending}
          />
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              run(
                () => setHighlightTagsAction(workspaceId, h.id, selected),
                () => setEditing(false),
              )
            }
          >
            {pending ? "Saving…" : "Save tags"}
          </button>
        </div>
      ) : null}
      <FormError message={error} />
    </li>
  );
}
