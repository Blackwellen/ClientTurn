"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function LeadError({
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
      boundary="leads.detail"
      title="This lead could not be loaded"
      description="This is usually temporary. The lead itself is unaffected, and its follow-up carries on as it was."
      backHref="/app/leads"
      backLabel="Back to Leads"
      framed
    />
  );
}
