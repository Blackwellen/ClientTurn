/**
 * New campaign skeleton.
 *
 * Mirrors the real layout — header, six-step tracker, main column and helper
 * rail — so the wizard does not visibly reflow when the draft and the plan
 * limits land.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="space-y-2">
        <div className="h-4 w-36 rounded bg-surface-sunken" />
        <div className="h-8 w-80 rounded-md bg-surface-sunken" />
        <div className="h-4 w-[30rem] max-w-full rounded bg-surface-sunken" />
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line-subtle sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="h-[68px] bg-surface" />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_336px]">
        <div className="h-[560px] rounded-xl border border-line bg-surface" />
        <div className="space-y-4">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-40 rounded-xl border border-line bg-surface" />
          ))}
        </div>
      </div>

      <span className="sr-only">Loading the campaign wizard</span>
    </div>
  );
}
