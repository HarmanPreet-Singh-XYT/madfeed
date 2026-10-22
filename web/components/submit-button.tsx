"use client";

import { useFormStatus } from "react-dom";
import { btn, btnPrimary } from "./ui";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "plain";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-disabled={pending}
      disabled={pending}
      className={variant === "primary" ? btnPrimary : btn}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
