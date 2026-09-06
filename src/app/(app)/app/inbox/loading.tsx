/**
 * Inbox skeleton: channel rail, thread list, and the reading pane.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="space-y-2">
        <div className="h-8 w-32 rounded-md bg-surface-sunken" />
        <div className="h-4 w-80 max-w-full rounded bg-surface-sunken" />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="h-[560px] w-full rounded-xl border border-line bg-surface lg:w-[300px]" />
        <div className="h-[560px] min-w-0 flex-1 rounded-xl border border-line bg-surface" />
      </div>

      <span className="sr-only">Loading inbox</span>
    </div>
  );
}
