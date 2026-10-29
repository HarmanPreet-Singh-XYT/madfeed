import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The directory's shape while the API answers, so the page does not jump. */
export function PeopleSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <Skeleton className="h-3.5 w-48" />
        </div>
        <ul className="divide-y divide-border">
          {Array.from({ length: 7 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
              <Skeleton className="h-5 w-12" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
