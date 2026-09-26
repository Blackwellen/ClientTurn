"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarX, Check, MoreHorizontal, UserX } from "lucide-react";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateBookingStatus } from "@/lib/bookings/actions";
import { BOOKING_STATUS_LABEL } from "@/lib/bookings/types";
import {
  staffBookingActions,
  type StaffBookingTarget,
} from "@/lib/bookings/staff-actions";

const ICONS: Record<StaffBookingTarget, typeof Check> = {
  scheduled: CalendarCheck,
  completed: Check,
  no_show: UserX,
  cancelled: CalendarX,
};

/**
 * Recording what actually happened at an appointment.
 *
 * `updateBookingStatus` has existed since the bookings module was written and
 * had no caller: the standalone `/app/bookings` page it was built for was
 * removed when the IA collapsed to five destinations, and nothing replaced the
 * control. A booking could therefore never leave `scheduled`, which meant
 * no-shows were invisible and booking→won conversion could not be measured at
 * all.
 *
 * It lives on the Dashboard rather than the lead drawer because the question
 * "which of yesterday's appointments actually happened?" is a daily sweep over
 * several bookings, not something you go lead by lead to answer.
 *
 * `relative z-10` because the row it sits in has a stretched link over it; the
 * provider link beside it does the same.
 *
 * A `pending` booking (a time the lead requested that no calendar confirmed,
 * B10) is offered "Confirm time" and "Decline" instead: confirming is the
 * moment the lead becomes BOOKED, and nothing else may do it.
 */
export function BookingOutcomeControl({
  bookingId,
  leadName,
  status = "scheduled",
}: {
  bookingId: string;
  leadName: string;
  status?: string;
}) {
  const isRequest = status === "pending";
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  function record(to: StaffBookingTarget) {
    startTransition(async () => {
      const result = await updateBookingStatus({ bookingId, status: to });

      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }

      if (isRequest) {
        toast({
          variant: "success",
          title: to === "scheduled" ? "Time confirmed" : "Requested time declined",
          description:
            to === "scheduled"
              ? `${leadName} is now booked. Let them know the time is confirmed.`
              : `${leadName} is back in Needs attention.`,
        });
      } else {
        toast({
          variant: "success",
          title: `Marked ${BOOKING_STATUS_LABEL[to].toLowerCase()}`,
          // A no-show or cancellation flags the lead for attention, which is the
          // part the operator would otherwise have to remember to do by hand.
          description:
            to === "completed" ? undefined : `${leadName} is back in Needs attention.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <span className="relative z-10 shrink-0">
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            size="sm"
            disabled={pending}
            label={
              isRequest
                ? `Confirm or decline ${leadName}'s requested time`
                : `Record the outcome of ${leadName}'s appointment`
            }
          >
            <MoreHorizontal className="size-4" />
          </IconButton>
        }
      >
        {staffBookingActions(status).map((action) => (
          <DropdownItem
            key={action.to}
            icon={ICONS[action.to]}
            destructive={action.destructive}
            onSelect={() => record(action.to)}
          >
            {action.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </span>
  );
}
