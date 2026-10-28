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
import { btn, field } from "./ui";
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
    <li className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-link"
          >
            {message.personName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h3>{message.personName}</h3>
            <p className="text-[13px] text-muted-foreground">
              {message.toEmail}
            </p>
          </div>
        </div>
        <p
          className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium"
          data-state={message.state}
        >
          {STATE_LABEL[message.state] ?? message.state}
          {message.sentAt ? (
            <>
              {" · "}
              <LocalTime iso={message.sentAt} time />
            </>
          ) : null}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {message.quotes.length > 0 ? (
          <div className="space-y-1.5 self-start rounded-md bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Based on what they said
            </p>
            <ul className="space-y-2">
              {message.quotes.map((q) => (
                <li key={q.evidenceId} className="text-[13px] text-foreground">
                  “{q.text}”
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="hidden lg:block" />
        )}

        {message.state === "drafting" ? (
          <p className="text-[13px] text-muted-foreground">Writing a draft…</p>
        ) : editable ? (
          <form action={save} className="min-w-0 space-y-3">
            <div>
              <label
                htmlFor={`subject-${message.id}`}
                className="mb-1 block text-[13px] font-medium"
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
                className="mb-1 block text-[13px] font-medium"
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
      </div>

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
