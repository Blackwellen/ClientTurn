"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarX, Check, MoreHorizontal, UserX } from "lucide-react";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateBookingStatus } from "@/lib/bookings/actions";
import { BOOKING_STATUS_LABEL } from "@/lib/bookings/types";

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
 */
export function BookingOutcomeControl({
  bookingId,
  leadName,
}: {
  bookingId: string;
  leadName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  function record(status: "completed" | "no_show" | "cancelled") {
    startTransition(async () => {
      const result = await updateBookingStatus({ bookingId, status });

      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }

      toast({
        variant: "success",
        title: `Marked ${BOOKING_STATUS_LABEL[status].toLowerCase()}`,
        // A no-show or cancellation flags the lead for attention, which is the
        // part the operator would otherwise have to remember to do by hand.
        description:
          status === "completed"
            ? undefined
            : `${leadName} is back in Needs attention.`,
      });
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
            label={`Record the outcome of ${leadName}'s appointment`}
          >
            <MoreHorizontal className="size-4" />
          </IconButton>
        }
      >
        <DropdownItem icon={Check} onSelect={() => record("completed")}>
          It went ahead
        </DropdownItem>
        <DropdownItem icon={UserX} onSelect={() => record("no_show")}>
          They did not turn up
        </DropdownItem>
        <DropdownItem icon={CalendarX} destructive onSelect={() => record("cancelled")}>
          It was cancelled
        </DropdownItem>
      </DropdownMenu>
    </span>
  );
}
