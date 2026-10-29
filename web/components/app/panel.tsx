import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** A group on a product screen, with an optional heading row. */
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
    <Card asChild className={cn("gap-0 py-0", className)}>
      <section>
        {title || actions ? (
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              {title ? (
                <CardTitle asChild>
                  <h2>{title}</h2>
                </CardTitle>
              ) : null}
              {description ? (
                <CardDescription>{description}</CardDescription>
              ) : null}
            </div>
            {actions ? (
              <CardAction className="static col-auto row-auto justify-self-auto">
                {actions}
              </CardAction>
            ) : null}
          </CardHeader>
        ) : null}
        <CardContent className="p-4">{children}</CardContent>
      </section>
    </Card>
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
    <Card
      asChild
      className={cn("gap-0 py-0", danger && "ring-1 ring-destructive/40")}
    >
      <section
        id={id}
        aria-labelledby={id ? `${id}-h` : undefined}
        className="scroll-mt-4"
      >
        <div
          className={cn(
            "flex items-start justify-between gap-4 border-b px-5 py-3",
            danger
              ? "border-destructive/30 bg-tint-coral"
              : "border-border bg-muted/50",
          )}
        >
          <div className="min-w-0">
            <h2
              id={id ? `${id}-h` : undefined}
              className={cn(
                "font-heading text-base leading-snug font-semibold tracking-tight",
                danger && "text-destructive",
              )}
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {status ? <div className="shrink-0 pt-0.5">{status}</div> : null}
        </div>
        <CardContent className="space-y-4 p-5 [&_input:not([type=checkbox],[type=radio],[type=file])]:max-w-md [&_select]:max-w-md [&_textarea]:max-w-2xl">
          {children}
        </CardContent>
      </section>
    </Card>
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
    <Badge
      variant={on === undefined ? "outline" : on ? "tint-teal" : "muted"}
      className="gap-1.5 bg-card font-semibold shadow-xs"
    >
      {on === undefined ? null : (
        <span
          aria-hidden="true"
          className={cn("size-2 rounded-full", on ? "bg-hue-teal" : "bg-input")}
        />
      )}
      {children}
    </Badge>
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
      className="flex w-fit flex-wrap gap-1 rounded-lg bg-secondary p-1"
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-8 items-center rounded-md px-3 text-sm font-medium transition-all",
            i.active
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
