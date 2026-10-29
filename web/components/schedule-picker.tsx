"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" on the wall clock, which is what the schedule action takes. */
export function toLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalValue(v: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return undefined;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Clock reads live in helpers: a component body must stay pure for the hooks lint and for hydration.
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isPast(d: Date): boolean {
  return d.getTime() < Date.now();
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** 14 -> "2 PM", so the hour list reads the same way as the chosen time. */
function hourLabel(h: number): string {
  return `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * A date and a time, in one popover. The calendar is a real month grid with keyboard movement; the time is
 * two selects, so nothing here is a bare browser control. The value is the wall-clock string the scheduling
 * action converts with the reader's zone, so a time cannot drift when the page is opened elsewhere.
 */
export function SchedulePicker({
  value,
  onChange,
  zone,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  zone: string;
  /** What the field is for, so the button's name says it and its own text stays part of that name. */
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromLocalValue(value);
  const hour = selected ? selected.getHours() : 9;
  const minute = selected ? selected.getMinutes() : 0;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  // Five-minute steps, plus the note's own minute if it is not on one, so nothing is silently changed.
  const steps = Array.from({ length: 12 }, (_, i) => i * 5);
  const minutes = steps.includes(minute)
    ? steps
    : [...steps, minute].sort((a, b) => a - b);

  function setDay(day: Date | undefined) {
    if (!day) {
      onChange("");
      return;
    }
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hour,
      minute,
    );
    onChange(toLocalValue(next));
  }

  function setHour(h: number) {
    const base = selected ?? new Date();
    onChange(
      toLocalValue(
        new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, minute),
      ),
    );
  }

  function setMinute(m: number) {
    const base = selected ?? new Date();
    onChange(
      toLocalValue(
        new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, m),
      ),
    );
  }

  /** A time that has already passed today is not offered. */
  function timeDisabled(h: number, m: number) {
    const base = selected ?? new Date();
    return isPast(
      new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m),
    );
  }

  const today = startOfToday();
  const visible = selected
    ? `${dayLabel(selected)} · ${timeLabel(selected)}`
    : "Choose a date and time";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`${label}: ${visible}`}
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !selected && "text-muted-foreground",
          )}
        >
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          {visible}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        aria-label={`${label}: date and time`}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={setDay}
          defaultMonth={selected ?? today}
          startMonth={today}
          weekStartsOn={1}
          disabled={{ before: today }}
        />
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Time</p>
            <div className="flex items-center gap-1.5">
              <Select
                value={String(hour)}
                onValueChange={(v) => setHour(Number(v))}
              >
                <SelectTrigger aria-label="Hour" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {hours.map((h) => (
                    <SelectItem key={h} value={String(h)} disabled={timeDisabled(h, minute)}>
                      {hourLabel(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span aria-hidden="true" className="text-muted-foreground">
                :
              </span>
              <Select
                value={String(minute)}
                onValueChange={(v) => setMinute(Number(v))}
              >
                <SelectTrigger aria-label="Minute" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {minutes.map((m) => (
                    <SelectItem key={m} value={String(m)} disabled={timeDisabled(hour, m)}>
                      {pad(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {selected ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange("")}
              >
                Clear
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Your time zone: {zone}
        </p>
      </PopoverContent>
    </Popover>
  );
}
