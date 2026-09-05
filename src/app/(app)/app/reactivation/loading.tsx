import { Skeleton } from "@/components/ui/feedback";
import { ReactivationSummarySkeleton } from "@/components/reactivation/reactivation-summary";

/**
 * Mirrors the real card view's geometry — header, six KPI cards, the control
 * bar and a two-row grid of eight cards — so nothing jumps when the data
 * arrives.
 */
export default function ReactivationLoading() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Skeleton className="h-8 w-52" />
          <Skeleton className="mt-2 h-4 w-[520px] max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-[152px] rounded-lg" />
          <Skeleton className="h-10 w-[168px] rounded-lg" />
        </div>
      </div>

      <ReactivationSummarySkeleton />

      <Skeleton className="h-[58px] rounded-xl" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-[228px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
