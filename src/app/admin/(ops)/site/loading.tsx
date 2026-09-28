import { Skeleton, SkeletonTable } from "@/components/ui/feedback";

/** Mirrors /admin/site: title, the state card, the two-up panels, banners. */
export default function AdminSiteLoading() {
  return (
    <div aria-busy="true" aria-label="Loading site controls" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <Skeleton className="h-[148px] w-full rounded-xl" />
      <div className="grid gap-5 min-[1400px]:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <Skeleton className="h-[520px] w-full rounded-xl" />
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <SkeletonTable rows={5} />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <SkeletonTable rows={4} />
      </div>
    </div>
  );
}
