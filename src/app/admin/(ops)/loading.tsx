import { Skeleton, SkeletonTable } from "@/components/ui/feedback";

/**
 * Mirrors the Overview layout — eight KPI tiles above a two-up panel grid —
 * so the page does not reflow when the real data lands. No page-level spinner.
 */
export default function AdminOverviewLoading() {
  return (
    <div aria-busy="true" aria-label="Loading platform overview" className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-[420px] max-w-full rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="space-y-2.5 rounded-xl border border-line bg-surface px-3.5 py-3"
          >
            <Skeleton className="h-7 w-7 rounded-[9px]" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 min-[1600px]:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-xl border border-line bg-surface"
          >
            <div className="flex items-center gap-3 px-5 py-3.5">
              <Skeleton className="size-8 rounded-[9px]" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-52" />
              </div>
            </div>
            <SkeletonTable rows={6} />
          </div>
        ))}
      </div>
    </div>
  );
}
