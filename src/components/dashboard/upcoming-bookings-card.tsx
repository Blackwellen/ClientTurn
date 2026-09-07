import * as React from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, ChevronRight } from "lucide-react";
import type { BookingListRow } from "@/lib/bookings/types";
import { formatTimeInZone } from "@/lib/bookings/types";
import { BOOKING_PROVIDER_LABEL } from "@/lib/bookings/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/app/page-header";
import { CardActionLink } from "./card-action-link";
import { BookingOutcomeControl } from "./booking-outcome-control";

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
  awaitingOutcome,
  timezone,
  destinationConfigured,
}: {
  rows: BookingListRow[];
  /**
   * Appointments whose time has passed while still `scheduled`.
   *
   * Shown above the upcoming list because it is the only part of this card that
   * needs a decision. Until this existed, a booking could never leave
   * `scheduled`: no-shows were invisible and booking-to-won conversion was
   * unmeasurable.
   */
  awaitingOutcome: BookingListRow[];
  timezone: string;
  destinationConfigured: boolean;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Upcoming bookings"
          action={<CardActionLink href="/app/leads?tab=BOOKED" />}
        />
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {awaitingOutcome.length > 0 && (
          <div className="border-line-subtle mb-3 border-b pb-3">
            <p className="text-content-muted mb-1.5 text-[11px] font-semibold tracking-[0.04em] uppercase">
              Did these happen?
            </p>
            <ul className="divide-line-subtle divide-y">
              {awaitingOutcome.map((row) => {
                const { weekday, day } = dateBlock(row.startsAt, timezone);
                return (
                  <li key={row.id} className="flex items-center gap-3 py-2">
                    <span aria-hidden className="w-12 shrink-0 text-center">
                      <span className="text-content-muted block text-[10px] leading-tight font-semibold tracking-[0.06em]">
                        {weekday}
                      </span>
                      <span className="text-content block text-[12.5px] leading-tight font-semibold">
                        {day}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/app/leads?lead=${row.leadId}`}
                        className="text-content hover:text-content-accent block truncate text-[13px] font-medium"
                      >
                        {row.leadName}
                      </Link>
                      <span className="text-content-muted block truncate text-[12px]">
                        {timeRange(row, timezone)}
                        {row.serviceName ? ` · ${row.serviceName}` : ""}
                      </span>
                    </span>
                    <BookingOutcomeControl bookingId={row.id} leadName={row.leadName} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!destinationConfigured ? (
          <EmptyState
            icon={CalendarClock}
            title="No booking destination configured"
            description="Connect Calendly or Google Calendar, or use human handover, so qualified leads can be booked."
            action={
              <Link
                href="/app/settings?section=workspace"
                className="text-content-accent text-[13px] font-medium"
              >
                Set a booking destination
              </Link>
            }
          />
        ) : rows.length === 0 && awaitingOutcome.length === 0 ? (
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
                <li key={row.id} className="group relative has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-content-accent">
                  <div className="hover:bg-surface-hover -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-[var(--lr-duration-fast)]">
                    <span aria-hidden className="w-12 shrink-0 text-center">
                      <span className="text-content-muted block text-[10px] leading-tight font-semibold tracking-[0.06em]">
                        {weekday}
                      </span>
                      <span className="text-content block text-[12.5px] leading-tight font-semibold">
                        {day}
                      </span>
                    </span>

                    <span className="text-content lr-tabular w-[6.5rem] shrink-0 text-[12.5px] font-medium whitespace-nowrap">
                      {timeRange(row, timezone)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/app/leads?lead=${row.leadId}`}
                        className="text-content group-hover:text-content-accent block truncate text-[13px] font-medium after:absolute after:inset-0 focus-visible:outline-none!"
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
                        className="text-info-600 hover:text-info-700 hover:bg-info-50 focus-visible:outline-content-accent relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2"
                        aria-label={`Open ${row.leadName}'s booking in ${
                          BOOKING_PROVIDER_LABEL[row.provider] ?? row.provider
                        }`}
                      >
                        <CalendarDays className="size-4" />
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
