---
title: Connecting Calendly
summary: Send your Calendly link to qualified leads and record each booking against the right lead automatically
category: integrations
keywords: [calendly, booking link, scheduling, appointments, invitee, meeting booked, calendar]
order: 70
updated: 2026-09-26
screenshots:
  - src: /help/screenshots/integrations/connecting-calendly-1.png
    alt: "How qualified leads book with Calendly selected, the Calendly event type and the booking link"
    caption: "Choose the event type the assistant offers times from"
---

With Calendly connected, a qualified lead is sent your Calendly link, and when they book, the booking is recorded against them in ClientTurn.

## Connect Calendly

1. Open **Settings → Connections**, find **Calendly** under **Booking** and choose **Connect**, then **Connect** again in the panel.
2. Sign in to Calendly and approve access.
3. ClientTurn subscribes to your organisation's booking notifications, so new bookings and cancellations are reported back automatically.

## Use it for bookings

1. Open **Settings → Workspace** and find **How qualified leads book**.
2. Choose **Calendly**. The option is only available once Calendly is connected.
3. Under **Appointment shape**, set the **Booking link** to the Calendly link you want leads to receive. It must start with `https://`.

## How bookings are matched

When someone books, Calendly tells ClientTurn the invitee's email address, and the booking is attached to the lead with that email. A reschedule updates the same booking rather than creating a second one, and a cancellation is recorded as cancelled.

If a booking arrives for an email address that matches no lead, you are notified with the details so someone can attach it by hand.

> **Tip:** Leads who book with a different email address from the one they gave you will not be matched automatically. Asking for the same email in your Calendly form keeps matching reliable.

## Related

- [Connecting Google Calendar](/help/integrations/connecting-google-calendar)
- [Managing bookings](/help/booking-and-sales/managing-bookings)
