"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { saveDigestAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const noSubscribe = () => () => {};

/** The UTC hour, said in the reader's own time; only after mount, so server and client agree. */
function useLocalHours(utcHour: number) {
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  if (!hydrated) return undefined;
  const d = new Date();
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

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
  const localHour = useLocalHours(Number(hour));
  const [list, setList] = useState(recipients.map((r) => r.email).join("\n"));
  const [agreed, setAgreed] = useState(false);
  const stopped = recipients.filter((r) => r.unsubscribed);
  return (
    <form method="post" onSubmit={keepForm(action)} className="space-y-4">
      {!emailConfigured ? (
        <p className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground">
          Email isn&apos;t set up on this server yet, so nothing will be sent.
          You can still save these settings and preview the digest.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Checkbox
          id="digest-enabled"
          name="enabled"
          checked={on}
          onCheckedChange={(checked) => setOn(checked === true)}
        />
        <Label
          id="digest-enabled-label"
          htmlFor="digest-enabled"
          className="text-sm font-medium"
        >
          Send the weekly digest
        </Label>
      </div>
      <div className="flex flex-wrap gap-4">
        <div>
          <Label
            id="digest-day-label"
            htmlFor="digest-day"
            className="mb-1 block text-sm font-medium"
          >
            Day
          </Label>
          <Select name="weekday" value={day} onValueChange={setDay}>
            <SelectTrigger id="digest-day" aria-labelledby="digest-day-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d, i) => (
                <SelectItem key={d} value={String(i)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label
            id="digest-hour-label"
            htmlFor="digest-hour"
            className="mb-1 block text-sm font-medium"
          >
            Hour (UTC)
          </Label>
          <Select name="hourUtc" value={hour} onValueChange={setHour}>
            <SelectTrigger id="digest-hour" aria-labelledby="digest-hour-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  {String(h).padStart(2, "0")}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {localHour ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {String(Number(hour)).padStart(2, "0")}:00 UTC is {localHour}{" "}
              where you are.
            </p>
          ) : null}
        </div>
      </div>
      <div>
        <Label
          id="digest-recipients-label"
          htmlFor="digest-recipients"
          className="mb-1 block text-sm font-medium"
        >
          Who gets it (one email address per line, up to 10)
        </Label>
        <Textarea
          id="digest-recipients"
          name="recipients"
          rows={4}
          value={list}
          onChange={(e) => setList(e.target.value)}
          aria-describedby="digest-help"
        />
        <p id="digest-help" className="mt-1 text-sm text-muted-foreground">
          A summary of the week: counts, what&apos;s waiting for review, your
          most valuable open requests. No customer quotes. Every email has a
          link that stops it for that person.
        </p>
        {stopped.length > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Unsubscribed, and not emailed:{" "}
            {stopped.map((r) => r.email).join(", ")}
          </p>
        ) : null}
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id="digest-confirmed"
          name="confirmed"
          checked={agreed}
          onCheckedChange={(checked) => setAgreed(checked === true)}
        />
        <Label
          id="digest-confirmed-label"
          htmlFor="digest-confirmed"
          className="text-sm leading-normal font-normal"
        >
          The people listed have agreed to receive this email (needed to turn it
          on).
        </Label>
      </div>
      <FormError message={state?.error} />
      {state?.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="save" disabled={pending}>
          Save digest settings
        </Button>
        <Button
          type="submit"
          name="intent"
          value="preview"
          variant="outline"
          disabled={pending}
          formNoValidate
        >
          Preview this week&apos;s digest
        </Button>
      </div>
      {state?.preview ? (
        <pre
          aria-label="Digest preview"
          className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-3 text-sm"
        >
          {state.preview}
        </pre>
      ) : null}
    </form>
  );
}
