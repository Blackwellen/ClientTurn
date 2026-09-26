import * as React from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import type { BookingListRow } from "@/lib/bookings/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/page-header";
import { BookingOutcomeControl } from "./booking-outcome-control";
import { dateBlock, timeRange } from "./upcoming-bookings-card";

/**
 * Times a lead requested that no calendar confirmed (B10, decision Q1).
 *
 * The lead has been told "someone from the team will be in touch to confirm
 * it", so every row here is a promise waiting on a person. Confirming makes
 * the booking `scheduled` and the lead BOOKED; declining cancels it and puts
 * the lead back in Needs attention.
 */
export function PendingBookingsCard({
  rows,
  total,
  failed,
  timezone,
}: {
  rows: BookingListRow[];
  total: number;
  failed: boolean;
  timezone: string;
}) {
  const more = total - rows.length;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Awaiting confirmation"
          description="Times leads asked for that no calendar confirmed."
          dense
        />
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {failed ? (
          <ErrorState
            title="Requested times could not be loaded"
            description="Refresh the page to try again. Nothing has been changed."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Nothing waiting to confirm"
            description="When a lead picks a time your calendar cannot confirm, it appears here for you to confirm or decline."
          />
        ) : (
          <>
            <ul className="divide-line-subtle divide-y">
              {rows.map((row) => {
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
                    <StatusBadge kind="booking" value={row.status} dense />
                    <BookingOutcomeControl
                      bookingId={row.id}
                      leadName={row.leadName}
                      status={row.status}
                    />
                  </li>
                );
              })}
            </ul>
            {more > 0 && (
              <p className="text-content-muted mt-2 text-[12px]">
                {more.toLocaleString("en-GB")} more waiting. Confirm these first and
                the next ones appear here.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
