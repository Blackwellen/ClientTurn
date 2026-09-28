"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function AgentsError({
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
      boundary="agents"
      title="Agents could not be loaded"
      description="Any running agents are unaffected and continue in the background."
      backHref="/app/agents"
      backLabel="Back to Agents"
      framed
    />
  );
}
