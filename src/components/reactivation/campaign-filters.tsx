"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import {
  CAMPAIGN_STATUS_OPTIONS,
  hasActiveReactivationFilters,
  type ReactivationFilters,
} from "@/lib/campaigns/reactivation-filters";

/**
 * `CampaignFilters` (spec §16.3): search + status filter for the reactivation
 * list. There is no dedicated popover primitive in this codebase yet, so the
 * status filter uses the same inline `Select` pattern as `LeadsFilterBar`
 * rather than introducing a new `FilterPopover` primitive for one field.
 */
export function CampaignFilters({ filters }: { filters: ReactivationFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  const update = React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      startTransition(() =>
        router.replace(query ? `${pathname}?${query}` : pathname),
      );
    },
    [pathname, router, searchParams],
  );

  const clearAll = () => update({ q: null, status: null });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        defaultValue={filters.q ?? ""}
        placeholder="Search campaigns"
        label="Search campaigns"
        onChange={(value) => update({ q: value || null })}
        className="w-full sm:w-72"
      />

      <Select
        aria-label="Status"
        value={filters.status}
        onChange={(event) =>
          update({ status: event.target.value === "all" ? null : event.target.value })
        }
        className="h-9 w-auto text-[13px]"
      >
        {CAMPAIGN_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      {hasActiveReactivationFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
