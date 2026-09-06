"use client";

import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";

/**
 * The wizard failed to load.
 *
 * Nothing has been sent and nothing has been reserved, which is worth saying:
 * the first thing anyone wonders when a campaign screen breaks is whether it
 * broke mid-send.
 */
export default function NewCampaignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Campaign wizard failed to load", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-5">
      <Link
        href="/app/find-leads?view=campaigns"
        className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        Back to Campaigns
      </Link>
      <div className="rounded-xl border border-line bg-surface">
        <ErrorState
          title="The campaign wizard could not be loaded"
          description="This is usually temporary. Your draft is saved, and nothing has been sent or reserved."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
