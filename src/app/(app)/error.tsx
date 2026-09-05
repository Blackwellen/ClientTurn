"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/feedback";

export default function AppError({
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
      title="This page could not be loaded"
      description={
        error.digest
          ? `The problem has been logged. Try again, and quote reference ${error.digest} if it keeps happening.`
          : "The problem has been logged. Try again, and contact support if it keeps happening."
      }
      onRetry={reset}
    />
  );
}
