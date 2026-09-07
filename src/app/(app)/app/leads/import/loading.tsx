/**
 * Lead import skeleton.
 *
 * The import wizard is four steps behind one shell: a stepper, a single panel
 * and a footer. Holding that shape means step one does not arrive as a jump.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-5">
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="h-8 w-56 rounded-md bg-surface-sunken" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-sunken" />
      </div>

      <div className="h-12 w-full rounded-lg bg-surface-sunken" />
      <div className="h-[460px] rounded-xl border border-line bg-surface" />

      <div className="flex justify-between">
        <div className="h-9 w-24 rounded-lg bg-surface-sunken" />
        <div className="h-9 w-28 rounded-lg bg-surface-sunken" />
      </div>

      <span className="sr-only">Loading the import wizard</span>
    </div>
  );
}
