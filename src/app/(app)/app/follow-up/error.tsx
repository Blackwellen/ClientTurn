"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function FollowUpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      boundary="follow-up"
      title="Follow-Up could not be loaded"
      description="Your sequences and qualification questions are saved, and scheduled messages still send on time."
      backHref="/app"
      backLabel="Back to Dashboard"
      framed
    />
  );
}
