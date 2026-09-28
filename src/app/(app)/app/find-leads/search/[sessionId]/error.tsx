"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function SearchSessionError({
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
      boundary="find-leads.search"
      title="This search session could not be loaded"
      description="Your search plan is saved. Nothing has been spent, and no sourcing has started."
      backHref="/app/find-leads"
      backLabel="Back to Find Leads"
      framed
    />
  );
}
