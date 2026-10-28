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

/** The top of a product screen: an optional way back, an icon, the one h1, a line of help, and the page's actions. */
export function PageHeader({
  title,
  description,
  actions,
  back,
  icon,
  hue = "blue",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  icon?: LucideIcon;
  hue?: Hue;
}) {
  return (
    <header className="space-y-3">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex min-h-7 items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-4">
          {icon ? <IconBadge icon={icon} hue={hue} /> : null}
          <div className="min-w-0 space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="max-w-3xl text-muted-foreground">{description}</p>
            ) : null}
          </div>
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
        <IconBadge icon={icon} hue={hue} className="size-10 rounded-lg" />
      ) : null}
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-display text-2xl font-bold tracking-tight tabular-nums">
          {value}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Card>
  );
}
