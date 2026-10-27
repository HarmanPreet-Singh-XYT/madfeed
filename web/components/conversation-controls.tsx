"use client";

import { useState, useTransition } from "react";
import {
  assignAction,
  convertAction,
  deleteConversationAction,
  retryAction,
  stateAction,
} from "@/app/(app)/w/[workspaceId]/inbox/actions";
import { ConfirmDelete } from "./confirm-delete";
import { FormError } from "./form-message";
import { btn } from "./ui";

/** Take it, let it go, close it, reopen it. */
export function ConversationControls({
  workspaceId,
  conversationId,
  state,
  assignee,
  mine,
  isAdmin,
  canWrite,
  assigneeName,
  teammates = [],
}: {
  workspaceId: string;
  conversationId: string;
  state: "open" | "closed";
  assignee?: string;
  mine: boolean;
  isAdmin: boolean;
  canWrite: boolean;
  /** What the person who has it is called; empty when they have not chosen a name. */
  assigneeName?: string;
  /** Teammates who can take a conversation (not including the current holder). */
  teammates?: { userId: string; name: string }[];
}) {
  const [error, setError] = useState<string>();
  const [to, setTo] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => setError((await fn())?.error));
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {assignee
          ? mine
            ? "You have this conversation."
            : `${assigneeName || "A teammate"} has this conversation.`
          : "Nobody has this conversation yet."}
      </p>
      {canWrite ? (
        <div className="flex flex-wrap gap-3">
          {!assignee ? (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => assignAction(workspaceId, conversationId, true))
              }
            >
              Take it
            </button>
          ) : mine || isAdmin ? (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() =>
                  assignAction(workspaceId, conversationId, false, assignee),
                )
              }
            >
              Let it go
            </button>
          ) : null}
          {state === "open" ? (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => stateAction(workspaceId, conversationId, "closed"))
              }
            >
              Close the conversation
            </button>
          ) : (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => stateAction(workspaceId, conversationId, "open"))
              }
            >
              Reopen it
            </button>
          )}
        </div>
      ) : null}
      {canWrite && teammates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="hand-over"
              className="mb-1 block text-sm font-medium"
            >
              Hand it to
            </label>
            <select
              id="hand-over"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="min-h-11 rounded-md border border-border bg-background px-3"
            >
              <option value="">Choose a teammate</option>
              {teammates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || "A teammate (no name set)"}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={btn}
            disabled={pending || !to}
            onClick={() =>
              run(() =>
                assignAction(workspaceId, conversationId, true, assignee, to),
              )
            }
          >
            Hand over
          </button>
        </div>
      ) : null}
      <FormError message={error} />
      {isAdmin ? (
        <ConfirmDelete
          label="Delete this conversation"
          consequences="This deletes the conversation with every message, and any feedback made from its messages. This is how you honour a request to forget a customer."
          confirmLabel="Yes, delete the conversation"
          thenGo={`/w/${workspaceId}/inbox`}
          action={async () =>
            (await deleteConversationAction(workspaceId, conversationId)) ?? {}
          }
        />
      ) : null}
    </div>
  );
}

/** Under a customer's message: send it on as feedback. Under a failed reply: try again. */
export function MessageActions({
  workspaceId,
  conversationId,
  messageId,
  kind,
  sentOn,
  error,
}: {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  kind: "customer" | "failed";
  sentOn: boolean;
  error?: string;
}) {
  const [msg, setMsg] = useState<string>();
  const [pending, start] = useTransition();
  if (kind === "failed")
    return (
      <div className="space-y-1 text-sm">
        <p role="status">This reply was not sent{error ? `: ${error}` : "."}</p>
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() =>
            start(async () =>
              setMsg(
                (await retryAction(workspaceId, conversationId, messageId))
                  ?.error,
              ),
            )
          }
        >
          Try again
        </button>
        <FormError message={msg} />
      </div>
    );
  if (sentOn)
    return (
      <p className="text-sm text-muted-foreground">Sent to the review queue.</p>
    );
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={btn}
        disabled={pending}
        onClick={() =>
          start(async () =>
            setMsg(
              (await convertAction(workspaceId, conversationId, messageId))
                ?.error,
            ),
          )
        }
      >
        Send to the review queue as feedback
      </button>
      <FormError message={msg} />
    </div>
  );
}
