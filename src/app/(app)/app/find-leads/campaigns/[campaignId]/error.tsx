"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function CampaignError({
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
      boundary="find-leads.campaign"
      title="This campaign could not be loaded"
      description="This is usually temporary. The campaign itself is unaffected and carries on as it was."
      backHref="/app/find-leads?view=campaigns"
      backLabel="Back to Campaigns"
      framed
    />
  );
}
