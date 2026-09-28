"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function AdminError({
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
      boundary="admin"
      title="This admin view could not be loaded"
      description="The problem has been logged. Try again, and check System if it keeps happening."
      backHref="/admin"
      backLabel="Back to Overview"
    />
  );
}
