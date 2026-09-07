/**
 * Analytics skeleton.
 *
 * Mirrors the real layout — header with the range picker, the four-view switch,
 * a metric row, then the chart and table stack — so the page does not reflow
 * when the figures land. Analytics is the slowest route in the product, which
 * is exactly why it should not have been the one without a loading state.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-md bg-surface-sunken" />
          <div className="h-4 w-72 rounded bg-surface-sunken" />
        </div>
        <div className="h-9 w-56 rounded-lg bg-surface-sunken" />
      </div>

      <div className="h-11 w-[420px] max-w-full rounded-lg bg-surface-sunken" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="h-[92px] rounded-xl border border-line bg-surface" />
        ))}
      </div>

      <div className="h-[320px] rounded-xl border border-line bg-surface" />
      <div className="h-[420px] rounded-xl border border-line bg-surface" />

      <span className="sr-only">Loading Analytics</span>
    </div>
  );
}
