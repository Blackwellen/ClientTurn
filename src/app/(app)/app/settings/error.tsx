"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function SettingsError({
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
      boundary="settings"
      title="Settings could not be loaded"
      description="Nothing has been changed. Try again, and contact support if it keeps happening."
      backHref="/app"
      backLabel="Back to Dashboard"
      framed
    />
  );
}
