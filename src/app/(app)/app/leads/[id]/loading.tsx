import { Skeleton, SkeletonTable } from "@/components/ui/feedback";

/**
 * Mirrors the loaded page: back link, identity, key-facts strip, then the
 * record beside the right rail (actions, contactability), so nothing shifts
 * when the lead arrives.
 */
export default function LeadDetailLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading lead">
      <Skeleton className="h-4 w-28" />

      <div className="flex items-start gap-4">
        <Skeleton className="hidden size-14 shrink-0 rounded-full sm:block" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line-subtle shadow-xs sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3 bg-surface px-5 py-3.5">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="space-y-4 xl:order-2">
          <Skeleton className="h-[236px] w-full rounded-xl" />
          <Skeleton className="hidden h-[260px] w-full rounded-xl xl:block" />
        </div>
        <div className="min-w-0 space-y-4 xl:order-1">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-9 w-full max-w-[640px]" />
          <div className="rounded-xl border border-line bg-surface shadow-xs">
            <SkeletonTable rows={5} />
          </div>
        </div>
      </div>
    </div>
  );
}
