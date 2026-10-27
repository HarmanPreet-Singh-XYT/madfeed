"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * A moment shown in the reader's own locale and time zone. The server cannot know either, and a client component
 * that formats with the browser's locale produces different text than the server did, which makes React fail to
 * hydrate and leaves the whole page unresponsive. So the server, and the first client render, show a fixed UTC
 * form (2026-10-24, or 2026-10-24 14:05 UTC with `time`), and the reader's format replaces it once the page is
 * interactive.
 */
export function LocalTime({
  iso,
  time = false,
}: {
  iso: string;
  time?: boolean;
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
  return (
    <time dateTime={d.toISOString()}>
      {local ? (time ? d.toLocaleString() : d.toLocaleDateString()) : fixed}
    </time>
  );
}
