import { Skeleton, SkeletonTable } from "@/components/ui/feedback";

export default function AdminSystemLoading() {
  return (
    <div aria-busy="true" aria-label="Loading system view" className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-9 w-64 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-line bg-surface px-4 py-3.5"
          >
            <Skeleton className="h-8 w-8 rounded-[9px]" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 min-[1600px]:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-xl border border-line bg-surface"
          >
            <div className="flex items-center gap-3 px-5 py-3.5">
              <Skeleton className="size-8 rounded-[9px]" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
            <SkeletonTable rows={6} />
          </div>
        ))}
      </div>
    </div>
  );
}
