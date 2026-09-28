"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function InboxError({
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
      boundary="inbox"
      title="Your inbox could not be loaded"
      description="No messages have been lost. This is usually a temporary problem with one connected channel."
      backHref="/app"
      backLabel="Back to Dashboard"
      framed
    />
  );
}
