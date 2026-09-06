"use client";

import * as React from "react";
import { ErrorState } from "@/components/ui/feedback";

export default function AgentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Agents failed to load", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="rounded-xl border border-line bg-surface">
      <ErrorState
        title="Agents could not be loaded"
        // Agents run on the queue, not in this page: a render failure says
        // nothing about whether the work is happening.
        description="Any running agents are unaffected and continue in the background."
        onRetry={reset}
      />
    </div>
  );
}
