/**
 * Scoring skeleton: the identity card, the factor breakdown and the three
 * explanation panels, in the shape they will settle into.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="h-8 w-[420px] max-w-full rounded-md bg-surface-sunken" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-sunken" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className="h-40 rounded-xl border border-line bg-surface" />
        <div className="h-40 rounded-xl border border-line bg-surface" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className="h-[380px] rounded-xl border border-line bg-surface" />
        <div className="h-[380px] rounded-xl border border-line bg-surface" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-64 rounded-xl border border-line bg-surface" />
        ))}
      </div>

      <span className="sr-only">Loading prospect scoring</span>
    </div>
  );
}
