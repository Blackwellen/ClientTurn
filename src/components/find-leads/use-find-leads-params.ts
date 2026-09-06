"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProspectFilters } from "@/lib/prospects/filters";

export const FIND_LEADS_VIEW_COOKIE = "ct-find-leads-view";

/**
 * URL is the single source of truth for the Find Leads view state.
 *
 * Every filter, the active view and the open drawer all live in the query
 * string, so a shared link reproduces exactly what the sender was looking at
 * and the browser Back button steps through filter changes — the same contract
 * the Leads and Reactivation surfaces already keep.
 */
export function useFindLeadsParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const push = React.useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);

      // Any change to what is being filtered resets paging: staying on page 7
      // of a result set that now has two pages shows an empty table and reads
      // as a bug.
      if (!params.has("__keepPage")) params.delete("page");
      params.delete("__keepPage");

      const query = params.toString();
      const url = query ? `${pathname}?${query}` : pathname;

      startTransition(() => {
        if (options?.replace) router.replace(url, { scroll: false });
        else router.push(url, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      push((params) => {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      });
    },
    [push],
  );

  const setList = React.useCallback(
    (key: string, values: string[]) => {
      push((params) => {
        if (values.length === 0) params.delete(key);
        else params.set(key, values.join(","));
      });
    },
    [push],
  );

  /** Adds or removes one value from a multi-select filter. */
  const toggleInList = React.useCallback(
    (key: string, value: string, current: string[]) => {
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      setList(key, next);
    },
    [setList],
  );

  const setPage = React.useCallback(
    (page: number) => {
      push((params) => {
        params.set("__keepPage", "1");
        if (page <= 1) params.delete("page");
        else params.set("page", String(page));
      });
    },
    [push],
  );

  const setView = React.useCallback(
    (view: string) => {
      // Switching view discards the previous view's filters rather than
      // carrying, say, a grade filter into the Intent tab where it means
      // nothing.
      startTransition(() => {
        document.cookie = `${FIND_LEADS_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
        router.push(view === "discover" ? pathname : `${pathname}?view=${view}`, {
          scroll: false,
        });
      });
    },
    [pathname, router],
  );

  const openProspect = React.useCallback(
    (prospectId: string | null) => {
      push(
        (params) => {
          params.set("__keepPage", "1");
          if (prospectId) params.set("prospect", prospectId);
          else params.delete("prospect");
        },
        { replace: !prospectId },
      );
    },
    [push],
  );

  const clearFilters = React.useCallback(
    (filters: ProspectFilters) => {
      startTransition(() => {
        const params = new URLSearchParams();
        if (filters.view !== "discover") params.set("view", filters.view);
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  return {
    pending,
    setParam,
    setList,
    toggleInList,
    setPage,
    setView,
    openProspect,
    clearFilters,
  };
}
