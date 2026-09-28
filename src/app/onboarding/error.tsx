"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <RouteError
        error={error}
        reset={reset}
        boundary="onboarding"
        title="Setup could not continue"
        description="Your progress is saved. Try again, and contact support if it keeps happening."
      />
    </div>
  );
}
