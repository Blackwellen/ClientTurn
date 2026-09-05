import { Skeleton } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Mirrors the real two-column shape so the page does not jump when the data
 * lands: one wide status banner, a tall editor on the left, three stacked
 * cards on the right.
 */
export default function FollowUpLoading() {
  return (
    <div className="space-y-5" aria-busy>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-2 h-3.5 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-52 rounded-lg" />
      </div>

      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-[14rem] flex-1">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
          <div className="shrink-0">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-1.5 h-3.5 w-36" />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <Skeleton className="size-9 shrink-0 rounded-lg" />
                <div>
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-1.5 h-3.5 w-80 max-w-full" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-4">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[6.5rem] w-full rounded-lg" />
              ))}
              <Skeleton className="h-10 w-44 rounded-lg" />
              <Skeleton className="h-[4.5rem] w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <Skeleton className="size-9 shrink-0 rounded-lg" />
                  <div>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-1.5 h-3.5 w-56 max-w-full" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
