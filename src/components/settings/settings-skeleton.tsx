import { Skeleton } from "@/components/ui/feedback";

/**
 * Shared loading skeleton for settings sub-pages. Mirrors the card + icon
 * chip + field rhythm of the real forms so the loading state does not jump
 * around once data arrives. Used by every settings sub-route's loading.tsx.
 */
export function SettingsFormSkeleton({
  cards = 2,
  fieldsPerCard = 2,
}: {
  cards?: number;
  fieldsPerCard?: number;
}) {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading settings">
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="bg-surface border-line space-y-4 rounded-xl border shadow-xs"
        >
          <div className="flex items-start gap-3 px-5 py-4">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-64 max-w-full" />
            </div>
          </div>
          <div className="space-y-4 px-5 pb-5">
            {Array.from({ length: fieldsPerCard }).map((_, j) => (
              <div key={j} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
            {i === cards - 1 && (
              <Skeleton className="ml-auto h-8 w-32 rounded-md" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Loading state for table-shaped settings views (team, services). */
export function SettingsTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading settings">
      <div className="bg-surface border-line overflow-hidden rounded-xl border shadow-xs">
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3.5 w-56 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-8 w-28 shrink-0 rounded-md" />
        </div>
        <div className="border-line-subtle divide-line-subtle divide-y border-t">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 max-w-[180px] flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="ml-auto h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
