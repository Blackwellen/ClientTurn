"use client";

import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";

export default function SourcingRunError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Sourcing run failed to load", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-4">
      <Link
        href="/app/find-leads"
        className="inline-flex text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        ← Find Leads
      </Link>
      <div className="rounded-xl border border-line bg-surface">
        <ErrorState
          title="This sourcing run could not be loaded"
          // The run itself is a background job: it carries on regardless of
          // whether this page can render it.
          description="The run is unaffected — it continues in the background, and its prospects are safe."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
