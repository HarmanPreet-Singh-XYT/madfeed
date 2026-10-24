"use client";

import { useState, useTransition } from "react";
import {
  deleteCannedAction,
  saveCannedAction,
  setMyNameAction,
  setReplyTargetAction,
} from "@/app/(app)/w/[workspaceId]/inbox/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary, card, field } from "./ui";

type Canned = { id: string; name: string; body: string };

/** Three small things for running the desk: your name, saved replies, and how fast you mean to answer. */
export function DeskSetup({
  workspaceId,
  myName,
  canned,
  targetHours,
  canWrite,
  isAdmin,
}: {
  workspaceId: string;
  myName: string;
  canned: Canned[];
  targetHours: number;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-6">
      {canWrite ? (
        <NameForm workspaceId={workspaceId} initial={myName} />
      ) : null}
      <section className={`${card} space-y-3`} aria-labelledby="saved">
        <h2 id="saved" className="text-lg font-medium">
          Saved replies
        </h2>
        <p className="text-sm text-muted">
          Short answers you give often. In a conversation, pick one to put it in
          the reply box; you can still change it before sending.
        </p>
        {canned.length === 0 ? (
          <p className="text-muted">None saved yet.</p>
        ) : (
          <ul className="space-y-3">
            {canned.map((c) => (
              <CannedRow
                key={c.id}
                workspaceId={workspaceId}
                canned={c}
                canWrite={canWrite}
              />
            ))}
          </ul>
        )}
        {canWrite && canned.length < 100 ? (
          <CannedForm workspaceId={workspaceId} />
        ) : null}
      </section>
      {isAdmin ? (
        <TargetForm workspaceId={workspaceId} initial={targetHours} />
      ) : null}
    </div>
  );
}

function NameForm({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: string;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      method="post"
      className={`${card} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setMyNameAction(workspaceId, name);
          setError(r?.error);
          setSaved(!r?.error);
        });
      }}
    >
      <h2 className="text-lg font-medium">Your name</h2>
      <div>
        <label htmlFor="my-name" className="mb-1 block text-sm font-medium">
          The name your teammates see when they hand you a conversation
        </label>
        <input
          id="my-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </div>
      <FormError message={error} />
      {saved ? <p role="status">Saved.</p> : null}
      <button type="submit" className={btn} disabled={pending}>
        {pending ? "Saving…" : "Save my name"}
      </button>
    </form>
  );
}

function CannedForm({
  workspaceId,
  initial,
  onDone,
}: {
  workspaceId: string;
  initial?: Canned;
  onDone?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const id = initial?.id ?? "new";
  return (
    <form
      method="post"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveCannedAction(
            workspaceId,
            initial?.id,
            name,
            body,
          );
          setError(r?.error);
          if (!r?.error) {
            if (!initial) {
              setName("");
              setBody("");
            }
            onDone?.();
          }
        });
      }}
    >
      <div>
        <label htmlFor={`cn-${id}`} className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input
          id={`cn-${id}`}
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </div>
      <div>
        <label htmlFor={`cb-${id}`} className="mb-1 block text-sm font-medium">
          The reply
        </label>
        <textarea
          id={`cb-${id}`}
          rows={3}
          value={body}
          maxLength={5000}
          required
          onChange={(e) => setBody(e.target.value)}
          className={field}
        />
      </div>
      <FormError message={error} />
      <button type="submit" className={btnPrimary} disabled={pending}>
        {pending ? "Saving…" : initial ? "Save changes" : "Add a saved reply"}
      </button>
    </form>
  );
}

function CannedRow({
  workspaceId,
  canned,
  canWrite,
}: {
  workspaceId: string;
  canned: Canned;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (editing)
    return (
      <li className="rounded-md border border-border p-3">
        <CannedForm
          workspaceId={workspaceId}
          initial={canned}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  return (
    <li className="space-y-1 rounded-md border border-border p-3">
      <p className="font-medium">{canned.name}</p>
      <p className="whitespace-pre-wrap text-sm">{canned.body}</p>
      {canWrite ? (
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            className={btn}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () =>
                setError(
                  (await deleteCannedAction(workspaceId, canned.id))?.error,
                ),
              )
            }
          >
            Remove
          </button>
        </div>
      ) : null}
      <FormError message={error} />
    </li>
  );
}

function TargetForm({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: number;
}) {
  const [hours, setHours] = useState(String(initial));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      method="post"
      className={`${card} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setReplyTargetAction(workspaceId, Number(hours));
          setError(r?.error);
          setSaved(!r?.error);
        });
      }}
    >
      <h2 className="text-lg font-medium">How fast you mean to answer</h2>
      <div>
        <label htmlFor="target" className="mb-1 block text-sm font-medium">
          Longest a customer should wait for a first answer, in hours (0 for no
          target)
        </label>
        <input
          id="target"
          type="number"
          inputMode="numeric"
          min={0}
          max={720}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className={field}
        />
      </div>
      <FormError message={error} />
      {saved ? <p role="status">Saved.</p> : null}
      <button type="submit" className={btn} disabled={pending}>
        {pending ? "Saving…" : "Save the target"}
      </button>
    </form>
  );
}
