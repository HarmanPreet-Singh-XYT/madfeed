"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { noteHref } from "@/components/note-filters";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";

const subscribe = () => () => {};

export type CalendarNote = {
  id: string;
  title: string;
  type: string;
  at: string; // an absolute instant: scheduledFor for a scheduled note
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "2026-11" -> { year: 2026, month: 10 } (month is 0-based). */
function parseMonth(s: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return { year: 1970, month: 0 };
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return { year: 1970, month: 0 };
  return { year, month };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, by: number): string {
  const { year, month } = parseMonth(key);
  const d = new Date(Date.UTC(year, month + by, 1));
  return monthKey(d.getUTCFullYear(), d.getUTCMonth());
}

/**
 * The month a moment falls in, in UTC, for the server and the first client render. After mount the reader's
 * own zone is used, which is the only place a "publishing at 00:30 on the 1st" can land in the right cell.
 */
function dayOfMonth(iso: string, zone: "utc" | "local"): number {
  const d = new Date(iso);
  return zone === "utc" ? d.getUTCDate() : d.getDate();
}

function hhmm(iso: string, zone: "utc" | "local"): string {
  const d = new Date(iso);
  return zone === "utc"
    ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A month of scheduled notes, one cell per day. Everything links to the note itself. */
export function NoteCalendar({
  workspaceId,
  month,
  notes,
  filters,
}: {
  workspaceId: string;
  month: string;
  notes: CalendarNote[];
  filters: { state: string; q: string; type: string };
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const zone = mounted ? "local" : "utc";
  const { year, month: m } = parseMonth(month);
  const label = new Date(Date.UTC(year, m, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Weeks start on Monday. The first cell is the Monday on or before the 1st.
  const first = new Date(Date.UTC(year, m, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
  const cells = Math.ceil((offset + days) / 7) * 7;

  const byDay = new Map<number, CalendarNote[]>();
  for (const n of notes) {
    const day = dayOfMonth(n.at, zone);
    const d = new Date(n.at);
    const sameMonth =
      zone === "utc"
        ? d.getUTCFullYear() === year && d.getUTCMonth() === m
        : d.getFullYear() === year && d.getMonth() === m;
    if (!sameMonth) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), n]);
  }

  const monthNotes = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  const monthCount = monthNotes.reduce((n, [, list]) => n + list.length, 0);

  const today = new Date();
  const isThisMonth =
    today.getUTCFullYear() === year && today.getUTCMonth() === m;
  const todayDay = mounted ? today.getDate() : today.getUTCDate();

  return (
    <div className="rounded-xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Link
            href={noteHref(workspaceId, { ...filters, view: "calendar" }, { month: shiftMonth(month, -1) })}
            aria-label="Previous month"
            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Link>
          <h2 className="min-w-36 px-1 text-center text-sm font-semibold">
            {label}
          </h2>
          <Link
            href={noteHref(workspaceId, { ...filters, view: "calendar" }, { month: shiftMonth(month, 1) })}
            aria-label="Next month"
            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
          {isThisMonth ? null : (
            <Link
              href={noteHref(workspaceId, { ...filters, view: "calendar" }, {
                month: monthKey(today.getUTCFullYear(), today.getUTCMonth()),
              })}
              className="ml-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              This month
            </Link>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {plural(monthCount, "scheduled note")} · times in your time zone
        </p>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-xs font-medium text-muted-foreground max-sm:hidden">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-1 py-1.5">
            <span className="hidden sm:inline">{d}</span>
            <span aria-hidden="true" className="sm:hidden">
              {d.slice(0, 1)}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 max-sm:hidden">
        {Array.from({ length: cells }, (_, i) => {
          const day = i - offset + 1;
          const inMonth = day >= 1 && day <= days;
          const items = inMonth ? (byDay.get(day) ?? []) : [];
          const isToday = inMonth && isThisMonth && day === todayDay;
          return (
            <div
              key={i}
              className={cn(
                "min-h-20 border-r border-b border-border p-1 last:border-r-0",
                !inMonth && "bg-muted/20",
              )}
            >
              {inMonth ? (
                <p
                  className={cn(
                    "mb-1 flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums text-muted-foreground",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {day}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {items.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/w/${workspaceId}/releases/${n.id}`}
                      className="block truncate rounded px-1 py-0.5 text-[11px] leading-tight hover:bg-muted"
                      title={n.title}
                    >
                      <span className="tabular-nums text-muted-foreground">
                        {hhmm(n.at, zone)}
                      </span>{" "}
                      <span className="font-medium">{n.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <ul className="divide-y divide-border sm:hidden">
        {monthNotes.map(([day, list]) => (
          <li key={day} className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground tabular-nums">
              {new Date(Date.UTC(year, m, day)).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </p>
            <ul className="mt-1 space-y-0.5">
              {list.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/w/${workspaceId}/releases/${n.id}`}
                    className="flex items-baseline gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                  >
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {hhmm(n.at, zone)}
                    </span>
                    <span className="min-w-0 truncate">{n.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {monthCount === 0 ? (
        <p className="border-t border-border p-4 text-sm text-muted-foreground">
          Nothing scheduled in {label}. Pick a go-live time on a draft and it
          appears here.
        </p>
      ) : null}
    </div>
  );
}
