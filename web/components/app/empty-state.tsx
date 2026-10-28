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
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input/60 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-lg bg-secondary text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {children ? (
        <div className="max-w-sm text-[13px] text-muted-foreground">
          {children}
        </div>
      ) : null}
    </div>
  );
}
