"use client";

import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";

/**
 * The lead failed to load. `reset` re-runs the server render, the right retry
 * for a transient read. Follow-up for the lead is unaffected, and saying so
 * matters: a broken lead page looks exactly like a broken lead.
 */
export default function LeadDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Lead detail failed to load", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-4">
      <Link
        href="/app/leads"
        className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        Back to Leads
      </Link>
      <div className="rounded-xl border border-line bg-surface">
        <ErrorState
          title="This lead could not be loaded"
          description="This is usually temporary. The lead itself is unaffected, and its follow-up carries on as it was."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
