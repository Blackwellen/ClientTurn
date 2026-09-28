import { Skeleton, SkeletonText } from "@/components/ui/feedback";

/** First-run pages had no loading state: a slow render showed a blank screen at signup. */
export default function FirstRunLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4" aria-busy="true" aria-label="Loading">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border border-line bg-surface p-6">
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-6 w-2/3" />
        <SkeletonText lines={3} />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}
