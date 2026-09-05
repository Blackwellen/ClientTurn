import * as React from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  Megaphone,
  MessageSquare,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import type { HealthStripItem, HealthStripStatus } from "@/lib/dashboard/types";

// Lucide dropped brand marks, and shipping Meta's own logo is a licensing
// question — a neutral advertising glyph carries the meaning without either.
const ICONS = {
  meta: Megaphone,
  messaging: MessageSquare,
  booking: CalendarClock,
  followup: Rocket,
} as const;

const TILE: Record<HealthStripStatus, string> = {
  healthy: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  error: "bg-danger-50 text-danger-600",
};

const PILL: Record<HealthStripStatus, "success" | "warning" | "danger"> = {
  healthy: "success",
  warning: "warning",
  error: "danger",
};

/**
 * One connected strip, not four floating cards — it answers a single question
 * at a glance: can a lead actually be contacted, qualified and booked right
 * now? Every status and secondary line is read from live integration state, so
 * a workspace never sees a green pill it has not earned.
 */
export function HealthStrip({ items }: { items: HealthStripItem[] }) {
  return (
    <div className="border-line bg-line grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = ICONS[item.key];
        return (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              "bg-surface group flex items-center gap-3 px-4 py-3 transition-colors",
              "hover:bg-surface-hover",
              "focus-visible:outline-content-accent focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                TILE[item.status],
              )}
            >
              <Icon className="size-4.5" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="text-content flex items-center gap-2 truncate text-[13px] font-medium">
                {item.label}
              </span>
              <span className="mt-1 flex items-center gap-2">
                <Badge tone={PILL[item.status]} dot className="py-0">
                  {item.statusLabel}
                </Badge>
              </span>
              <span className="text-content-muted mt-1 block truncate text-[12px]">
                {item.detail}
              </span>
            </span>

            <ChevronRight className="text-content-subtle group-hover:text-content-muted size-4 shrink-0 transition-colors" />
          </Link>
        );
      })}
    </div>
  );
}
