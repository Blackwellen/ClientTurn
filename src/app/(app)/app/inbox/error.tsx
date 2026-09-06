"use client";

import * as React from "react";
import { ErrorState } from "@/components/ui/feedback";

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Inbox failed to load", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="rounded-xl border border-line bg-surface">
      <ErrorState
        title="Your inbox could not be loaded"
        description="No messages have been lost. This is usually a temporary problem with one connected channel."
        onRetry={reset}
      />
    </div>
  );
}
