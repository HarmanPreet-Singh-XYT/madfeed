import type { components } from "@/lib/api/schema.gen";

export type Media = components["schemas"]["Media"];

export type RecordingFilter = "all" | "done" | "processing" | "attention";

/**
 * Which filter a recording belongs under. "Needs attention" is anything the
 * reader may have to do something about: a failed transcript, or an upload
 * that stopped part-way.
 */
export function filterOf(
  m: Pick<Media, "state">,
): Exclude<RecordingFilter, "all"> {
  if (m.state === "done") return "done";
  if (m.state === "uploaded" || m.state === "transcribing") return "processing";
  return "attention";
}

/** The day heading a recording belongs under, in the reader's own timezone. */
export function dayGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 30) return "This month";
  return "Earlier";
}

/** True when a recording matches the search box: file name or the person it is about. */
export function matches(
  m: Pick<Media, "filename" | "personId" | "title">,
  personName: string | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    m.filename.toLowerCase().includes(q) ||
    (m.title ?? "").toLowerCase().includes(q) ||
    (personName ?? "").toLowerCase().includes(q)
  );
}
