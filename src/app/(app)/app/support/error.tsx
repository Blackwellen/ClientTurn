"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function SupportError({
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
      boundary="support"
      title="Support could not be loaded"
      description="You can also email support@clientturn.com and we will reply there."
      backHref="/app/help"
      backLabel="Go to Help"
      framed
    />
  );
}
