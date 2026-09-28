"use client";

/**
 * Reports an error caught by a React error boundary (global-error.tsx and the
 * route `error.tsx` files). Boundaries swallow the error, so Sentry never sees
 * it unless it is passed on. A no-op unless `NEXT_PUBLIC_SENTRY_DSN` is set;
 * the SDK is imported lazily so an unconfigured build ships none of it.
 * The event still goes through the scrubber configured in
 * src/instrumentation-client.ts.
 */
export function reportClientError(error: Error & { digest?: string }, boundary: string): void {
  console.error(error);
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error, { tags: { boundary, digest: error.digest ?? "none" } });
    })
    .catch(() => undefined);
}
