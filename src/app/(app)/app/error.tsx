"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function DashboardError({
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
      boundary="dashboard"
      title="This page could not be loaded"
      description="Your leads and follow-up are unaffected and carry on in the background. Try again in a moment."
      backHref="/app/leads"
      backLabel="Go to Leads"
      framed
    />
  );
}
