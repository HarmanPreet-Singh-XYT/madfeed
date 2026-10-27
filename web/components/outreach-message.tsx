"use client";

import { useActionState, useState, useTransition } from "react";
import {
  excludeAction,
  includeAction,
  retryAction,
  saveMessageAction,
} from "@/app/(app)/w/[workspaceId]/outreach/actions";
import type { components } from "@/lib/api/schema.gen";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { btn, card, field } from "./ui";
import { LocalTime } from "./local-time";

type Message = components["schemas"]["OutreachMessage"];

const STATE_LABEL: Record<string, string> = {
  drafting: "Being written…",
  draft: "Draft",
  approved: "Approved, waiting to send",
  sending: "Sending…",
  sent: "Sent",
  failed: "Could not be sent",
  excluded: "Left out",
  suppressed: "Asked not to be emailed",
};

export function OutreachMessage({
  workspaceId,
  batchId,
  batchState,
  message,
  canEdit,
}: {
  workspaceId: string;
  batchId: string;
  batchState: string;
  message: Message;
  canEdit: boolean;
}) {
  const [saveState, save] = useActionState(
    saveMessageAction.bind(null, workspaceId, batchId, message.id),
    undefined,
  );
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const editable =
    message.state === "draft" && batchState === "review" && canEdit;

  function run(fn: () => Promise<{ error?: string } | undefined>) {
    setError(undefined);
    start(async () => setError((await fn())?.error));
  }

  return (
    <li className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-medium">{message.personName}</h3>
          <p className="text-sm text-muted-foreground">{message.toEmail}</p>
        </div>
        <p className="text-sm font-medium" data-state={message.state}>
          {STATE_LABEL[message.state] ?? message.state}
          {message.sentAt ? (
            <>
              {" · "}
              <LocalTime iso={message.sentAt} time />
            </>
          ) : null}
        </p>
      </div>

      {message.quotes.length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-medium">Based on what they said</p>
          <ul className="space-y-1">
            {message.quotes.map((q) => (
              <li
                key={q.evidenceId}
                className="border-l-4 border-border pl-3 text-sm text-muted-foreground"
              >
                “{q.text}”
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message.state === "drafting" ? (
        <p className="text-sm text-muted-foreground">Writing a draft…</p>
      ) : editable ? (
        <form action={save} className="space-y-3">
          <div>
            <label
              htmlFor={`subject-${message.id}`}
              className="mb-1 block text-sm font-medium"
            >
              Subject
            </label>
            <input
              id={`subject-${message.id}`}
              name="subject"
              defaultValue={message.subject}
              maxLength={200}
              required
              className={field}
            />
          </div>
          <div>
            <label
              htmlFor={`body-${message.id}`}
              className="mb-1 block text-sm font-medium"
            >
              Message
            </label>
            <textarea
              id={`body-${message.id}`}
              name="body"
              defaultValue={message.body}
              rows={8}
              maxLength={4000}
              required
              className={field}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A link to stop getting updates like this is added to the bottom of
            every email automatically.
          </p>
          <FormError message={saveState?.error} />
          <div className="flex flex-wrap gap-3">
            <SubmitButton variant="plain" pendingLabel="Saving…">
              Save changes
            </SubmitButton>
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => excludeAction(workspaceId, batchId, message.id))
              }
            >
              Don&apos;t send to {message.personName.split(" ")[0]}
            </button>
          </div>
          {message.draftedBy === "fallback" ? (
            <p className="text-xs text-muted-foreground">
              This is a plain template. Add anything personal you like before
              approving.
            </p>
          ) : null}
        </form>
      ) : message.state !== "excluded" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{message.subject}</p>
          <p className="whitespace-pre-wrap text-sm">{message.body}</p>
        </div>
      ) : null}

      {message.state === "excluded" && batchState === "review" && canEdit ? (
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() =>
            run(() => includeAction(workspaceId, batchId, message.id))
          }
        >
          Include {message.personName.split(" ")[0]} again
        </button>
      ) : null}
      {message.state === "failed" && canEdit ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            The email provider refused this address or message. Check the
            address, then try again.
          </p>
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              run(() => retryAction(workspaceId, batchId, message.id))
            }
          >
            Try again
          </button>
        </div>
      ) : null}
      <FormError message={error} />
    </li>
  );
}
