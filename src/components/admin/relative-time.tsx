import * as React from "react";
import { formatRelative, formatInZone, type DateInput } from "@/lib/dates";

/**
 * "3 minutes ago" for admin tables. Relative text moves on between the server
 * render and hydration ("just now" -> "1 minute ago"), which React reports as
 * a hydration error and re-renders the whole tree; this span tolerates that
 * one-word drift and keeps the exact time on hover.
 */
export function RelativeTime({
  value,
  options,
}: {
  value: DateInput;
  options?: { style?: "auto" | "ago" };
}) {
  const exact = value ? formatInZone(value, "datetime") : undefined;
  return (
    <span suppressHydrationWarning title={exact}>
      {formatRelative(value, options)}
    </span>
  );
}
