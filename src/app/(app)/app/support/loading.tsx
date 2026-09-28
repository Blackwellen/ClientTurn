import { Skeleton } from "@/components/ui/feedback";
import { CardGridSkeleton } from "@/components/ui/skeleton-page";

export default function SupportLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading support">
      <div>
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-2 h-3.5 w-full max-w-80" />
      </div>
      <CardGridSkeleton count={2} className="lg:grid-cols-2" />
    </div>
  );
}
