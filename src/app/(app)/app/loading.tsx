import { Skeleton, SkeletonTable } from "@/components/ui/feedback";
import { KpiCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Mirrors the dashboard's real geometry so nothing shifts when data lands. */
export default function DashboardLoading() {
  return (
    <div className="space-y-3.5" aria-busy>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-7 w-72" />
          <Skeleton className="mt-2 h-3.5 w-56" />
        </div>
        <Skeleton className="h-11 w-44 rounded-lg" />
      </div>

      <div className="border-line bg-line grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-surface flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-1.5 h-4 w-20 rounded-full" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <KpiCard key={i} compact label="" value="" loading />
        ))}
      </div>

      <div className="dashboard-middle-grid grid gap-3.5">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between gap-2 py-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <Skeleton className="size-14 rounded-full sm:size-16" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-36" />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-7 shrink-0 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="mt-1.5 h-3 w-28" />
                </div>
                <Skeleton className="h-3 w-10 shrink-0" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="pt-0">
              <SkeletonTable rows={6} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3.5 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-40" />
            </CardHeader>
            <CardContent className="pt-0">
              <SkeletonTable rows={5} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
