import { Skeleton } from "@/components/ui/feedback";
import { CardGridSkeleton } from "@/components/ui/skeleton-page";

export default function HelpLoading() {
  return (
    <div className="space-y-5" aria-busy>
      <div>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-2 h-3.5 w-96" />
      </div>
      <CardGridSkeleton count={3} className="lg:grid-cols-3" />
    </div>
  );
}
