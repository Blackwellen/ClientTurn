/**
 * Campaign detail skeleton.
 *
 * Mirrors the real layout — header, tabs, KPI strip, then the three-column
 * analytics grid — so the page does not visibly reflow when the aggregates
 * land.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="space-y-2">
        <div className="h-4 w-36 rounded bg-surface-sunken" />
        <div className="h-8 w-[26rem] max-w-full rounded-md bg-surface-sunken" />
        <div className="h-4 w-[32rem] max-w-full rounded bg-surface-sunken" />
      </div>

      <div className="h-9 w-full max-w-md rounded bg-surface-sunken" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="h-[92px] rounded-xl border border-line bg-surface" />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-56 rounded-xl border border-line bg-surface" />
        ))}
      </div>

      <span className="sr-only">Loading the campaign</span>
    </div>
  );
}
