"use client";

import { useActionState, useState } from "react";
import { saveDigestAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function DigestSettings({
  workspaceId,
  enabled,
  weekday,
  hourUtc,
  recipients,
  emailConfigured,
}: {
  workspaceId: string;
  enabled: boolean;
  weekday: number;
  hourUtc: number;
  recipients: { email: string; unsubscribed: boolean }[];
  emailConfigured: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveDigestAction.bind(null, workspaceId),
    undefined,
  );
  // Kept in state, not left to the form: a failed save must not wipe what was typed.
  const [on, setOn] = useState(enabled);
  const [day, setDay] = useState(String(weekday));
  const [hour, setHour] = useState(String(hourUtc));
  const [list, setList] = useState(recipients.map((r) => r.email).join("\n"));
  const [agreed, setAgreed] = useState(false);
  const stopped = recipients.filter((r) => r.unsubscribed);
  return (
    <form method="post" onSubmit={keepForm(action)} className="space-y-4">
      {!emailConfigured ? (
        <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">
          Email isn&apos;t set up on this server yet, so nothing will be sent.
          You can still save these settings and preview the digest.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <input
          id="digest-enabled"
          name="enabled"
          type="checkbox"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="size-5"
        />
        <label htmlFor="digest-enabled" className="text-sm font-medium">
          Send the weekly digest
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <div>
          <label
            htmlFor="digest-day"
            className="mb-1 block text-sm font-medium"
          >
            Day
          </label>
          <select
            id="digest-day"
            name="weekday"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className={field}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="digest-hour"
            className="mb-1 block text-sm font-medium"
          >
            Hour (UTC)
          </label>
          <select
            id="digest-hour"
            name="hourUtc"
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            className={field}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label
          htmlFor="digest-recipients"
          className="mb-1 block text-sm font-medium"
        >
          Who gets it (one email address per line, up to 10)
        </label>
        <textarea
          id="digest-recipients"
          name="recipients"
          rows={4}
          value={list}
          onChange={(e) => setList(e.target.value)}
          className={field}
          aria-describedby="digest-help"
        />
        <p id="digest-help" className="mt-1 text-sm text-muted">
          A summary of the week: counts, what&apos;s waiting for review, your
          most valuable open requests. No customer quotes. Every email has a
          link that stops it for that person.
        </p>
        {stopped.length > 0 ? (
          <p className="mt-1 text-sm text-muted">
            Unsubscribed, and not emailed:{" "}
            {stopped.map((r) => r.email).join(", ")}
          </p>
        ) : null}
      </div>
      <div className="flex items-start gap-3">
        <input
          id="digest-confirmed"
          name="confirmed"
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-5"
        />
        <label htmlFor="digest-confirmed" className="text-sm">
          The people listed have agreed to receive this email (needed to turn it
          on).
        </label>
      </div>
      <FormError message={state?.error} />
      {state?.notice ? (
        <p role="status" className="text-sm text-muted">
          {state.notice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          className={btnPrimary}
          disabled={pending}
        >
          Save digest settings
        </button>
        <button
          type="submit"
          name="intent"
          value="preview"
          className={btn}
          disabled={pending}
          formNoValidate
        >
          Preview this week&apos;s digest
        </button>
      </div>
      {state?.preview ? (
        <pre
          aria-label="Digest preview"
          className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm"
        >
          {state.preview}
        </pre>
      ) : null}
    </form>
  );
}
