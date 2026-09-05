import { Skeleton } from "@/components/ui/feedback";
import { LeadCardGridSkeleton } from "@/components/leads/leads-states";

/**
 * Mirrors the loaded page's spacing and card sizes so the transition from
 * skeleton to content shifts nothing. Card view is the first-run default, so
 * that is what this shows.
 */
export default function LeadsLoading() {
  return (
    <div className="space-y-4" aria-busy>
      <div>
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>

      <Skeleton className="h-10 w-full max-w-[520px] rounded-xl" />

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-full rounded-lg sm:w-[340px] xl:w-[420px]" />
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="ml-auto h-10 w-[228px] rounded-lg" />
      </div>

      <LeadCardGridSkeleton count={12} />
    </div>
  );
}
