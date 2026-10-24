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
}: {
  workspaceId: string;
  conversationId: string;
  state: "open" | "closed";
  assignee?: string;
  mine: boolean;
  isAdmin: boolean;
  canWrite: boolean;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => setError((await fn())?.error));
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {assignee
          ? mine
            ? "You have this conversation."
            : "A teammate has this conversation."
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
    return <p className="text-sm text-muted">Sent to the review queue.</p>;
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
