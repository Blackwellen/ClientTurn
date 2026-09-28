"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <RouteError
        error={error}
        reset={reset}
        boundary="auth"
        title="This page could not be loaded"
        description="Try again. If you were signing in, your account is unaffected."
        backHref="/login"
        backLabel="Back to sign in"
      />
    </div>
  );
}
