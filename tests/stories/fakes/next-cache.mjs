// Stands in for `next/cache` under node --test (see ../story-hooks.mjs).
export function revalidatePath() {}
export function revalidateTag() {}
export function unstable_cache(fn) {
  return fn;
}
export function unstable_noStore() {}
