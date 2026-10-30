"use client";

import { useState } from "react";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field that can be read back, says when Caps Lock is on, and keeps
 * the label and help text wired to the input for screen readers.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  minLength,
  maxLength,
  required = true,
  describedBy,
  onChange,
  defaultValue,
}: {
  id: string;
  name: string;
  /** Leave out when the form draws its own label beside the field. */
  label?: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  describedBy?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  defaultValue?: string;
}) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsId = `${id}-caps`;
  const help = [describedBy, caps ? capsId : undefined]
    .filter(Boolean)
    .join(" ");

  const checkCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") {
      setCaps(e.getModifierState("CapsLock"));
    }
  };

  return (
    <div>
      {label ? (
        <label htmlFor={id} className="mb-1 block text-sm font-medium">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          onChange={onChange}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          aria-describedby={help || undefined}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          aria-controls={id}
          title={shown ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-1.5 my-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {shown ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      <p
        id={capsId}
        role="status"
        aria-live="polite"
        className={cn(
          "mt-1 text-xs text-muted-foreground",
          caps ? "visible" : "invisible",
        )}
      >
        Caps Lock is on.
      </p>
    </div>
  );
}

/** The two rules the product enforces, shown as they become true. */
export function PasswordRules({
  id,
  password,
  again,
}: {
  id: string;
  password: string;
  again?: string;
}) {
  const rules: [string, boolean][] = [
    ["At least 10 characters", password.length >= 10],
  ];
  if (again !== undefined) {
    rules.push(["Both passwords match", password.length > 0 && password === again]);
  }
  return (
    <ul id={id} aria-live="polite" className="mt-2 space-y-1 text-sm">
      {rules.map(([label, ok]) => (
        <li
          key={label}
          className={cn(
            "flex items-center gap-2",
            ok ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {ok ? (
            <Check aria-hidden="true" className="size-4 text-hue-teal" />
          ) : (
            <Circle aria-hidden="true" className="size-4" />
          )}
          {label}
          <span className="sr-only">{ok ? " (done)" : " (not yet)"}</span>
        </li>
      ))}
    </ul>
  );
}
