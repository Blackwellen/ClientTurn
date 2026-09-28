"use client";

import { RouteError } from "@/components/ui/route-error";

/** Route boundary: friendly copy, retry, a way back and a support reference (see RouteError). */
export default function AdminLoginError({
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
        boundary="admin.login"
        title="Sign-in could not be loaded"
        description="Try again. Nothing about your account has changed."
      />
    </div>
  );
}
