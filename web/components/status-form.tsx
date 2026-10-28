"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setStatusAction } from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
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
import { link } from "./ui";

type Status = { id: string; name: string; bucket: string };

export function StatusForm({
  workspaceId,
  requestId,
  current,
  statuses,
  openBatchId,
}: {
  workspaceId: string;
  requestId: string;
  current: Status;
  statuses: Status[];
  openBatchId?: string;
}) {
  const [chosen, setChosen] = useState(current.id);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  // When the status changes somewhere else (an issue closing, a conflict settled), the dropdown follows it.
  // Adjusted while rendering, not by remounting, so a message already shown is kept.
  const [seen, setSeen] = useState(current.id);
  if (seen !== current.id) {
    setSeen(current.id);
    setChosen(current.id);
    setConfirming(false);
  }
  const [pending, start] = useTransition();
  const target = statuses.find((s) => s.id === chosen) ?? current;
  const willShip = target.bucket === "done" && current.bucket !== "done";

  function apply() {
    setError(undefined);
    setNotice(undefined);
    start(async () => {
      const res = await setStatusAction(workspaceId, requestId, chosen);
      setConfirming(false);
      if (res?.error) setError(res.error);
      else if (res?.notice) setNotice(res.notice);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label
            id="status-label"
            htmlFor="status"
            className="mb-1 block text-sm font-medium"
          >
            Status
          </Label>
          <Select
            value={chosen}
            onValueChange={(value) => {
              setChosen(value);
              setConfirming(false);
            }}
          >
            <SelectTrigger id="status" aria-labelledby="status-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {chosen !== current.id && !confirming ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => (willShip ? setConfirming(true) : apply())}
          >
            {pending ? "Saving…" : "Update status"}
          </Button>
        ) : null}
        {openBatchId ? (
          <Link
            href={`/w/${workspaceId}/outreach/${openBatchId}`}
            className={link}
          >
            Review the messages for the people who asked
          </Link>
        ) : null}
      </div>

      {confirming ? (
        <div
          role="group"
          aria-label="Confirm shipping"
          className="space-y-3 rounded-xl border border-border bg-background p-4"
        >
          <p className="font-medium">Mark as {target.name}?</p>
          <p className="text-sm text-muted-foreground">
            We&apos;ll write a short personal message for each person who asked
            and has an email address, using their own words. You review and
            approve them on the next page.
            <strong> Nothing is sent until you approve it.</strong>
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={pending} onClick={apply}>
              {pending
                ? "Preparing…"
                : `Mark as ${target.name} and prepare messages`}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              Not yet
            </Button>
          </div>
        </div>
      ) : null}

      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
