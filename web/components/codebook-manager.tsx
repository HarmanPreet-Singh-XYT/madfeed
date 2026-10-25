"use client";

import { useActionState, useState, useTransition } from "react";
import {
  archiveTagAction,
  createTagAction,
  mergeTagAction,
  undoMergeAction,
  updateTagAction,
  type Result,
} from "@/app/(app)/w/[workspaceId]/research/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { TagChip } from "./tag-picker";
import { btn, card, field } from "./ui";

export type CodebookTag = {
  id: string;
  name: string;
  definition: string;
  color: string;
  archived: boolean;
  mergedInto?: string;
  undoMergeId?: string;
  highlightCount: number;
  requestCount: number;
};

const COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
];

function ColorSelect({ id, value }: { id: string; value: string }) {
  return (
    <select id={id} name="color" defaultValue={value} className={field}>
      {COLORS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

export function CodebookManager({
  workspaceId,
  tags,
  isAdmin,
  canEdit,
}: {
  workspaceId: string;
  tags: CodebookTag[];
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const [created, createAction] = useActionState(
    createTagAction.bind(null, workspaceId),
    undefined as Result | undefined,
  );
  const live = tags.filter((t) => !t.archived);
  const archived = tags.filter((t) => t.archived);
  // Rows move between lists after a merge or undo, which unmounts them, so
  // their confirmations live here where they survive the move.
  const [notice, setNotice] = useState<string>();
  return (
    <div className="space-y-8">
      <div role="status" aria-live="polite">
        {notice ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
            {notice}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <form action={createAction} className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Add a tag</h2>
          <div className="grid gap-3 sm:grid-cols-[2fr_3fr_1fr]">
            <div>
              <label
                htmlFor="new-name"
                className="mb-1 block text-sm font-medium"
              >
                Name
              </label>
              <input
                id="new-name"
                name="name"
                required
                maxLength={60}
                className={field}
              />
            </div>
            <div>
              <label
                htmlFor="new-def"
                className="mb-1 block text-sm font-medium"
              >
                What it means
              </label>
              <input
                id="new-def"
                name="definition"
                maxLength={500}
                className={field}
              />
            </div>
            <div>
              <label
                htmlFor="new-color"
                className="mb-1 block text-sm font-medium"
              >
                Colour
              </label>
              <ColorSelect id="new-color" value="gray" />
            </div>
          </div>
          <SubmitButton pendingLabel="Adding…">Add tag</SubmitButton>
          <FormError message={created?.error} />
          {created?.notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {created.notice}
            </p>
          ) : null}
        </form>
      ) : null}

      {live.length === 0 ? (
        <div className={card}>
          <p className="font-medium">No tags yet.</p>
          <p className="mt-1 text-muted-foreground">
            Tags give your highlights and requests a shared vocabulary. Add the
            first one above, with a line on what it means so everyone uses it
            the same way.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {live.map((t) => (
            <TagRow
              key={t.id}
              workspaceId={workspaceId}
              tag={t}
              others={live.filter((o) => o.id !== t.id)}
              isAdmin={isAdmin}
              canEdit={canEdit}
              onNotice={setNotice}
            />
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <section className="space-y-3" aria-label="Archived tags">
          <h2 className="text-lg font-medium">Archived and merged tags</h2>
          <ul className="space-y-2">
            {archived.map((t) => (
              <ArchivedRow
                key={t.id}
                workspaceId={workspaceId}
                tag={t}
                intoName={tags.find((o) => o.id === t.mergedInto)?.name}
                isAdmin={isAdmin}
                onNotice={setNotice}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TagRow({
  workspaceId,
  tag,
  others,
  isAdmin,
  canEdit,
  onNotice,
}: {
  workspaceId: string;
  tag: CodebookTag;
  others: CodebookTag[];
  isAdmin: boolean;
  canEdit: boolean;
  onNotice: (n: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [into, setInto] = useState(others[0]?.id ?? "");
  const [state, action] = useActionState(
    updateTagAction.bind(null, workspaceId, tag.id),
    undefined as Result | undefined,
  );
  const [message, setMessage] = useState<Result>();
  const [pending, start] = useTransition();
  const target = others.find((o) => o.id === into);

  function run(fn: () => Promise<Result>, after?: () => void) {
    setMessage(undefined);
    onNotice(undefined);
    start(async () => {
      const r = await fn();
      setMessage(r.error ? r : undefined);
      onNotice(r.notice);
      if (!r.error) after?.();
    });
  }

  return (
    <li className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <TagChip tag={tag} />
          <p className="text-sm text-muted-foreground">
            {tag.definition || "No definition yet."}
          </p>
          <p className="text-sm text-muted-foreground">
            Used on {tag.highlightCount}{" "}
            {tag.highlightCount === 1 ? "highlight" : "highlights"} and{" "}
            {tag.requestCount} {tag.requestCount === 1 ? "request" : "requests"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              className={btn}
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
            >
              {editing ? "Close" : `Edit ${tag.name}`}
            </button>
          ) : null}
          {isAdmin && others.length > 0 ? (
            <button
              type="button"
              className={btn}
              onClick={() => setMerging((v) => !v)}
              aria-expanded={merging}
            >
              Merge {tag.name}
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => archiveTagAction(workspaceId, tag.id, false))
              }
            >
              Archive {tag.name}
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <form
          action={action}
          className="grid gap-3 sm:grid-cols-[2fr_3fr_1fr_auto] sm:items-end"
        >
          <div>
            <label
              htmlFor={`n-${tag.id}`}
              className="mb-1 block text-sm font-medium"
            >
              Name
            </label>
            <input
              id={`n-${tag.id}`}
              name="name"
              defaultValue={tag.name}
              required
              maxLength={60}
              className={field}
            />
          </div>
          <div>
            <label
              htmlFor={`d-${tag.id}`}
              className="mb-1 block text-sm font-medium"
            >
              What it means
            </label>
            <input
              id={`d-${tag.id}`}
              name="definition"
              defaultValue={tag.definition}
              maxLength={500}
              className={field}
            />
          </div>
          <div>
            <label
              htmlFor={`c-${tag.id}`}
              className="mb-1 block text-sm font-medium"
            >
              Colour
            </label>
            <ColorSelect id={`c-${tag.id}`} value={tag.color} />
          </div>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </form>
      ) : null}
      <FormError message={state?.error} />
      {state?.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      ) : null}

      {merging ? (
        <div
          role="group"
          aria-label={`Merge ${tag.name}`}
          className="space-y-3 rounded-md border border-border bg-background p-4"
        >
          <div>
            <label
              htmlFor={`m-${tag.id}`}
              className="mb-1 block text-sm font-medium"
            >
              Merge into
            </label>
            <select
              id={`m-${tag.id}`}
              value={into}
              onChange={(e) => setInto(e.target.value)}
              className={field}
            >
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted-foreground">
            {tag.highlightCount}{" "}
            {tag.highlightCount === 1 ? "highlight" : "highlights"} and{" "}
            {tag.requestCount} {tag.requestCount === 1 ? "request" : "requests"}{" "}
            tagged “{tag.name}” will be tagged “{target?.name}” instead, and “
            {tag.name}” will be archived. You can undo this afterwards.
          </p>
          <button
            type="button"
            className={btn}
            disabled={pending || !target}
            onClick={() =>
              run(
                () => mergeTagAction(workspaceId, tag.id, into),
                () => setMerging(false),
              )
            }
          >
            {pending ? "Merging…" : `Merge into ${target?.name ?? ""}`}
          </button>
        </div>
      ) : null}
      <FormError message={message?.error} />
    </li>
  );
}

function ArchivedRow({
  workspaceId,
  tag,
  intoName,
  isAdmin,
  onNotice,
}: {
  workspaceId: string;
  tag: CodebookTag;
  intoName?: string;
  isAdmin: boolean;
  onNotice: (n: string | undefined) => void;
}) {
  const [message, setMessage] = useState<Result>();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result>) {
    setMessage(undefined);
    onNotice(undefined);
    start(async () => {
      const r = await fn();
      setMessage(r.error ? r : undefined);
      onNotice(r.notice);
    });
  }
  return (
    <li className={`${card} flex flex-wrap items-center justify-between gap-3`}>
      <div className="space-y-1">
        <TagChip tag={tag} />
        <p className="text-sm text-muted-foreground">
          {intoName ? `Merged into “${intoName}”.` : "Archived."}
        </p>
        <FormError message={message?.error} />
      </div>
      {isAdmin ? (
        <div className="flex gap-2">
          {tag.undoMergeId ? (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => undoMergeAction(workspaceId, tag.undoMergeId!))
              }
            >
              Undo the merge of {tag.name}
            </button>
          ) : (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => archiveTagAction(workspaceId, tag.id, true))
              }
            >
              Restore {tag.name}
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}
