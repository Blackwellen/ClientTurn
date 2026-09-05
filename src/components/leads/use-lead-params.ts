"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Every piece of Leads state lives in the URL: quick filter, advanced
 * filters, search, sort, page, view and the open lead. That makes the page
 * deep-linkable, survives a refresh, and makes the browser Back button close
 * the drawer rather than leave the inbox.
 *
 * `replace` is used for view/pagination/filter changes (they are refinements,
 * not destinations) and `push` for opening a lead, so Back closes the drawer.
 */
export function useLeadParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const href = React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );

  const setParams = React.useCallback(
    (patch: Record<string, string | null>, mode: "replace" | "push" = "replace") => {
      const url = href(patch);
      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [href, router],
  );

  /** Any change to the result set invalidates the current page offset. */
  const setFilter = React.useCallback(
    (patch: Record<string, string | null>) => setParams({ ...patch, page: null }),
    [setParams],
  );

  const openLead = React.useCallback(
    (leadId: string) => setParams({ lead: leadId }, "push"),
    [setParams],
  );

  const closeLead = React.useCallback(
    () => setParams({ lead: null, leadTab: null }),
    [setParams],
  );

  /** Clears advanced filters and search but keeps the quick filter and view. */
  const clearFilters = React.useCallback(() => {
    const params = new URLSearchParams();
    for (const key of ["quick", "view", "lead"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return { href, setParams, setFilter, openLead, closeLead, clearFilters };
}
