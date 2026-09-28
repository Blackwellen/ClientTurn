"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The app's notice stack (lib/banners/select.ts `stackNotices` orders it):
 * at most two notices visible, the rest behind one "N more notices" toggle so
 * a trial reminder, a payment problem and a maintenance notice never push the
 * page down by three banners at once.
 *
 * The collapsed notices are server-rendered inside a `hidden` region, so
 * expanding them shifts nothing the person did not ask to move.
 */
export function NoticeStack({
  visible,
  collapsed,
  className,
}: {
  visible: React.ReactNode[];
  collapsed: React.ReactNode[];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();

  if (visible.length === 0 && collapsed.length === 0) return null;

  return (
    <div className={cn("mx-4 mt-3 space-y-2 sm:mx-6", className)}>
      {visible}
      {collapsed.length > 0 ? (
        <>
          <div id={regionId} hidden={!open} className="space-y-2">
            {collapsed}
          </div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-content-secondary",
              "hover:bg-surface-hover hover:text-content",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            )}
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")}
              aria-hidden
            />
            {open
              ? "Show fewer notices"
              : `${collapsed.length} more ${collapsed.length === 1 ? "notice" : "notices"}`}
          </button>
        </>
      ) : null}
    </div>
  );
}
