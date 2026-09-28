/**
 * Next.js instrumentation (server and edge). Error tracking is OFF unless
 * `SENTRY_DSN` is set: with no DSN, `@sentry/nextjs` is never imported, so
 * development and the test suites pay nothing and send nothing.
 *
 * Options and the PII scrubber: src/lib/observability/sentry-scrub.ts
 * (docs/OBSERVABILITY.md "Error tracking").
 */
import type { Instrumentation } from "next";

function dsn(): string | undefined {
  return process.env.SENTRY_DSN || undefined;
}

export async function register() {
  const value = dsn();
  if (!value) return;
  const runtime = process.env.NEXT_RUNTIME === "edge" ? "edge" : "nodejs";
  const [Sentry, { sentryOptions }] = await Promise.all([
    import("@sentry/nextjs"),
    import("@/lib/observability/sentry-scrub"),
  ]);
  Sentry.init(
    sentryOptions({
      dsn: value,
      runtime,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
      release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
      tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE,
    }),
  );
}

/** Server-side render, route handler and server action errors. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
