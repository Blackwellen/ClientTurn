/**
 * Search session skeleton: conversation left, plan and controls right, at the
 * same ratio the loaded page uses.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-4">
      <div className="h-4 w-24 rounded bg-surface-sunken" />
      <div className="space-y-2">
        <div className="h-8 w-96 max-w-full rounded-md bg-surface-sunken" />
        <div className="h-4 w-[520px] max-w-full rounded bg-surface-sunken" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)]">
        <div className="h-[620px] rounded-xl border border-line bg-surface" />
        <div className="space-y-4">
          <div className="h-[420px] rounded-xl border border-line bg-surface" />
          <div className="h-[320px] rounded-xl border border-line bg-surface" />
        </div>
      </div>
      <span className="sr-only">Loading search session</span>
    </div>
  );
}
