import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bordered group on a product screen, with an optional heading row. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border", className)}>
      {title || actions ? (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? <h2>{title}</h2> : null}
            {description ? (
              <p className="text-[13px] text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A settings group: a card with its title and what it is for in the header, a status on the right, and the controls below. */
export function SettingsGroup({
  id,
  title,
  description,
  status,
  danger = false,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  /** A short state shown at the right of the header, such as "On" or "Team plan". */
  status?: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-h` : undefined}
      className={cn(
        "scroll-mt-4 overflow-hidden rounded-lg border bg-card",
        danger ? "border-destructive/40" : "border-border",
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-4 border-b px-5 py-3.5",
          danger
            ? "border-destructive/30 bg-tint-coral"
            : "border-border bg-muted/40",
        )}
      >
        <div className="min-w-0">
          <h2
            id={id ? `${id}-h` : undefined}
            className={danger ? "text-destructive" : undefined}
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {status ? <div className="shrink-0 pt-0.5">{status}</div> : null}
      </div>
      <div className="space-y-4 p-5 [&_input:not([type=checkbox],[type=radio],[type=file])]:max-w-md [&_select]:max-w-md [&_textarea]:max-w-2xl">
        {children}
      </div>
    </section>
  );
}

/** A small on/off or plan chip for a settings header. */
export function StatusChip({
  on,
  children,
}: {
  on?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium">
      {on === undefined ? null : (
        <span
          aria-hidden="true"
          className={cn("size-2 rounded-full", on ? "bg-hue-teal" : "bg-input")}
        />
      )}
      {children}
    </span>
  );
}

/** Pills for switching between views of the same page. Links, so each view has an address. */
export function Segmented({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; active: boolean }[];
}) {
  return (
    <nav
      aria-label={label}
      className="flex w-fit flex-wrap gap-0.5 rounded-md bg-secondary p-0.5"
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-7 items-center rounded px-3 text-[13px] font-medium transition-all",
            i.active
              ? "bg-card text-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
