"use client";

import { useRef, useState, useTransition } from "react";
import {
  assignAction,
  convertAction,
  deleteConversationAction,
  retryAction,
  stateAction,
} from "@/app/(app)/w/[workspaceId]/inbox/actions";
import { ConfirmDelete } from "./confirm-delete";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A Radix Select cannot use an empty string as a value; this stands in for "nobody picked". */
const ANY = "__any";

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
  const status = useRef<HTMLParagraphElement>(null);
  /**
   * Run one change and leave the keyboard somewhere sensible: the buttons
   * appear and disappear as the state changes, so focus would otherwise fall
   * back to the top of the page. The line that reports the new state is a live
   * region, so a screen reader hears the result either way.
   */
  const run =
    (fn: () => Promise<{ error?: string } | undefined>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r?.error) {
        setError(r.error);
        return;
      }
      setError(undefined);
      done?.();
      status.current?.focus();
    });
  return (
    <div className="space-y-4">
      <p ref={status} role="status" tabIndex={-1} className="text-sm focus:outline-none">
        {assignee
          ? mine
            ? "You have this conversation."
            : `${assigneeName || "A teammate"} has this conversation.`
          : "Nobody has this conversation yet."}
      </p>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {!assignee ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => assignAction(workspaceId, conversationId, true))
              }
            >
              Take it
            </Button>
          ) : mine || isAdmin ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  assignAction(workspaceId, conversationId, false, assignee),
                )
              }
            >
              Let it go
            </Button>
          ) : null}
          {state === "open" ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => stateAction(workspaceId, conversationId, "closed"))
              }
            >
              Close the conversation
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => stateAction(workspaceId, conversationId, "open"))
              }
            >
              Reopen it
            </Button>
          )}
        </div>
      ) : null}
      {canWrite && teammates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label
              id="hand-over-label"
              htmlFor="hand-over"
              className="mb-1 block text-sm font-medium"
            >
              Hand it to
            </Label>
            <Select
              value={to || ANY}
              onValueChange={(value) => setTo(value === ANY ? "" : value)}
            >
              <SelectTrigger
                id="hand-over"
                className="min-h-11"
                aria-labelledby="hand-over-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Choose a teammate</SelectItem>
                {teammates.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name || "A teammate (no name set)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !to}
            onClick={() =>
              run(
                () =>
                  assignAction(workspaceId, conversationId, true, assignee, to),
                () => setTo(""),
              )
            }
          >
            Hand over
          </Button>
        </div>
      ) : null}
      <FormError message={error} />
      {isAdmin ? (
        <div className="border-t border-border pt-3">
          <ConfirmDelete
            label="Delete this conversation"
            consequences="This deletes the conversation with every message, and any feedback made from its messages. This is how you honour a request to forget a customer."
            confirmLabel="Yes, delete the conversation"
            thenGo={`/w/${workspaceId}/inbox`}
            action={async () =>
              (await deleteConversationAction(workspaceId, conversationId)) ??
              {}
            }
          />
        </div>
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
        <Button
          type="button"
          variant="outline"
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
        </Button>
        <FormError message={msg} />
      </div>
    );
  if (sentOn)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Sent to the review queue.
      </p>
    );
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
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
      </Button>
      <FormError message={msg} />
    </div>
  );
}
