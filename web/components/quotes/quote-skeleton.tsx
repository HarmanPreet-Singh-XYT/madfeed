import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The list's shape while the API answers, so the page does not jump. */
export function QuoteSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <Skeleton className="h-3.5 w-40" />
        </div>
        <ul className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-start gap-4 px-4 py-3">
              <Skeleton className="mt-1 size-4 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-full max-w-lg" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
