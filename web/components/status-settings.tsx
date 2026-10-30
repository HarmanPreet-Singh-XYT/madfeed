"use client";

import { useActionState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import {
  createStatusAction,
  deleteStatusAction,
  renameStatusAction,
  reorderStatusesAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { ConfirmDelete } from "./confirm-delete";
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

function StatusRowItem({
  workspaceId,
  status,
  index,
  total,
  order,
}: {
  workspaceId: string;
  status: StatusRow;
  index: number;
  total: number;
  /** Every status id, in the order shown, for moving this one. */
  order: string[];
}) {
  const [state, action, pending] = useActionState(
    renameStatusAction.bind(null, workspaceId, status.id),
    undefined,
  );
  const [moving, startMove] = useTransition();

  function move(by: -1 | 1) {
    const next = [...order];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    startMove(async () => {
      const r = await reorderStatusesAction(workspaceId, next);
      if (r?.error) toast.error(r.error);
    });
  }

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
        <div>
          <Label
            htmlFor={`status-bucket-${status.id}`}
            className="sr-only"
          >
            What {status.name} counts as
          </Label>
          <Select name="bucket" defaultValue={status.bucket}>
            <SelectTrigger
              id={`status-bucket-${status.id}`}
              className="min-h-11 w-44"
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
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Move ${status.name} up`}
          title="Move up"
          disabled={moving || index === 0}
          onClick={() => move(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Move ${status.name} down`}
          title="Move down"
          disabled={moving || index === total - 1}
          onClick={() => move(1)}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <ConfirmDelete
          label={`Delete ${status.name}`}
          consequences="It is removed from this list. Only a status no request is in can be deleted: move those requests first if you need to. This cannot be undone."
          confirmLabel="Yes, delete it"
          action={async () =>
            (await deleteStatusAction(workspaceId, status.id)) ?? {}
          }
        />
      </form>
      <FormError message={state?.error} />
      {state?.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      ) : null}
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
  const order = statuses.map((s) => s.id);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The steps a request moves through. Moving a request to a{" "}
        <strong>shipped</strong> status starts personal messages for the people
        who asked, which you review before anything is sent.
      </p>
      <ul className="space-y-2">
        {statuses.map((s, i) => (
          <StatusRowItem
            key={s.id}
            workspaceId={workspaceId}
            status={s}
            index={i}
            total={statuses.length}
            order={order}
          />
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
