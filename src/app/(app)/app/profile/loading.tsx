import { Skeleton } from "@/components/ui/feedback";

export default function ProfileLoading() {
  return (
    <div className="max-w-3xl space-y-4" aria-busy>
      <div>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-2 h-3.5 w-80" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-surface border-line space-y-4 rounded-xl border p-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}
