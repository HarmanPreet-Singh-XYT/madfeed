"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

const navButton =
  "inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/**
 * A month calendar in the product's own tokens. Days are buttons, so a keyboard and a screen reader
 * move through them the way the day picker expects.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit p-3", className)}
      classNames={{
        root: "w-fit",
        months: "relative flex w-full flex-col",
        month: "space-y-2",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "text-sm font-semibold",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: navButton,
        button_next: navButton,
        chevron: "size-4",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 rounded-md text-[0.7rem] font-medium text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "size-9 p-0 text-center text-sm",
        day_button:
          "size-9 rounded-md font-normal transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none aria-selected:opacity-100",
        selected:
          "[&_button]:bg-primary [&_button]:font-medium [&_button]:text-primary-foreground [&_button]:hover:bg-primary/90",
        today:
          "[&_button]:ring-1 [&_button]:ring-primary/40 [&_button]:ring-inset",
        outside: "text-muted-foreground/50",
        disabled: "[&_button]:text-muted-foreground/40",
        hidden: "invisible",
        ...classNames,
      }}
      labels={{
        // A bare day number in the name keeps the spoken label and the visible number in step.
        labelDayButton: (date) =>
          date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          }),
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4" />
          ),
      }}
      {...props}
    />
  );
}
