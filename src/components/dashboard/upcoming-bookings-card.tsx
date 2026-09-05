import * as React from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, ExternalLink } from "lucide-react";
import type { BookingListRow } from "@/lib/bookings/types";
import { formatTimeInZone } from "@/lib/bookings/types";
import { BOOKING_PROVIDER_LABEL } from "@/lib/bookings/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/app/page-header";

/** "THU" over "4 SEP", in the workspace's own timezone. */
function dateBlock(value: string | null, timezone: string) {
  if (!value) return { weekday: "—", day: "" };
  const date = new Date(value);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, ...options })
      .format(date)
      .toUpperCase();
  return {
    weekday: part({ weekday: "short" }),
    day: part({ day: "numeric", month: "short" }),
  };
}

function timeRange(row: BookingListRow, timezone: string) {
  if (!row.startsAt) return "Not scheduled";
  const start = formatTimeInZone(row.startsAt, timezone);
  if (!row.endsAt) return start;
  return `${start} – ${formatTimeInZone(row.endsAt, timezone)}`;
}

/**
 * Replaces the standalone Bookings module: what is coming up next, with a link
 * out to the provider's own event. Full booking detail stays on the lead.
 */
export function UpcomingBookingsCard({
  rows,
  timezone,
  destinationConfigured,
}: {
  rows: BookingListRow[];
  timezone: string;
  destinationConfigured: boolean;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Upcoming bookings"
          action={
            <Link
              href="/app/leads?tab=BOOKED"
              className="text-content-accent hover:text-accent-700 focus-visible:outline-content-accent rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              View all
            </Link>
          }
        />
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {!destinationConfigured ? (
          <EmptyState
            icon={CalendarClock}
            title="No booking destination configured"
            description="Connect Calendly or Google Calendar, or use human handover, so qualified leads can be booked."
            action={
              <Link
                href="/app/settings/workspace"
                className="text-content-accent text-[13px] font-medium"
              >
                Set a booking destination
              </Link>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No upcoming bookings"
            description="Appointments appear here as soon as a qualified lead books a slot."
          />
        ) : (
          <ul className="divide-line-subtle divide-y">
            {rows.map((row) => {
              const { weekday, day } = dateBlock(row.startsAt, timezone);
              return (
                <li key={row.id} className="group relative">
                  <div className="hover:bg-surface-hover -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-[var(--lr-duration-fast)]">
                    <span
                      aria-hidden
                      className="bg-surface-sunken border-line-subtle flex w-12 shrink-0 flex-col items-center rounded-lg border py-1.5"
                    >
                      <span className="text-content-muted text-[10px] font-semibold tracking-wide">
                        {weekday}
                      </span>
                      <span className="text-content text-[12px] font-semibold">
                        {day}
                      </span>
                    </span>

                    <span className="text-content lr-tabular w-[6.5rem] shrink-0 text-[12.5px] font-medium whitespace-nowrap">
                      {timeRange(row, timezone)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/app/leads?lead=${row.leadId}`}
                        className="text-content group-hover:text-content-accent block truncate text-[13px] font-medium after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        {row.leadName}
                      </Link>
                      <span className="text-content-muted block truncate text-[12px]">
                        {row.serviceName ?? "No service set"}
                      </span>
                    </span>

                    {row.bookingUrl ? (
                      <a
                        href={row.bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        // Sits above the stretched row link so the provider
                        // link stays reachable.
                        className="text-content-subtle hover:text-content-accent hover:bg-surface-active focus-visible:outline-content-accent relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2"
                        aria-label={`Open ${row.leadName}'s booking in ${
                          BOOKING_PROVIDER_LABEL[row.provider] ?? row.provider
                        }`}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : (
                      <span className="text-content-subtle shrink-0 text-[11px] whitespace-nowrap">
                        {BOOKING_PROVIDER_LABEL[row.provider] ?? row.provider}
                      </span>
                    )}

                    <ChevronRight
                      aria-hidden
                      className="text-content-subtle group-hover:text-content-muted size-4 shrink-0 transition-colors"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
