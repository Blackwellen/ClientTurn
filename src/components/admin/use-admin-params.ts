"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Admin filter state lives in the URL so a view can be shared with another
 * operator, survives back/forward, and re-renders on the server with the same
 * data the sender saw. `null` removes a parameter rather than writing an
 * empty one.
 */
export function useAdminParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  return { setParams, pending };
}
