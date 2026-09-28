"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function AppError({
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
      boundary="app"
      title="This page could not be loaded"
      description="The problem has been logged. Try again, and contact support if it keeps happening."
      backHref="/app"
      backLabel="Back to Dashboard"
    />
  );
}
