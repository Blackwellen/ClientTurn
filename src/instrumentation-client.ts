/**
 * Browser instrumentation. Error tracking is OFF unless
 * `NEXT_PUBLIC_SENTRY_DSN` is set (next.config.ts fills it from `SENTRY_DSN`;
 * a DSN is a public identifier, not a secret). With no DSN the SDK is never
 * downloaded: the import below is dynamic and only runs when configured.
 *
 * No session replay, no default PII, the same scrubber as the server
 * (src/lib/observability/sentry-scrub.ts).
 */
type SentryModule = typeof import("@sentry/nextjs");

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
let sentry: SentryModule | null = null;

if (DSN) {
  void Promise.all([import("@sentry/nextjs"), import("@/lib/observability/sentry-scrub")]).then(
    ([Sentry, { sentryOptions }]) => {
      Sentry.init(
        sentryOptions({
          dsn: DSN,
          runtime: "browser",
          environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
          tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
        }),
      );
      sentry = Sentry;
    },
  );
}

/** Next calls this on every client navigation; a no-op until Sentry has loaded. */
export function onRouterTransitionStart(href: string, navigationType: string) {
  sentry?.captureRouterTransitionStart(href, navigationType);
}
