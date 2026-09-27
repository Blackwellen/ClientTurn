import { Skeleton, SkeletonTable } from "@/components/ui/feedback";

export default function AdminEconomicsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading economics" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-56 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="space-y-2.5 rounded-xl border border-line bg-surface px-4 py-3.5">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center gap-3 px-5 py-3.5">
            <Skeleton className="size-8 rounded-[9px]" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
          <SkeletonTable rows={index === 0 ? 5 : 8} />
        </div>
      ))}
    </div>
  );
}
