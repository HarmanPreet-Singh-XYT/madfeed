"use client";

import { useState, useTransition } from "react";
import {
  deleteFindingAction,
  findQuotesAction,
  publishFindingAction,
  saveFindingAction,
  unpublishFindingAction,
  type BlockDraft,
  type FoundQuote,
} from "@/app/(app)/w/[workspaceId]/findings/actions";
import { ConfirmDelete } from "./confirm-delete";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type EditorBlock =
  | { key: string; kind: "text"; body: string }
  | {
      key: string;
      kind: "quote";
      body: string;
      id?: string; // the saved card
      quoteKind?: "evidence" | "highlight";
      quoteId?: string;
      removed: boolean;
      quote: string;
      sourceTitle: string;
    };

let counter = 0;
const nextKey = () => `n${++counter}`;

export function FindingEditor({
  workspaceId,
  docId,
  title: initialTitle,
  state,
  publicLink,
  initial,
  canWrite,
  isAdmin,
}: {
  workspaceId: string;
  docId: string;
  title: string;
  state: "draft" | "published";
  publicLink?: string;
  initial: EditorBlock[];
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [blocks, setBlocks] = useState(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false); // changes not saved yet
  const [found, setFound] = useState<FoundQuote[]>();
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();
  const published = state === "published";
  const editable = canWrite && !published;
  const removedCount = blocks.filter(
    (b) => b.kind === "quote" && b.removed,
  ).length;

  const change = (next: EditorBlock[]) => {
    setSaved(false);
    setDirty(true);
    setBlocks(next);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const toDraft = (): BlockDraft[] =>
    blocks.map((b) =>
      b.kind === "text"
        ? { kind: "text", body: b.body }
        : {
            kind: "quote",
            body: b.body,
            ...(b.id ? { id: b.id } : {}),
            ...(!b.id && b.quoteKind && b.quoteId
              ? { quoteKind: b.quoteKind, quoteId: b.quoteId }
              : {}),
          },
    );
  const run = (
    fn: () => Promise<{ error?: string } | undefined>,
    ok?: () => void,
  ) =>
    start(async () => {
      const r = await fn();
      setError(r?.error);
      if (!r?.error) ok?.();
    });

  return (
    <div className="space-y-6">
      <div>
        <Label
          id="doc-name-label"
          htmlFor="doc-name"
          className="mb-1 block text-sm font-medium"
        >
          Title
        </Label>
        <Input
          id="doc-name"
          value={title}
          maxLength={200}
          disabled={!editable}
          onChange={(e) => {
            setSaved(false);
            setDirty(true);
            setTitle(e.target.value);
          }}
        />
      </div>

      {published ? (
        <p
          role="status"
          className="rounded-xl border border-border p-3 text-sm"
        >
          This document is shared, so it cannot be edited: what the link shows
          must not change without anyone confirming it. Take it down to edit it,
          then publish it again.
        </p>
      ) : null}
      {removedCount > 0 ? (
        <p
          role="status"
          className="rounded-xl border border-border p-3 text-sm"
        >
          {removedCount} {removedCount === 1 ? "card points" : "cards point"} at
          a quote that was deleted. {removedCount === 1 ? "It is" : "They are"}{" "}
          marked below, and {removedCount === 1 ? "it" : "they"} must be removed
          before the document can be shared.
        </p>
      ) : null}

      <ol className="space-y-4" aria-label="Document contents">
        {blocks.map((b, i) => (
          <li
            key={b.key}
            className="space-y-2 rounded-xl border border-border p-3"
          >
            {b.kind === "text" ? (
              <>
                <Label
                  htmlFor={`b-${b.key}`}
                  className="block text-sm font-medium"
                >
                  Paragraph
                </Label>
                <Textarea
                  id={`b-${b.key}`}
                  rows={4}
                  value={b.body}
                  maxLength={5000}
                  disabled={!editable}
                  onChange={(e) =>
                    change(
                      blocks.map((x, j) =>
                        j === i ? { ...b, body: e.target.value } : x,
                      ),
                    )
                  }
                />
              </>
            ) : b.removed ? (
              <p className="text-sm">
                <strong>Quote removed.</strong>{" "}
                <span className="text-muted-foreground">
                  The customer quote this card pointed at was deleted.
                </span>
              </p>
            ) : (
              <>
                <blockquote className="border-l-4 border-border pl-3">
                  “{b.quote}”
                </blockquote>
                <p className="text-sm text-muted-foreground">
                  From: {b.sourceTitle || "a source"}
                </p>
                <Label
                  htmlFor={`b-${b.key}`}
                  className="block text-sm font-medium"
                >
                  Your note under this quote (optional)
                </Label>
                <Input
                  id={`b-${b.key}`}
                  value={b.body}
                  maxLength={1000}
                  disabled={!editable}
                  onChange={(e) =>
                    change(
                      blocks.map((x, j) =>
                        j === i ? { ...b, body: e.target.value } : x,
                      ),
                    )
                  }
                />
              </>
            )}
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  Move up<span className="sr-only"> block {i + 1}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={i === blocks.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Move down<span className="sr-only"> block {i + 1}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => change(blocks.filter((_, j) => j !== i))}
                >
                  Remove<span className="sr-only"> block {i + 1}</span>
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Add a paragraph or a quote.
        </p>
      ) : null}

      {editable ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={blocks.length >= 200}
              onClick={() =>
                change([...blocks, { key: nextKey(), kind: "text", body: "" }])
              }
            >
              Add a paragraph
            </Button>
          </div>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <Label
              id="quote-search-label"
              htmlFor="quote-search"
              className="block text-sm font-medium"
            >
              Add a quote: search what customers said
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="quote-search"
                value={search}
                maxLength={200}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
                placeholder="a word or two, or leave empty for the newest"
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await findQuotesAction(workspaceId, search);
                    setError(r.error);
                    setFound(r.quotes);
                  })
                }
              >
                Find quotes
              </Button>
            </div>
            {found ? (
              found.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No quotes match.
                </p>
              ) : (
                <ul
                  className="divide-y divide-border text-sm"
                  aria-label="Quotes found"
                >
                  {found.map((q) => (
                    <li
                      key={q.kind + q.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      <span>
                        “{q.text}”
                        <span className="block text-muted-foreground">
                          {q.sourceTitle}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          change([
                            ...blocks,
                            {
                              key: nextKey(),
                              kind: "quote",
                              body: "",
                              quoteKind: q.kind,
                              quoteId: q.id,
                              removed: false,
                              quote: q.text,
                              sourceTitle: q.sourceTitle,
                            },
                          ])
                        }
                      >
                        Add this quote
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => saveFindingAction(workspaceId, docId, title, toDraft()),
                () => {
                  setSaved(true);
                  setDirty(false);
                },
              )
            }
          >
            {pending ? "Saving…" : "Save the document"}
          </Button>
          {saved ? (
            <p role="status" className="text-sm text-muted-foreground">
              Saved.
            </p>
          ) : null}
        </div>
      ) : null}
      <FormError message={error} />

      {isAdmin ? (
        <div className="space-y-3 rounded-xl border border-border p-3">
          <h2 className="text-lg font-medium">Sharing</h2>
          {published ? (
            <>
              <Label
                id="share-link-label"
                htmlFor="share-link"
                className="block text-sm font-medium"
              >
                Anyone with this link can read the document
              </Label>
              <Input
                id="share-link"
                readOnly
                value={publicLink ?? ""}
                className="font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => unpublishFindingAction(workspaceId, docId))
                }
              >
                Take it down now
              </Button>
              <p className="text-sm text-muted-foreground">
                The link stops working at once, and it never works again, even
                if you publish the document again.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                A shared document shows its title, paragraphs and the customers’
                words, exactly as stored. It shows no names, no source titles
                and nothing else from your workspace. Customers’ words can still
                name people or companies, so read each quote first.
              </p>
              <Label
                id="finding-confirmed-label"
                htmlFor="finding-confirmed"
                className="flex items-start gap-2 text-sm"
              >
                <Checkbox
                  id="finding-confirmed"
                  className="mt-0.5"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                I have read every quote in this document and it is fine to
                share.
              </Label>
              <Button
                type="button"
                disabled={
                  pending ||
                  !confirmed ||
                  blocks.length === 0 ||
                  removedCount > 0 ||
                  dirty
                }
                onClick={() =>
                  run(() => publishFindingAction(workspaceId, docId, confirmed))
                }
              >
                Publish with a link
              </Button>
              {dirty ? (
                <p className="text-sm text-muted-foreground">
                  Save your changes before publishing.
                </p>
              ) : null}
            </>
          )}
          <ConfirmDelete
            label="Delete this document"
            consequences="This deletes the document and ends its link. The quotes themselves are not deleted."
            confirmLabel="Yes, delete the document"
            thenGo={`/w/${workspaceId}/findings`}
            action={async () =>
              (await deleteFindingAction(workspaceId, docId)) ?? {}
            }
          />
        </div>
      ) : null}
    </div>
  );
}
