"use client";

import { RouteError } from "@/components/ui/route-error";

/** Partner portal boundary (affiliate audit 17 §5): friendly copy, retry, a way back. */
export default function AffiliatePortalError({
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
      boundary="affiliates"
      title="This part of the partner portal could not be loaded"
      description="Your commission and payouts are safe: they are recorded in the ledger, not on this page. Try again in a moment."
      backHref="/affiliates/app"
      backLabel="Back to the dashboard"
      framed
    />
  );
}
