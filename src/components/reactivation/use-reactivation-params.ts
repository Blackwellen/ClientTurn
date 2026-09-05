"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const VIEW_KEY = "clientturn.reactivation.view";
const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Mirrors `useLeadParams`: every piece of Reactivation state lives in the URL
 * — search, filters, sort, view, page and the open campaign — so a view is
 * shareable, survives a refresh, and Back closes the drawer rather than
 * leaving the page.
 *
 * `replace` is used for refinements (filters, sort, view, pagination) and
 * `push` for opening a campaign, which is a destination.
 */
export function useReactivationParams() {
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
      return query ? pathname + "?" + query : pathname;
    },
    [pathname, searchParams],
  );

  const setParams = React.useCallback(
    (
      patch: Record<string, string | null>,
      mode: "replace" | "push" = "replace",
    ) => {
      const url = href(patch);
      if (mode === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [href, router],
  );

  /** Any change to the result set invalidates the current page offset. */
  const setFilter = React.useCallback(
    (patch: Record<string, string | null>) =>
      setParams({ ...patch, page: null }),
    [setParams],
  );

  const setView = React.useCallback(
    (view: string) => {
      persistView(view);
      // Page size differs per view (8 cards / 10 rows), so the offset is
      // dropped and re-derived rather than carried across. Search, filters
      // and sort are untouched.
      setParams({ view, page: null });
    },
    [setParams],
  );

  const openCampaign = React.useCallback(
    (id: string) => setParams({ campaign: id, tab: null }, "push"),
    [setParams],
  );

  const closeCampaign = React.useCallback(
    () => setParams({ campaign: null, tab: null }),
    [setParams],
  );

  /** Clears search and every filter, but keeps the view and sort. */
  const clearFilters = React.useCallback(() => {
    const params = new URLSearchParams();
    for (const key of ["view", "sort", "campaign"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? pathname + "?" + query : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return {
    href,
    setParams,
    setFilter,
    setView,
    openCampaign,
    closeCampaign,
    clearFilters,
  };
}

/**
 * The view preference is written to a cookie as well as localStorage so the
 * server renders the right view on first paint — the same approach the shell
 * uses for the collapsed sidebar, and why a list-view user never sees a flash
 * of cards.
 */
function persistView(view: string) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage unavailable; the cookie below still carries the preference.
  }
  try {
    document.cookie =
      VIEW_KEY + "=" + view + "; path=/; max-age=" + VIEW_COOKIE_MAX_AGE +
      "; SameSite=Lax";
  } catch {
    // Cookies unavailable; the view resets to the default next visit.
  }
}

export const REACTIVATION_VIEW_COOKIE = VIEW_KEY;
