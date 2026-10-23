"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  acceptSuggestionAction,
  dismissSuggestionAction,
  requestSuggestionsAction,
} from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { FormError } from "./form-message";
import { TagChip, TagPicker, type TagLite } from "./tag-picker";
import { btn, btnPrimary, card } from "./ui";

export type Suggestion = {
  id: string;
  quote: string;
  confidence: number;
  tags: TagLite[];
};

const WAIT_MS = 60_000;

/**
 * The assistant reads the conversation and proposes passages that fit your
 * tags. Nothing is highlighted until a person accepts it.
 */
export function HighlightSuggestions({
  workspaceId,
  sourceItemId,
  suggestions,
  allTags,
}: {
  workspaceId: string;
  sourceItemId: string;
  suggestions: Suggestion[];
  allTags: TagLite[];
}) {
  const router = useRouter();
  const [waitingSince, setWaitingSince] = useState<number>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, start] = useTransition();
  const waiting = waitingSince !== undefined && suggestions.length === 0;

  useEffect(() => {
    if (waitingSince === undefined || suggestions.length > 0) return;
    const id = setInterval(() => {
      if (Date.now() - waitingSince > WAIT_MS) {
        setWaitingSince(undefined);
        return;
      }
      router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [waitingSince, suggestions.length, router]);

  function ask() {
    setError(undefined);
    setNotice(undefined);
    start(async () => {
      const r = await requestSuggestionsAction(workspaceId, sourceItemId);
      if (r.error) setError(r.error);
      else setWaitingSince(Date.now());
    });
  }

  return (
    <section aria-label="Suggested highlights" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">Suggested highlights</h2>
        <button
          type="button"
          className={btn}
          disabled={pending || waiting}
          onClick={ask}
        >
          {waiting ? "Looking…" : "Suggest highlights using my tags"}
        </button>
      </div>
      <div role="status" aria-live="polite" className="text-sm text-muted">
        {waiting
          ? "Reading the conversation for passages that fit your tags…"
          : null}
        {!waiting && waitingSince === undefined && notice ? notice : null}
      </div>
      <FormError message={error} />
      {suggestions.length > 0 ? (
        <ul className="space-y-3">
          {suggestions.map((s) => (
            <Row
              key={s.id}
              workspaceId={workspaceId}
              sourceItemId={sourceItemId}
              s={s}
              allTags={allTags}
              onNotice={setNotice}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Row({
  workspaceId,
  sourceItemId,
  s,
  allTags,
  onNotice,
}: {
  workspaceId: string;
  sourceItemId: string;
  s: Suggestion;
  allTags: TagLite[];
  onNotice: (n: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState(s.tags.map((t) => t.id));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function accept() {
    setError(undefined);
    start(async () => {
      const r = await acceptSuggestionAction(
        workspaceId,
        sourceItemId,
        s.id,
        editing ? chosen : undefined,
      );
      if (r.error) setError(r.error);
      else onNotice("Highlighted.");
    });
  }
  function dismiss() {
    setError(undefined);
    start(async () => {
      const r = await dismissSuggestionAction(workspaceId, sourceItemId, s.id);
      if (r.error) setError(r.error);
      else onNotice("Dismissed.");
    });
  }
  return (
    <li className={`${card} space-y-3`}>
      <blockquote className="border-l-4 border-border pl-3 leading-7">
        “{s.quote}”
      </blockquote>
      <div className="flex flex-wrap items-center gap-2">
        {s.tags.map((t) => (
          <TagChip key={t.id} tag={t} />
        ))}
      </div>
      {editing ? (
        <TagPicker
          legend="Tags for this highlight"
          tags={allTags}
          selected={chosen}
          onChange={setChosen}
          disabled={pending}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={accept}
        >
          {pending ? "Saving…" : "Accept"}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
        >
          {editing ? "Use the suggested tags" : "Change tags"}
        </button>
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={dismiss}
        >
          Dismiss
        </button>
      </div>
      <FormError message={error} />
    </li>
  );
}
