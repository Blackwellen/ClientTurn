"use client";

import * as React from "react";
import { Compass } from "lucide-react";
import { cn } from "@/lib/cn";
import { requestProductTour, requestSectionTour } from "@/lib/tour/events";

/**
 * "Take the product tour" — starts the shell's tour from anywhere. With a
 * `section`, it starts that page's own tour instead, navigating there first
 * when needed (Phase 8.29).
 */
export function ReplayTourButton({
  className,
  label = "Take the product tour",
  section,
  onStart,
}: {
  className?: string;
  label?: string;
  /** A `SectionKey` from `@/lib/tour/model`. Omit for the first-use tour. */
  section?: string;
  /** Called first, e.g. to close the panel the button lives in. */
  onStart?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onStart?.();
        if (section) requestSectionTour(section);
        else requestProductTour();
      }}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-content shadow-xs",
        "hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        className,
      )}
    >
      <Compass className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
