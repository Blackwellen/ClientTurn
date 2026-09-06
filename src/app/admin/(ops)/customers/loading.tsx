import { Skeleton, SkeletonTable } from "@/components/ui/feedback";

export default function AdminCustomersLoading() {
  return (
    <div aria-busy="true" aria-label="Loading customers" className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-[300px] rounded-md" />
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-28 rounded-lg" />
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <SkeletonTable rows={10} />
      </div>
    </div>
  );
}
