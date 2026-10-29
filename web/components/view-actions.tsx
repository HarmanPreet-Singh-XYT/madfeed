"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  deleteViewAction,
  updateViewFields,
} from "@/app/(app)/w/[workspaceId]/requests/view-actions";
import { ConfirmDelete } from "./confirm-delete";
import { FormError } from "./form-message";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Filters = { status: string; tag: string; q: string; sort: string };

/**
 * Rename a saved view, replace the filters it stands for, or remove it. Only the
 * person who made it, or an admin, sees these controls; the API enforces it too.
 */
export function ViewActions({
  workspaceId,
  view,
  current,
  customised,
}: {
  workspaceId: string;
  view: Filters & { id: string; name: string };
  /** The filters on screen, offered as the replacement when they have been narrowed. */
  current: Filters;
  customised: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(view.name);
  const [useCurrent, setUseCurrent] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function save() {
    setError(undefined);
    const filters = useCurrent ? current : view;
    start(async () => {
      const r = await updateViewFields(workspaceId, view.id, {
        name,
        status: filters.status,
        tag: filters.tag,
        q: filters.q,
        sort: filters.sort,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-0.5 opacity-60 transition-opacity group-focus-within/view:opacity-100 group-hover/view:opacity-100 pointer-coarse:opacity-100">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Rename view ${view.name}`}
        title={`Rename view ${view.name}`}
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          setName(view.name);
          setError(undefined);
          setUseCurrent(false);
          setOpen(true);
        }}
      >
        <Pencil aria-hidden="true" className="size-3.5" />
      </Button>
      <ConfirmDelete
        compact
        label={`Remove view ${view.name}`}
        consequences={`Remove the saved view “${view.name}” for everyone? Your requests are not affected.`}
        confirmLabel="Yes, remove it"
        action={deleteViewAction.bind(null, workspaceId, view.id)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit “{view.name}”</DialogTitle>
            <DialogDescription>
              The name is shown on the tab. Views are shared with everyone in
              this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor={`view-name-${view.id}`} className="mb-1.5 block">
                Name
              </Label>
              <Input
                id={`view-name-${view.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
              />
            </div>
            {customised ? (
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`view-current-${view.id}`}
                  checked={useCurrent}
                  onCheckedChange={(v) => setUseCurrent(v === true)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`view-current-${view.id}`}
                  className="text-sm font-normal"
                >
                  Use the filters currently on screen
                </Label>
              </div>
            ) : null}
            <FormError message={error} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={pending || !name.trim()}
            >
              {pending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
