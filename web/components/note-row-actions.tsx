"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteDraftAction,
  duplicateNoteAction,
} from "@/app/(app)/w/[workspaceId]/releases/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The per-row menu: open, copy, and delete a draft. A note that has been public is never deleted here. */
export function NoteRowActions({
  workspaceId,
  note,
}: {
  workspaceId: string;
  note: { id: string; title: string; state: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function duplicate() {
    start(async () => {
      const r = await duplicateNoteAction(workspaceId, note.id);
      if (r?.error) toast.error(r.error);
    });
  }

  function remove() {
    start(async () => {
      const r = await deleteDraftAction(workspaceId, note.id);
      if (r?.error) toast.error(r.error);
      else {
        toast.success(r?.notice ?? "Draft deleted.");
        router.push(`/w/${workspaceId}/releases`);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={`Actions for “${note.title}”`}
            disabled={pending}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={`/w/${workspaceId}/releases/${note.id}`}>
              <Pencil aria-hidden="true" />
              Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={duplicate}>
            <Copy aria-hidden="true" />
            Duplicate
          </DropdownMenuItem>
          {note.state === "draft" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirming(true)}
              >
                <Trash2 aria-hidden="true" />
                Delete draft
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{note.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft is removed for good. A note that has been public can
              only be taken down, so messages to customers keep their link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={pending}>
              {pending ? "Deleting…" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
