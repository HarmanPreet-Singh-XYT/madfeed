"use client";

import { useActionState } from "react";
import {
  createStatusAction,
  renameStatusAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
          <Label htmlFor={`status-${status.id}`} className="sr-only">
            Name of the status {status.name}
          </Label>
          <Input
            id={`status-${status.id}`}
            name="name"
            defaultValue={status.name}
            maxLength={60}
            required
          />
        </div>
        <span className="text-sm text-muted-foreground">{bucket}</span>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Rename"}
        </Button>
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
          <Label
            id="new-status-name-label"
            htmlFor="new-status-name"
            className="mb-1 block text-sm"
          >
            New status
          </Label>
          <Input id="new-status-name" name="name" maxLength={60} required />
        </div>
        <div>
          <Label
            id="new-status-bucket-label"
            htmlFor="new-status-bucket"
            className="mb-1 block text-sm"
          >
            Counts as
          </Label>
          <Select name="bucket" defaultValue="active">
            <SelectTrigger
              id="new-status-bucket"
              aria-labelledby="new-status-bucket-label"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUCKETS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add status"}
        </Button>
      </form>
      <FormError message={state?.error} />
    </div>
  );
}
