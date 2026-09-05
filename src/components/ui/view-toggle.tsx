"use client";

import * as React from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/cn";
import { SegmentedControl } from "./tabs";

export type ViewMode = "card" | "list";

/**
 * Card/list segmented switch, built on the shared `SegmentedControl` rather
 * than a bespoke control, so this stays reusable wherever a register offers
 * both a card grid and a table (leads today, others later).
 */
export function ViewToggle({
  value,
  onChange,
  size = "sm",
  className,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Switch view"
      className={cn("inline-flex", className)}
    >
      <SegmentedControl
        size={size}
        value={value}
        onChange={(next) => onChange(next as ViewMode)}
        items={[
          {
            value: "card",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <LayoutGrid className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">Cards</span>
              </span>
            ),
          },
          {
            value: "list",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <List className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">List</span>
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
