"use client";

import * as React from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { useLeadParams } from "./use-lead-params";

/** Nothing has ever arrived — point at the thing that would make leads appear. */
export function LeadsEmptyState() {
  return (
    <EmptyState
      icon={Users}
      title="No leads yet"
      description="Connected lead sources will appear here within seconds of an enquiry arriving."
      action={
        <Link
          href="/app/settings?section=connections"
          className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-content shadow-xs transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          Check connections
        </Link>
      }
    />
  );
}

/** Leads exist, but this combination of filters matches none of them. */
export function LeadsFilteredEmptyState() {
  const { clearFilters } = useLeadParams();
  return (
    <EmptyState
      icon={Users}
      title="No leads match these filters"
      description="Try widening the date range or removing a filter."
      action={
        <Button variant="secondary" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  );
}

export function LeadsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      title="Couldn’t load leads"
      description="Something went wrong fetching this list. Your leads are safe — try again."
      onRetry={onRetry}
    />
  );
}

/* ---------------------------------------------------------------- skeletons */

export function LeadCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-3 w-2/5" />
      <Skeleton className="mt-3 h-[26px] w-24 rounded-md" />
      <div className="mt-3.5 space-y-2">
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="mt-3.5 flex items-center gap-2">
        <Skeleton className="size-6 shrink-0 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="mt-4 h-3 w-full" />
    </div>
  );
}

/** Matches the real grid so switching from loading to loaded never jumps. */
export function LeadCardGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 min-[640px]:grid-cols-2 min-[1280px]:grid-cols-3 min-[1440px]:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <LeadCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function LeadsTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <div className="h-10 border-b border-line-subtle bg-surface-sunken/50" />
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 border-b border-line-subtle px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="size-4 shrink-0 rounded-xs" />
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-56" />
          </div>
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="h-[22px] w-20 shrink-0 rounded-md" />
          <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
          <Skeleton className="h-3 w-20 shrink-0" />
          <Skeleton className="h-3 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}
