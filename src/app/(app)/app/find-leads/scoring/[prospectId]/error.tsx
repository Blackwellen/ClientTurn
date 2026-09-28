"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function ScoringError({
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
      boundary="find-leads.scoring"
      title="This score could not be loaded"
      description="The score itself is unaffected. Nothing has been recalculated, and outreach decisions still use the stored value."
      backHref="/app/find-leads?view=prospects"
      backLabel="Back to Prospects"
      framed
    />
  );
}
