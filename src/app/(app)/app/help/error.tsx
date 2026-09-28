"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function HelpError({
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
      boundary="help"
      title="Help could not be loaded"
      description="Try again, or raise a ticket from Support and we will answer by email."
      backHref="/app/support"
      backLabel="Go to Support"
      framed
    />
  );
}
