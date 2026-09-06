/**
 * Agents directory skeleton: header, then the type-grouped card grid.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-md bg-surface-sunken" />
          <div className="h-4 w-96 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className="h-10 w-32 rounded-lg bg-surface-sunken" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="h-56 rounded-xl border border-line bg-surface" />
        ))}
      </div>

      <span className="sr-only">Loading agents</span>
    </div>
  );
}
