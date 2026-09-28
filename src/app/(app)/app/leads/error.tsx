"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function LeadsError({
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
      boundary="leads"
      title="Your leads could not be loaded"
      description="This is usually temporary. No leads have been lost, and follow-up carries on in the background."
      backHref="/app"
      backLabel="Back to Dashboard"
      framed
    />
  );
}
