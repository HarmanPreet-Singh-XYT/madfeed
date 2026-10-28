import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** What a list says when it has nothing in it: what it is for, and the one thing to do next. */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-input/50 bg-card px-6 py-14 text-center">
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 text-on-brand shadow-card"
      >
        <Icon className="size-7" />
      </span>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? (
        <div className="max-w-sm text-sm text-muted-foreground">{children}</div>
      ) : null}
    </div>
  );
}
