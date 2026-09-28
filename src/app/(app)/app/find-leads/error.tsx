"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function FindLeadsError({
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
      boundary="find-leads"
      title="Find Leads could not be loaded"
      description="This is usually temporary. Your prospects, searches and sourcing runs are unaffected."
      backHref="/app"
      backLabel="Back to Dashboard"
      framed
    />
  );
}
