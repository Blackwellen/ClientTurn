/**
 * Find Leads skeleton.
 *
 * Mirrors the real layout — header, KPI strip, view switch, then the three
 * Discover columns — so the page does not visibly reflow when the data lands.
 * A generic spinner would be less work and a worse answer.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-44 rounded-md bg-surface-sunken" />
          <div className="h-4 w-80 rounded bg-surface-sunken" />
        </div>
        <div className="grid w-full max-w-[760px] grid-cols-2 gap-3 xl:w-auto xl:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="h-[76px] rounded-xl border border-line bg-surface" />
          ))}
        </div>
      </div>

      <div className="h-11 w-[460px] max-w-full rounded-lg bg-surface-sunken" />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="h-[420px] w-full rounded-xl border border-line bg-surface lg:w-[268px]" />
        <div className="h-[560px] min-w-0 flex-1 rounded-xl border border-line bg-surface" />
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[340px]">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="h-40 rounded-xl border border-line bg-surface" />
          ))}
        </div>
      </div>

      <span className="sr-only">Loading Find Leads</span>
    </div>
  );
}
