import { cn } from "@/lib/utils";

// A status is named by the workspace, but every status belongs to one of four buckets, and the bucket decides its
// colour. The label is always written out: colour is never the only signal.
type Bucket = "open" | "active" | "done" | "closed";

const LOOK: Record<Bucket, { pill: string; dot: string }> = {
  open: { pill: "bg-tint-blue", dot: "bg-hue-blue" },
  active: { pill: "bg-tint-amber", dot: "bg-hue-amber" },
  done: { pill: "bg-tint-teal", dot: "bg-hue-teal" },
  closed: { pill: "bg-muted", dot: "bg-input" },
};

export function StatusPill({
  name,
  bucket,
  className,
}: {
  name: string;
  bucket: Bucket;
  className?: string;
}) {
  const look = LOOK[bucket];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-foreground",
        look.pill,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", look.dot)}
      />
      {name}
    </span>
  );
}
