"use client";

import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";

/**
 * The campaign failed to load.
 *
 * `reset` re-runs the server render, which is the right retry for a transient
 * read. Saying that sending is unaffected matters: a broken campaign page
 * looks exactly like a broken campaign.
 */
export default function CampaignDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Campaign detail failed to load", error.digest ?? error.message);
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
          title="This campaign could not be loaded"
          description="This is usually temporary. The campaign itself is unaffected — it carries on doing whatever it was doing."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
