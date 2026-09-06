"use client";

import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";

export default function ProspectScoringError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Prospect scoring failed to load", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-4">
      <Link
        href="/app/find-leads?view=prospects"
        className="inline-flex text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        &larr; Back to Prospects
      </Link>
      <div className="rounded-xl border border-line bg-surface">
        <ErrorState
          title="This score could not be loaded"
          // The stored score is untouched by a read failure, and no campaign
          // decision depends on this page rendering.
          description="The score itself is unaffected — nothing has been recalculated, and outreach decisions still use the stored value."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
