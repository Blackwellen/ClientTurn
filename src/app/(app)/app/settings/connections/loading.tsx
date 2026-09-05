import { Skeleton } from "@/components/ui/feedback";
import { CardGridSkeleton } from "@/components/ui/skeleton-page";

export default function ConnectionsLoading() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-4 w-28" />
      <CardGridSkeleton count={6} className="lg:grid-cols-2" />
    </div>
  );
}
