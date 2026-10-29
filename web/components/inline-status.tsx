"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { setStatusAction } from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { StatusPill } from "@/components/app/status-pill";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Bucket = "open" | "active" | "done" | "closed";
type Status = { id: string; name: string; bucket: Bucket };

/**
 * A status you can change where you see it. The pill opens a list of the workspace's statuses; picking one saves
 * straight away and offers Undo. A status that ships the request starts personal messages to the people who asked, so
 * that one asks first. People who can't edit see the plain pill.
 */
export function InlineStatus({
  workspaceId,
  requestId,
  requestTitle,
  current,
  statuses,
  canEdit,
}: {
  workspaceId: string;
  requestId: string;
  requestTitle: string;
  current: Status;
  statuses: Status[];
  canEdit: boolean;
}) {
  const [shown, setShown] = useState(current);
  // The row follows the server when it changes (another person, an issue closing) without remounting.
  const [seen, setSeen] = useState(current.id);
  if (seen !== current.id) {
    setSeen(current.id);
    setShown(current);
  }
  const [confirm, setConfirm] = useState<Status>();
  // A shipping status asks first, but only once the menu has closed: opening the dialog while the menu is still
  // fading out leaves both on screen and has them fight over focus.
  const askAfterClose = useRef<Status>(undefined);
  const [pending, start] = useTransition();

  if (!canEdit) {
    return <StatusPill name={shown.name} bucket={shown.bucket} />;
  }

  function apply(target: Status, previous: Status) {
    setShown(target);
    start(async () => {
      const res = await setStatusAction(workspaceId, requestId, target.id);
      if (res?.error) {
        setShown(previous);
        toast.error(res.error);
        return;
      }
      if (res?.notice) toast(res.notice);
      toast.success(`“${requestTitle}” is now ${target.name}.`, {
        action: {
          label: "Undo",
          onClick: () => {
            setShown(previous);
            void setStatusAction(workspaceId, requestId, previous.id).then(
              (r) => r?.error && toast.error(r.error),
            );
          },
        },
      });
    });
  }

  function choose(id: string) {
    const target = statuses.find((s) => s.id === id);
    if (!target || target.id === shown.id) return;
    if (target.bucket === "done" && shown.bucket !== "done") {
      askAfterClose.current = target;
      return;
    }
    apply(target, shown);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          aria-label={`Status: ${shown.name}. Change status of ${requestTitle}`}
          className="group inline-flex items-center gap-0.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          <StatusPill name={shown.name} bucket={shown.bucket} />
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-44"
          onCloseAutoFocus={(e) => {
            const target = askAfterClose.current;
            if (!target) return;
            askAfterClose.current = undefined;
            e.preventDefault(); // the dialog takes focus; it gives it back to this control when it closes
            setConfirm(target);
          }}
        >
          <DropdownMenuRadioGroup value={shown.id} onValueChange={choose}>
            {statuses.map((s) => (
              <DropdownMenuRadioItem key={s.id} value={s.id}>
                {s.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark as {confirm?.name} and prepare messages?
            </AlertDialogTitle>
            <AlertDialogDescription>
              We&apos;ll write a short personal message for each person who
              asked for “{requestTitle}” and has an email address, using their
              own words. You review and approve them on the next page.{" "}
              <strong>Nothing is sent until you approve it.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) apply(confirm, shown);
                setConfirm(undefined);
              }}
            >
              Mark as {confirm?.name}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
