"use client";

import * as React from "react";
import { ErrorState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";

/**
 * Find Leads failed to load.
 *
 * The header stays so the customer can still see where they are and use the
 * navigation; only the panel that failed is replaced. `reset` re-runs the
 * server render, which is the right retry for a transient database or provider
 * read — not a full page reload that loses their place.
 */
export default function FindLeadsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Server-side logging already captured this; recording the digest here is
    // what lets support tie a customer's report to the actual failure.
    console.error("Find Leads failed to load", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Find Leads"
        description="Use AI to find, verify and engage high-quality prospects for your business."
        size="lg"
      />
      <div className="rounded-xl border border-line bg-surface">
        <ErrorState
          title="Find Leads could not be loaded"
          description="This is usually temporary. Your prospects, searches and sourcing runs are unaffected."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
