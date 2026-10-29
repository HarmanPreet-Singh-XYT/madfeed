import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATES = {
  draft: { label: "Draft", variant: "muted" as const },
  scheduled: { label: "Scheduled", variant: "tint-blue" as const },
  published: { label: "Published", variant: "tint-teal" as const },
  unpublished: { label: "Taken down", variant: "tint-amber" as const },
};

export const NOTE_STATE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATES).map(([k, v]) => [k, v.label]),
);

/** A note's state as a word in a badge, never a bare colour: the word is what carries the meaning. */
export function NoteStatus({
  state,
  className,
}: {
  state: string;
  className?: string;
}) {
  const s =
    STATES[state as keyof typeof STATES] ??
    ({ label: state, variant: "outline" } as const);
  return (
    <Badge variant={s.variant} className={cn("font-medium", className)}>
      {s.label}
    </Badge>
  );
}

const KINDS: Record<string, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

/** The kind as a word, for places that need text rather than a badge. */
export const NOTE_KIND_LABEL: Record<string, string> = KINDS;

/** What kind of change a note is. Quiet, because the state is the louder fact about a note. */
export function NoteKind({
  type,
  className,
}: {
  type?: string;
  className?: string;
}) {
  if (!type || !KINDS[type]) return null;
  return (
    <Badge variant="outline" className={cn("font-normal", className)}>
      {KINDS[type]}
    </Badge>
  );
}
