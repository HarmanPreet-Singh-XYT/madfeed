"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Eye, MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteDraftAction,
  duplicateNoteAction,
  publishNoteAction,
  renameNoteAction,
  unpublishNoteAction,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Paragraphs } from "@/components/paragraphs";
import { LocalTime } from "@/components/local-time";
import { plural } from "@/lib/format";

type Note = {
  id: string;
  title: string;
  body: string;
  state: string;
  liveNow: boolean;
  publishedAt?: string;
  scheduledFor?: string;
  requests: { id: string; title: string }[];
};

/**
 * The page's primary actions: see exactly what customers will see, publish with the consequences stated,
 * and the rarer things (duplicate, take down, delete a draft) in the menu.
 */
export function ReleaseActions({
  workspaceId,
  note,
  publicPath,
  canEdit,
}: {
  workspaceId: string;
  note: Note;
  publicPath?: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(note.title);
  const [confirming, setConfirming] = useState<"publish" | "takeDown" | "delete" | null>(null);

  const takenDown = note.state === "unpublished";
  const publishLabel = note.liveNow
    ? "Published"
    : takenDown
      ? "Publish again"
      : "Publish now";

  function act(fn: () => Promise<{ error?: string; notice?: string } | undefined>) {
    start(async () => {
      const r = await fn();
      if (r?.error) toast.error(r.error);
      else {
        if (r?.notice) toast.success(r.notice);
        router.refresh();
      }
      setConfirming(null);
    });
  }

  function publish() {
    act(() => publishNoteAction(workspaceId, note.id, {}));
  }

  function takeDown() {
    act(() => unpublishNoteAction(workspaceId, note.id));
  }

  function rename(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await renameNoteAction(workspaceId, note.id, newTitle);
      if (r?.error) toast.error(r.error);
      else {
        toast.success(r?.notice ?? "Renamed.");
        setRenaming(false);
        router.refresh();
      }
    });
  }

  function duplicate() {
    act(() => duplicateNoteAction(workspaceId, note.id));
  }

  function remove() {
    start(async () => {
      const r = await deleteDraftAction(workspaceId, note.id);
      setConfirming(null);
      if (r?.error) toast.error(r.error);
      else {
        toast.success(r?.notice ?? "Draft deleted.");
        router.push(`/w/${workspaceId}/releases`);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setPreview(true)}>
        <Eye aria-hidden="true" />
        Preview
      </Button>
      {canEdit ? (
        <>
          <Button
            type="button"
            disabled={pending || note.liveNow}
            onClick={() => setConfirming("publish")}
          >
            {note.liveNow ? "Published" : publishLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="More actions for this note"
                disabled={pending}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onSelect={() => {
                  setNewTitle(note.title);
                  setRenaming(true);
                }}
              >
                <Pencil aria-hidden="true" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={duplicate}>
                <Copy aria-hidden="true" />
                Duplicate
              </DropdownMenuItem>
              {note.liveNow || note.state === "scheduled" ? (
                <DropdownMenuItem onSelect={() => setConfirming("takeDown")}>
                  <Undo2 aria-hidden="true" />
                  Take it down
                </DropdownMenuItem>
              ) : null}
              {note.state === "draft" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirming("delete")}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete draft
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      <Sheet open={preview} onOpenChange={setPreview}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="text-sm font-normal text-muted-foreground">
              {note.liveNow ? "What customers see" : "Preview · not public yet"}
            </SheetTitle>
            <SheetDescription className="sr-only">
              The release note as it appears on the public page.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-8">
            <div className="rounded-xl bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 px-5 py-6 text-on-brand">
              <p className="text-xs tracking-wide uppercase opacity-90">
                Release note
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-balance">
                {note.title || "Untitled note"}
              </h2>
              <p className="mt-2 text-sm opacity-90">
                {note.publishedAt ? (
                  <LocalTime iso={note.publishedAt} />
                ) : note.scheduledFor ? (
                  <>Goes live <LocalTime iso={note.scheduledFor} time relative /></>
                ) : (
                  "Not published yet"
                )}
              </p>
            </div>
            {note.body.trim() ? (
              <Paragraphs text={note.body} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing written yet. A published note with no text says only its
                title.
              </p>
            )}
            {note.requests.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {plural(note.requests.length, "request")} will be marked as
                closed. Request links never appear on the public page.
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename note</DialogTitle>
            <DialogDescription>
              The title is the page&apos;s name: it shows in the list, in customer
              messages and at the top of the public page.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={rename} className="space-y-3">
            <div>
              <Label htmlFor="rename-title" className="mb-1 block text-sm font-medium">
                Title
              </Label>
              <Input
                id="rename-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={200}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !newTitle.trim()}>
                {pending ? "Renaming…" : "Rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirming === "publish"}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Publish “{note.title || "Untitled note"}” now?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Anyone with the link can read it straight away. You can take it
                  down again, and you can still edit it afterwards.
                </p>
                <ul className="space-y-1.5">
                  <li className="flex items-start gap-2">
                    <Badge variant="muted" className="mt-0.5">
                      Link
                    </Badge>
                    <span>
                      {publicPath
                        ? `public at ${publicPath}`
                        : "This workspace has no public address yet, so the note will only be visible to your team until you set one in Settings."}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Badge variant="muted" className="mt-0.5">
                      Requests
                    </Badge>
                    <span>
                      {note.requests.length === 0
                        ? "none linked; messages to customers will not mention this note"
                        : `${plural(note.requests.length, "request")} will be marked as closed, and messages about them can link to this note`}
                    </span>
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={publish} disabled={pending}>
              {pending ? "Publishing…" : publishLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirming === "takeDown"}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take this note off the public page?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with the link will stop seeing it. The note, its text and
              its request links are kept, and you can publish it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it live</AlertDialogCancel>
            <AlertDialogAction onClick={takeDown} disabled={pending}>
              Take it down
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirming === "delete"}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed for good. A note that has been public can only be
              taken down, so messages to customers keep their link.
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
    </div>
  );
}
