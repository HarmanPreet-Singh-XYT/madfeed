"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** A delete that says what will go before it happens. */
export function ConfirmDelete({
  label,
  consequences,
  confirmLabel,
  action,
  thenGo,
  compact = false,
}: {
  label: string;
  consequences: string;
  confirmLabel: string;
  action: () => Promise<{ error?: string }>;
  thenGo?: string;
  /** A small icon button for tight places such as table rows. The full label stays as its name. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {compact ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className="text-muted-foreground hover:bg-tint-coral hover:text-destructive"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        ) : (
          <Button type="button" variant="outline">
            {label}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>{consequences}</AlertDialogDescription>
        </AlertDialogHeader>
        <FormError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              start(async () => {
                const r = await action();
                if (r.error) {
                  setError(r.error);
                  return;
                }
                setOpen(false);
                if (thenGo) router.push(thenGo);
                else router.refresh();
              });
            }}
          >
            {pending ? "Deleting…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
