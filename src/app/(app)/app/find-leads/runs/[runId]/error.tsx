"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function RunError({
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
      boundary="find-leads.run"
      title="This sourcing run could not be loaded"
      description="The run is unaffected. It continues in the background, and its prospects are safe."
      backHref="/app/find-leads"
      backLabel="Back to Find Leads"
      framed
    />
  );
}
