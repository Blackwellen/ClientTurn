"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function ImportError({
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
      boundary="leads.import"
      title="The import could not be loaded"
      description="Nothing has been imported or contacted. Try again, or go back to your leads."
      backHref="/app/leads"
      backLabel="Back to Leads"
      framed
    />
  );
}
