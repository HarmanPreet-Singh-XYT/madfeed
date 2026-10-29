"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  deleteRequestAction,
  renameRequest,
} from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { ConfirmDelete } from "./confirm-delete";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
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

/**
 * Rename a request, or delete it with an admin. The delete copy names what the
 * cascade removes so nobody loses evidence without knowing.
 */
export function RequestActions({
  workspaceId,
  requestId,
  title,
  canRename,
  canDelete,
}: {
  workspaceId: string;
  requestId: string;
  title: string;
  canRename: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (!canRename && !canDelete) return null;

  function save() {
    setError(undefined);
    start(async () => {
      const r = await renameRequest(workspaceId, requestId, name);
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {canRename ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={() => {
            setName(title);
            setError(undefined);
            setOpen(true);
          }}
        >
          <Pencil aria-hidden="true" />
          Rename request
        </Button>
      ) : null}
      {canDelete ? (
        <ConfirmDelete
          label="Delete this request"
          consequences={`This removes the request “${title}”, its evidence quotes, brief, votes, tags and issue link for everyone. The conversations it came from stay. This cannot be undone.`}
          confirmLabel="Yes, delete it"
          action={deleteRequestAction.bind(null, workspaceId, requestId)}
          thenGo={`/w/${workspaceId}/requests`}
        />
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename request</DialogTitle>
            <DialogDescription>
              This is the title people see in the list, in briefs and in release
              notes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`request-title-${requestId}`}>Title</Label>
            <Input
              id={`request-title-${requestId}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoFocus
            />
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
              {pending ? "Saving…" : "Save title"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
