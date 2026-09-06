/**
 * Sourcing run skeleton: the agent activity stream and the operational panels.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-4">
      <div className="h-4 w-24 rounded bg-surface-sunken" />
      <div className="space-y-2">
        <div className="h-8 w-[520px] max-w-full rounded-md bg-surface-sunken" />
        <div className="h-4 w-80 rounded bg-surface-sunken" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="h-[620px] rounded-xl border border-line bg-surface" />
        <div className="space-y-4">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-44 rounded-xl border border-line bg-surface" />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading sourcing run</span>
    </div>
  );
}
