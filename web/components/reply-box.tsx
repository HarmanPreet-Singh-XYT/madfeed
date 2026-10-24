"use client";

import { useState, useTransition } from "react";
import {
  noteAction,
  replyAction,
} from "@/app/(app)/w/[workspaceId]/inbox/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

/**
 * Writes the team's answer. It remembers which message the person had read: if something new arrives while
 * they type (a customer message, a note, or a teammate's reply) sending is held until they say they have read
 * it, so two people cannot answer the same message by accident.
 */
export function ReplyBox({
  workspaceId,
  conversationId,
  lastMessageId,
  channel,
}: {
  workspaceId: string;
  conversationId: string;
  lastMessageId: string;
  channel: "chat" | "email";
}) {
  const [seen, setSeen] = useState(lastMessageId);
  const [own, setOwn] = useState<string>(); // the message we just sent ourselves
  const [text, setText] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  // our own message is not news; anything after it is
  const changed = seen !== lastMessageId && own !== lastMessageId;
  const send = () =>
    start(async () => {
      const r = asNote
        ? await noteAction(workspaceId, conversationId, text)
        : await replyAction(
            workspaceId,
            conversationId,
            own === lastMessageId ? own : seen,
            text,
          );
      setError(r?.error);
      if (!r?.error) {
        setText("");
        // Our own message is not "news". If we had read everything before sending, we have read it all after.
        const mine = (r as { messageId?: string } | undefined)?.messageId;
        if (!changed && typeof mine === "string") setOwn(mine);
      }
    });
  return (
    <div className="space-y-3">
      {changed ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-danger px-3 py-2 text-sm"
        >
          <p>
            New messages arrived while you were looking. Read them above, then
            continue.
          </p>
          <button
            type="button"
            className={btn}
            onClick={() => {
              setSeen(lastMessageId);
              setOwn(undefined);
            }}
          >
            I have read them
          </button>
        </div>
      ) : null}
      <div>
        <label htmlFor="reply" className="mb-1 block text-sm font-medium">
          {asNote
            ? "A note for the team (the customer never sees it)"
            : channel === "email"
              ? "Your reply (sent by email)"
              : "Your reply (the visitor sees it in the chat)"}
        </label>
        <textarea
          id="reply"
          rows={4}
          maxLength={5000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={field}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={asNote}
          onChange={(e) => setAsNote(e.target.checked)}
        />
        This is a note for the team, not a reply
      </label>
      <FormError message={error} />
      <button
        type="button"
        className={btnPrimary}
        disabled={pending || !text.trim() || (changed && !asNote)}
        onClick={() => {
          if (!pending) send();
        }}
      >
        {pending ? "Sending…" : asNote ? "Add the note" : "Send the reply"}
      </button>
    </div>
  );
}
