"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/feedback";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="This admin view could not be loaded"
      description={
        error.digest
          ? `Reference ${error.digest}.`
          : "Try again. If it persists, check the worker and provider logs."
      }
      onRetry={reset}
    />
  );
}
