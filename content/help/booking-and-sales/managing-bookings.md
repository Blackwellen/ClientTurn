---
title: Managing bookings
summary: Choose how qualified leads book, where bookings appear, what each booking status means, and how booking reminders work
category: booking-and-sales
keywords: [bookings, calendar, calendly, google calendar, availability, appointments, booking status, upcoming bookings, awaiting confirmation, booking reminders, stop conditions]
order: 10
updated: 2026-09-26
---

When a lead qualifies, ClientTurn moves them towards a booking using the method you choose. It never invents a free time and never tells a lead they are booked until something has confirmed it.

## Choose a booking method

Open **Settings → Workspace → How qualified leads book** and choose one:

| Method | What happens | Guide |
|---|---|---|
| Google Calendar | The assistant offers real free times from your calendar and books the one chosen | [Booking with Google Calendar](/help/booking-and-sales/booking-with-google-calendar) |
| Calendly | The lead is sent your Calendly link and books there | [Booking with Calendly](/help/booking-and-sales/booking-with-calendly) |
| Manual link or handover | The lead is sent your booking link, or handed to your team to arrange | [Manual bookings and confirmation](/help/booking-and-sales/manual-bookings-and-confirmation) |

Connect Google Calendar or Calendly first, in **Settings → Connections**.

## Where bookings appear

- **Dashboard → Upcoming bookings:** scheduled meetings, with buttons to record what happened.
- **Dashboard → Awaiting confirmation:** times leads asked for that no calendar confirmed, for you to **Confirm time** or **Decline**.
- On the lead itself, with its status.

## Booking statuses

| Status | Meaning |
|---|---|
| Awaiting confirmation | The lead asked for this time, and a person needs to confirm it |
| Scheduled | Confirmed by the calendar, Calendly or a person |
| Completed | It went ahead |
| No show | The lead did not turn up |
| Cancelled | It was cancelled or declined |

A lead moves to **Booked** when a booking is scheduled, and automatic follow-up stops.

## Booking reminders

In **Follow-Up**, **Booking reminders** sends a reminder message to leads with an upcoming appointment. Owners and admins can set it up and choose **Activate**.

Each reminder step's delay is counted **back from the start of the meeting**, not from when it was booked: a step set to 24 hours is sent 24 hours before the meeting starts.

- If that moment falls in quiet hours, the reminder is sent earlier, at the last time before quiet hours begin. It is never moved later, where it could land after the meeting.
- If the moment has already passed, for example a meeting booked two hours ahead has no "24 hours before" moment, that step is skipped rather than sent late.
- A rescheduled meeting moves its reminders to the new start. A cancelled meeting stops them.

Every stop condition, including opt-outs and quiet hours, is checked again before each reminder is sent.

> **Note:** A lead reply, a booking, an opt-out or a human takeover stops automatic follow-up. Booking reminders are the exception to the booking stop, because they exist for booked leads.

## Related

- [Meeting types and routing](/help/booking-and-sales/meeting-types-and-routing)
- [Opportunities, won and lost](/help/booking-and-sales/opportunities-and-won-lost)
- [How qualification works](/help/qualifying/how-qualification-works)
