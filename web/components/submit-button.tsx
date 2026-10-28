"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** The submit control for a form. Keeps a real `type="submit"` button (some forms read the submitter's name and
    value) and shows its pending label while the action is in flight. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "variant" | "size"> & {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "plain";
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant === "primary" ? "default" : "outline"}
      size={size ?? "lg"}
      aria-disabled={pending}
      disabled={pending}
      {...props}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}
