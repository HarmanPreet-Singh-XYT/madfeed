import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

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
    <Empty className="rounded-xl border-2 border-dashed border-input/50 bg-card px-6 py-14">
      <EmptyMedia
        variant="icon"
        className="size-14 rounded-xl bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 text-on-brand shadow-card [&_svg:not([class*='size-'])]:size-7"
      >
        <Icon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle className="font-display text-lg font-semibold">
          {title}
        </EmptyTitle>
        {children ? (
          <EmptyDescription className="max-w-sm">{children}</EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  );
}
