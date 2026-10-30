"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mergePersonAction } from "@/app/(app)/w/[workspaceId]/people/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { avatarTint, initials, type PersonRow } from "./types";

/**
 * Merging the two selected people. One survives, one is deleted; you say which.
 * Nothing happens until the warning is acknowledged, and the API refuses if a
 * send record would be lost.
 */
export function MergeSelectedDialog({
  workspaceId,
  pair,
  open,
  onOpenChange,
  onMerged,
}: {
  workspaceId: string;
  pair: [PersonRow, PersonRow] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}) {
  const router = useRouter();
  const [keep, setKeep] = useState<string>(pair?.[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [seen, setSeen] = useState(pair?.map((p) => p.id).join() ?? "");
  const now = pair?.map((p) => p.id).join() ?? "";
  if (seen !== now) {
    setSeen(now);
    setKeep(pair?.[0]?.id ?? "");
    setConfirmed(false);
    setError(undefined);
  }

  const card = (p: PersonRow) => (
    <label
      htmlFor={`keep-${p.id}`}
      className={`flex min-w-0 flex-1 cursor-pointer gap-2 rounded-xl border p-3 ${
        keep === p.id ? "border-ring bg-muted" : "border-border"
      }`}
    >
      <RadioGroupItem
        id={`keep-${p.id}`}
        value={p.id}
        aria-label={`Keep ${p.name}`}
        className="mt-1"
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTint(p.name)}`}
          >
            {initials(p.name)}
          </span>
          <span className="min-w-0">
            <span className="line-clamp-2 text-sm font-medium break-words">{p.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {p.email || "No email"}
            </span>
          </span>
        </span>
        <span className="mt-2 block text-xs text-muted-foreground">
          {p.accountName ?? "No company"} · {p.quoteCount ?? 0} quote
          {p.quoteCount === 1 ? "" : "s"}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {keep === p.id ? "Stays, with everything" : "Deleted after its work moves"}
        </span>
      </span>
    </label>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setConfirmed(false);
          setError(undefined);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge these two people</DialogTitle>
          <DialogDescription>
            Choose who survives. Everything the other person said, voted on, was
            invited to and talked to us in moves across; then they are deleted.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {pair ? (
          <div className="space-y-3">
            <RadioGroup
              value={keep}
              onValueChange={setKeep}
              className="grid grid-cols-2 items-stretch gap-2"
              aria-label="Who survives the merge"
            >
              {card(pair[0])}
              {card(pair[1])}
            </RadioGroup>
            <Alert>
              <AlertTitle>What happens to the rest</AlertTitle>
              <AlertDescription>
                Claims, votes, survey invitations and conversations move.
                Duplicate votes and invitations are dropped in the survivor&apos;s
                favour. If both were told about the same request, the merge is
                refused so no send record is lost.
              </AlertDescription>
            </Alert>
            <div className="flex items-start gap-2">
              <Checkbox
                id="merge-selected-confirm"
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
              />
              <Label htmlFor="merge-selected-confirm" className="text-sm font-normal">
                I understand the other person will be deleted and this cannot be
                undone.
              </Label>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!pair || !keep || !confirmed || pending}
            onClick={() => {
              if (!pair || !keep) return;
              const other = pair[0].id === keep ? pair[1] : pair[0];
              start(async () => {
                const r = await mergePersonAction(workspaceId, other.id, keep);
                if (r.error) {
                  setError(r.error);
                  return;
                }
                toast.success(r.notice ?? "People merged.");
                onOpenChange(false);
                onMerged?.();
                router.refresh();
              });
            }}
          >
            {pending ? "Merging…" : "Merge people"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
