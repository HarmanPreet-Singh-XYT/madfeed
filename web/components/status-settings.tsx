"use client";

import { useActionState } from "react";
import {
  createStatusAction,
  renameStatusAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

type StatusRow = { id: string; name: string; bucket: string };

const BUCKETS: { value: string; label: string }[] = [
  { value: "open", label: "Open (not started)" },
  { value: "active", label: "In progress" },
  { value: "done", label: "Shipped (done)" },
  { value: "closed", label: "Closed (won't do)" },
];

function RenameRow({
  workspaceId,
  status,
}: {
  workspaceId: string;
  status: StatusRow;
}) {
  const [state, action, pending] = useActionState(
    renameStatusAction.bind(null, workspaceId, status.id),
    undefined,
  );
  const bucket = BUCKETS.find((b) => b.value === status.bucket)?.label;
  return (
    <li className="space-y-1">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`status-${status.id}`} className="sr-only">
            Name of the status {status.name}
          </label>
          <input
            id={`status-${status.id}`}
            name="name"
            defaultValue={status.name}
            maxLength={60}
            required
            className={field}
          />
        </div>
        <span className="text-sm text-muted-foreground">{bucket}</span>
        <button type="submit" className={btn} disabled={pending}>
          {pending ? "Saving…" : "Rename"}
        </button>
      </form>
      <FormError message={state?.error} />
    </li>
  );
}

export function StatusSettings({
  workspaceId,
  statuses,
}: {
  workspaceId: string;
  statuses: StatusRow[];
}) {
  const [state, action, pending] = useActionState(
    createStatusAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The steps a request moves through. Moving a request to a{" "}
        <strong>shipped</strong> status starts personal messages for the people
        who asked, which you review before anything is sent.
      </p>
      <ul className="space-y-2">
        {statuses.map((s) => (
          <RenameRow key={s.id} workspaceId={workspaceId} status={s} />
        ))}
      </ul>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="new-status-name" className="mb-1 block text-sm">
            New status
          </label>
          <input
            id="new-status-name"
            name="name"
            maxLength={60}
            required
            className={field}
          />
        </div>
        <div>
          <label htmlFor="new-status-bucket" className="mb-1 block text-sm">
            Counts as
          </label>
          <select
            id="new-status-bucket"
            name="bucket"
            defaultValue="active"
            className={field}
          >
            {BUCKETS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={btnPrimary} disabled={pending}>
          {pending ? "Adding…" : "Add status"}
        </button>
      </form>
      <FormError message={state?.error} />
    </div>
  );
}
