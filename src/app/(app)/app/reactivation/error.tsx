"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function ReactivationError({
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
      boundary="reactivation"
      title="Reactivation could not be loaded"
      description="Your campaigns are unaffected and carry on as scheduled."
      backHref="/app"
      backLabel="Back to Dashboard"
      framed
    />
  );
}
