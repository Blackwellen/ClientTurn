"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function NewCampaignError({
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
      boundary="find-leads.campaign-new"
      title="The campaign wizard could not be loaded"
      description="This is usually temporary. Your draft is saved, and nothing has been sent or reserved."
      backHref="/app/find-leads?view=campaigns"
      backLabel="Back to Campaigns"
      framed
    />
  );
}
