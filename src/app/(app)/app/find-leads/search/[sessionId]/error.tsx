"use client";

import * as React from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/feedback";

export default function SearchSessionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Search session failed to load", error.digest ?? error.message);
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
          title="This search session could not be loaded"
          description="Your search plan is saved. Nothing has been spent, and no sourcing has started."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
