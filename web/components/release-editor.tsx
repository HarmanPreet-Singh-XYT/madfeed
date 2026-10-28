"use client";

import Link from "next/link";
import {
  useActionState,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  publishNoteAction,
  saveNoteAction,
  unpublishNoteAction,
} from "@/app/(app)/w/[workspaceId]/releases/actions";
import type { components } from "@/lib/api/schema.gen";
import { browserTimeZone } from "@/lib/time";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { btn, btnPrimary, field, link } from "./ui";

type Note = components["schemas"]["ReleaseNote"];

const STATE: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  unpublished: "Taken down",
};

export function ReleaseEditor({
  workspaceId,
  note,
  requests,
  publicPath,
  canEdit,
}: {
  workspaceId: string;
  note: Note;
  requests: { id: string; title: string }[];
  publicPath?: string; // /r/{slug}/{id} when the workspace has a public address
  canEdit: boolean;
}) {
  const [saveState, save] = useActionState(
    saveNoteAction.bind(null, workspaceId, note.id),
    undefined,
  );
  const [when, setWhen] = useState("");
  const [message, setMessage] = useState<{ error?: string; notice?: string }>();
  const [pending, start] = useTransition();
  const linked = new Set(note.requests.map((r) => r.id));
  const live = note.liveNow;

  // Times are shown and entered in the viewer's own time zone, which only the
  // browser knows (the server renders the fallback, then the browser takes over).
  const noSubscribe = () => () => {};
  const zone = useSyncExternalStore(noSubscribe, browserTimeZone, () => "UTC");
  const scheduledText = useSyncExternalStore(
    noSubscribe,
    () =>
      note.scheduledFor
        ? new Date(note.scheduledFor).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          })
        : "",
    () => "",
  );

  function run(fn: () => Promise<{ error?: string; notice?: string }>) {
    setMessage(undefined);
    start(async () => setMessage(await fn()));
  }

  const statusRow = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-xl border border-border px-2 py-0.5 text-sm font-medium">
        {STATE[note.state] ?? note.state}
      </span>
      {note.state === "scheduled" && scheduledText ? (
        <span className="text-sm text-muted-foreground">
          goes live {scheduledText}
        </span>
      ) : null}
      {live && publicPath ? (
        <Link href={publicPath} className={link}>
          View the public page
        </Link>
      ) : null}
    </div>
  );

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form id="note-form" action={save} className="space-y-4">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            defaultValue={note.title}
            required
            maxLength={200}
            disabled={!canEdit}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="body" className="mb-1 block text-sm font-medium">
            What changed
          </label>
          <textarea
            id="body"
            name="body"
            defaultValue={note.body}
            rows={14}
            maxLength={20000}
            disabled={!canEdit}
            className={`${field} min-h-64`}
            aria-describedby="body-help"
          />
          <p id="body-help" className="mt-1 text-xs text-muted-foreground">
            Plain text. A blank line starts a new paragraph. Don&apos;t include
            customer names; this page is public once published.
          </p>
        </div>
        <FormError message={saveState?.error} />
        {canEdit ? (
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        ) : null}
      </form>

      <aside className="space-y-4">
        {statusRow}
        {requests.length > 0 ? (
          <fieldset className="space-y-2 rounded-2xl bg-card shadow-card p-4">
            <legend className="px-1 text-sm font-medium">
              Requests this closes
            </legend>
            <p className="text-xs text-muted-foreground">
              Only your team sees these links. They also let the messages to the
              people who asked mention this note.
            </p>
            <ul className="max-h-60 space-y-0.5 overflow-y-auto">
              {requests.map((r) => (
                <li key={r.id}>
                  <label className="flex min-h-8 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="requestIds"
                      form="note-form"
                      value={r.id}
                      defaultChecked={linked.has(r.id)}
                      disabled={!canEdit}
                      className="size-4"
                    />
                    {r.title}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
        {canEdit ? (
          <section
            aria-labelledby="publish-h"
            className="space-y-3 rounded-2xl bg-card shadow-card p-4"
          >
            <h2 id="publish-h">Publishing</h2>
            {!publicPath ? (
              <p className="text-sm text-muted-foreground">
                This workspace has no public address yet, so a published note
                can&apos;t be seen publicly. Set one in Settings.
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <button
                type="button"
                className={btnPrimary}
                disabled={pending || note.state === "published"}
                onClick={() =>
                  run(() => publishNoteAction(workspaceId, note.id, {}))
                }
              >
                Publish now
              </button>
              {live || note.state === "scheduled" ? (
                <button
                  type="button"
                  className={btn}
                  disabled={pending}
                  onClick={() =>
                    run(() => unpublishNoteAction(workspaceId, note.id))
                  }
                >
                  Take it down
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="when"
                  className="mb-1 block text-sm font-medium"
                >
                  Or publish at
                </label>
                <input
                  id="when"
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className={field}
                  aria-describedby="zone-help"
                />
                <p
                  id="zone-help"
                  className="mt-1 text-xs text-muted-foreground"
                >
                  Your time zone: {zone}
                </p>
              </div>
              <button
                type="button"
                className={btn}
                disabled={pending || !when}
                onClick={() =>
                  run(() =>
                    publishNoteAction(workspaceId, note.id, {
                      local: when,
                      timeZone: zone,
                    }),
                  )
                }
              >
                Schedule
              </button>
            </div>
            <FormError message={message?.error} />
            {message?.notice ? (
              <p role="status" className="text-sm">
                {message.notice}
              </p>
            ) : null}
          </section>
        ) : null}
      </aside>
    </div>
  );
}
