"use client";

import { useRef, useState } from "react";
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

/**
 * A submit that asks first. It lives inside a form whose action is a server
 * action, so the real submit is a hidden button the dialog clicks once the
 * person has read what it does.
 */
export function ConfirmSubmit({
  label,
  confirmLabel,
  consequences,
  variant = "outline",
  disabled,
  name,
  value,
}: {
  label: string;
  confirmLabel: string;
  consequences: string;
  variant?: "outline" | "default" | "danger";
  disabled?: boolean;
  /** The form field the real button carries, such as intent=rotate. */
  name?: string;
  value?: string;
}) {
  const real = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={real}
        type="submit"
        name={name}
        value={value}
        hidden
        tabIndex={-1}
        aria-hidden="true"
      />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant={variant} disabled={disabled}>
            {label}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label}?</AlertDialogTitle>
            <AlertDialogDescription>{consequences}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                real.current?.click();
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
