import { cn } from "@/lib/utils";

// A status is named by the workspace, but every status belongs to one of four buckets, and the bucket decides the
// colour of its dot. The label is always written out: colour is never the only signal.
type Bucket = "open" | "active" | "done" | "closed";

const DOT: Record<Bucket, string> = {
  open: "bg-hue-blue",
  active: "bg-hue-amber",
  done: "bg-hue-teal",
  closed: "bg-input",
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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", DOT[bucket])}
      />
      {name}
    </span>
  );
}
