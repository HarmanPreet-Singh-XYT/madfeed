import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export type Hue = "blue" | "teal" | "amber" | "coral" | "sky";
const HUE: Record<Hue, string> = {
  blue: "bg-hue-blue",
  teal: "bg-hue-teal",
  amber: "bg-hue-amber",
  coral: "bg-hue-coral",
  sky: "bg-hue-sky",
};

/** A coloured rounded square with a white icon, the same marker the landing page uses for features. */
export function IconBadge({
  icon: Icon,
  hue = "blue",
  className,
}: {
  icon: LucideIcon;
  hue?: Hue;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-2xl text-on-brand shadow-card",
        HUE[hue],
        className,
      )}
    >
      <Icon className="size-5.5" />
    </span>
  );
}

/** The top of a product screen: an optional way back, the one h1, a line of help, and the page's actions.
    The header is the brand's gradient, the same one as the landing page's hero. `icon` and `hue` are accepted so
    older callers keep working; they are not drawn. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  icon?: LucideIcon;
  hue?: Hue;
}) {
  return (
    <header className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 px-5 py-5 text-on-brand shadow-card sm:px-7 sm:py-6">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 -z-10 size-64 rounded-full bg-on-brand/10 blur-2xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 left-1/3 -z-10 size-56 rounded-full bg-sun/15 blur-3xl"
      />
      {back ? (
        <Link
          href={back.href}
          className="mb-2 inline-flex min-h-7 items-center gap-0.5 text-sm text-on-brand/90 transition-colors hover:text-on-brand"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-[0.9375rem] text-on-brand [&_a]:text-on-brand [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:no-underline">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/** A number with a label, and optionally an icon, as in a dashboard tile. */
export function Stat({
  label,
  value,
  hint,
  icon,
  hue = "blue",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  hue?: Hue;
}) {
  return (
    <Card size="sm" className="flex-row items-start gap-3 p-4">
      {icon ? (
        <IconBadge
          icon={icon}
          hue={hue}
          className="size-8 rounded-md shadow-none [&_svg]:size-4"
        />
      ) : null}
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Card>
  );
}
