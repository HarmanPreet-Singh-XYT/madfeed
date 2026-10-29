import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// A status is named by the workspace, but every status belongs to one of four buckets, and the bucket decides its
// colour. The label is always written out: colour is never the only signal.
type Bucket = "open" | "active" | "done" | "closed";

const LOOK: Record<
  Bucket,
  { pill: "tint-blue" | "tint-amber" | "tint-teal" | "muted"; dot: string }
> = {
  open: { pill: "tint-blue", dot: "bg-hue-blue" },
  active: { pill: "tint-amber", dot: "bg-hue-amber" },
  done: { pill: "tint-teal", dot: "bg-hue-teal" },
  closed: { pill: "muted", dot: "bg-input" },
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
    <Badge
      variant={look.pill}
      className={cn("gap-1.5 px-2 font-medium", className)}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", look.dot)}
      />
      {name}
    </Badge>
  );
}
