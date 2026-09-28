"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      boundary="analytics"
      title="Analytics could not be loaded"
      description="Your data is safe. Reports are rebuilt from it each time, so try again in a moment."
      backHref="/app"
      backLabel="Back to Dashboard"
      framed
    />
  );
}
