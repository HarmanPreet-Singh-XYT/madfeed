"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createHighlightAction } from "@/app/(app)/w/[workspaceId]/research/actions";
import { clock } from "@/lib/format";
import { byteOffsetOf, pieces, type Piece } from "@/lib/text";
import { FormError } from "./form-message";
import { TagPicker, type TagLite } from "./tag-picker";
import { btn, btnPrimary, field } from "./ui";

type Mark = { id: string; start: number; end: number };

const FOCUS = "__focus";

type Selected = { start: number; end: number; text: string };

export type TranscriptSegment = {
  ordinal: number;
  startMs: number;
  endMs: number;
  speaker: string;
  spanStart: number;
  spanEnd: number;
};

const SEG = "seg:";

/**
 * The original conversation, with highlights shown as marks. Select some
 * words (mouse, touch, or keyboard with Shift+arrows) and a panel appears to
 * save them. The saved text is checked against the source on the server, so a
 * highlight can never differ from what the customer wrote.
 */
export function HighlightableText({
  workspaceId,
  sourceItemId,
  text,
  marks,
  tags,
  canEdit,
  focus,
  recording,
  startAtMs,
}: {
  workspaceId: string;
  sourceItemId: string;
  text: string;
  marks: Mark[];
  /** A quote to scroll to (from "See it in the conversation"), in bytes. */
  focus?: { start: number; end: number };
  tags: TagLite[];
  canEdit: boolean;
  /** For a recording's transcript: the file to play and where each line sits in it. */
  recording?: { mediaId: string; segments: TranscriptSegment[] };
  /** Where to start playing (milliseconds), e.g. from a highlight's "Play from here". */
  startAtMs?: number;
}) {
  const root = useRef<HTMLElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState(-1);
  const [sel, setSel] = useState<Selected | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!canEdit) return;
    function read() {
      const s = window.getSelection();
      const el = root.current;
      if (!s || !el || s.isCollapsed || s.rangeCount === 0) return;
      const r = s.getRangeAt(0);
      if (!el.contains(r.startContainer) || !el.contains(r.endContainer))
        return;
      const at = (node: Node, offset: number): number | null => {
        const piece =
          node.nodeType === Node.TEXT_NODE
            ? (node.parentElement?.closest<HTMLElement>("[data-start]") ?? null)
            : ((node as Element).closest?.<HTMLElement>("[data-start]") ??
              null);
        if (!piece || !el.contains(piece)) return null;
        return (
          Number(piece.dataset.start) +
          (node.nodeType === Node.TEXT_NODE ? offset : 0)
        );
      };
      let a = at(r.startContainer, r.startOffset);
      let b = at(r.endContainer, r.endOffset);
      if (a === null || b === null) return;
      // Trim stray whitespace at the edges so the highlight starts and ends on words.
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b <= a || b - a > 2000) {
        setSel(null);
        return;
      }
      setSel({ start: a, end: b, text: text.slice(a, b) });
      setDone(undefined);
      setError(undefined);
    }
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, [canEdit, text]);

  // Start where asked. The recording may already have loaded before this page
  // became interactive, so check for that as well as waiting for it.
  const hasAudio = recording !== undefined;
  useEffect(() => {
    const a = audio.current;
    if (!a || startAtMs === undefined) return;
    const go = () => {
      a.currentTime = startAtMs / 1000;
    };
    if (a.readyState >= 1) go();
    else a.addEventListener("loadedmetadata", go, { once: true });
    return () => a.removeEventListener("loadedmetadata", go);
  }, [hasAudio, startAtMs]);

  const segMarks = (recording?.segments ?? []).map((g) => ({
    id: SEG + g.ordinal,
    start: g.spanStart,
    end: g.spanEnd,
  }));
  const parts = pieces(text, [
    ...marks,
    ...segMarks,
    ...(focus ? [{ id: FOCUS, ...focus }] : []),
  ]);
  const firstFocus = parts.find((p) => p.ids.includes(FOCUS))?.start;

  function seek(ms: number) {
    const a = audio.current;
    if (!a) return;
    a.currentTime = ms / 1000;
    void a.play().catch(() => undefined); // a browser may ask for a click first; the player's own button then works
  }

  function follow() {
    const a = audio.current;
    if (!a || !recording) return;
    const ms = a.currentTime * 1000;
    let now = -1;
    for (const g of recording.segments) if (g.startMs <= ms) now = g.ordinal;
    setActive((prev) => (prev === now ? prev : now));
  }

  function piece(p: Piece) {
    const real = p.ids.filter((i) => !i.startsWith(SEG));
    return real.length > 0 ? (
      <mark
        key={p.start}
        id={p.start === firstFocus ? "quote" : undefined}
        data-start={p.start}
        data-highlighted={real.some((i) => i !== FOCUS) ? "true" : undefined}
      >
        {p.text}
      </mark>
    ) : (
      <span key={p.start} data-start={p.start}>
        {p.text}
      </span>
    );
  }

  function save() {
    if (!sel) return;
    start(async () => {
      const res = await createHighlightAction(
        workspaceId,
        sourceItemId,
        byteOffsetOf(text, sel.start),
        byteOffsetOf(text, sel.end),
        sel.text,
        tagIds,
        note,
      );
      if (res.error) setError(res.error);
      else {
        setDone(res.notice);
        setSel(null);
        setNote("");
        window.getSelection()?.removeAllRanges();
      }
    });
  }

  return (
    <div className="space-y-4">
      {recording ? (
        <audio
          ref={audio}
          controls
          preload="metadata"
          aria-label="Recording"
          className="w-full"
          src={`/api/media/${workspaceId}/${recording.mediaId}/file`}
          onTimeUpdate={follow}
        />
      ) : null}
      <article
        ref={root}
        aria-label="Original text"
        className="rounded-lg border border-border p-4 leading-7 whitespace-pre-wrap"
      >
        {recording
          ? recording.segments.map((g) => (
              <div
                key={g.ordinal}
                data-segment={g.ordinal}
                aria-current={active === g.ordinal ? "true" : undefined}
                className={`flex gap-3 rounded-md px-2 py-1 ${active === g.ordinal ? "bg-surface" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => seek(g.startMs)}
                  aria-label={`Play from ${clock(g.startMs)}${g.speaker ? `, ${g.speaker}` : ""}`}
                  className="min-h-11 min-w-14 shrink-0 select-none rounded-md border border-border px-2 text-sm text-accent hover:bg-surface"
                >
                  {clock(g.startMs)}
                </button>
                <span>
                  {parts
                    .filter((p) => p.ids.includes(SEG + g.ordinal))
                    .map(piece)}
                </span>
              </div>
            ))
          : parts.map(piece)}
      </article>

      {canEdit ? (
        <div role="region" aria-label="Highlight" className="space-y-3">
          {sel ? (
            <div className="space-y-3 rounded-md border border-border bg-surface p-4">
              <p className="text-sm font-medium">Highlight this passage?</p>
              <blockquote className="border-l-4 border-border pl-3 text-sm">
                {sel.text}
              </blockquote>
              <TagPicker
                legend="Tags (optional)"
                tags={tags}
                selected={tagIds}
                onChange={setTagIds}
                disabled={pending}
              />
              <div>
                <label
                  htmlFor="hl-note"
                  className="mb-1 block text-sm font-medium"
                >
                  Note (optional)
                </label>
                <input
                  id="hl-note"
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                  className={field}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={pending}
                  onClick={save}
                >
                  {pending ? "Saving…" : "Save highlight"}
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => setSel(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Select some words above to highlight them and tag them.
            </p>
          )}
          <FormError message={error} />
          {done ? (
            <p role="status" className="text-sm text-muted">
              {done}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
