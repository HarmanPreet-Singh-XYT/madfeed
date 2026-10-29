"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "in 6 days", "2 hours ago", "now" for a moment, relative to this instant. */
function relativeText(d: Date): string {
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (abs >= ms || unit === "minute") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return rtf.format(0, "minute");
}

/**
 * A moment shown in the reader's own locale and time zone. The server cannot know either, and a client component
 * that formats with the browser's locale produces different text than the server did, which makes React fail to
 * hydrate and leaves the whole page unresponsive. So the server, and the first client render, show a fixed UTC
 * form (2026-10-24, or 2026-10-24 14:05 UTC with `time`), and the reader's format replaces it once the page is
 * interactive.
 *
 * `relative` puts "in 6 days" / "2 hours ago" in front of the moment, which is what a scheduled note is judged by.
 */
export function LocalTime({
  iso,
  time = false,
  relative = false,
}: {
  iso: string;
  time?: boolean;
  relative?: boolean;
}) {
  const local = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fixed = time
    ? `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
    : d.toISOString().slice(0, 10);
  // The reader's format is only ever computed on the client: the server's text must not depend on a locale.
  if (!local) {
    return <time dateTime={d.toISOString()}>{fixed}</time>;
  }
  const exact = time
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString();
  return (
    <time dateTime={d.toISOString()} title={exact}>
      {relative ? `${relativeText(d)} (${exact})` : exact}
    </time>
  );
}
