/**
 * New agent skeleton.
 *
 * Same shell as the wizard itself — back link, title, four-step progress, one
 * panel, footer — so the first step replaces the skeleton in place.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="space-y-2">
        <div className="h-4 w-28 rounded bg-surface-sunken" />
        <div className="h-8 w-48 rounded-md bg-surface-sunken" />
        <div className="h-4 w-80 max-w-full rounded bg-surface-sunken" />
      </div>

      <div className="h-12 w-full rounded-lg bg-surface-sunken" />
      <div className="h-[420px] rounded-xl border border-line bg-surface" />

      <div className="flex justify-between">
        <div className="h-9 w-24 rounded-lg bg-surface-sunken" />
        <div className="h-9 w-28 rounded-lg bg-surface-sunken" />
      </div>

      <span className="sr-only">Loading the agent setup</span>
    </div>
  );
}
