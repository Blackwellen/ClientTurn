import * as React from "react";
import { cn } from "@/lib/cn";
import { Skeleton, SkeletonTable, SkeletonText } from "./feedback";

export function PageSkeleton({
  kpis = 4,
  rows = 8,
  className,
}: {
  kpis?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading page"
      className={cn("space-y-6", className)}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {kpis > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <div
              key={i}
              className="bg-surface border border-line rounded-xl px-4 py-3.5 space-y-2.5"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      )}

      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line-subtle">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md ml-auto" />
        </div>
        <SkeletonTable rows={rows} />
      </div>
    </div>
  );
}

export function CardGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-surface border border-line rounded-xl px-5 py-4 space-y-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full shrink-0" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <SkeletonText lines={2} />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function DrawerSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading details"
      className={cn("space-y-6", className)}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full shrink-0" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </div>

      <div className="space-y-2.5">
        <Skeleton className="h-3 w-24" />
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}
