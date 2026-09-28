---
title: Booking with Calendly
summary: Send qualified leads your Calendly link and have the booking recorded against the lead automatically when they choose a time, including reschedules and cancellations
category: booking-and-sales
keywords: [calendly, booking link, scheduling link, calendly webhook, reschedule, cancel, booked, event type, connect calendly]
order: 30
updated: 2026-09-26
screenshots:
  - src: /help/screenshots/booking-and-sales/booking-with-calendly-1.png
    alt: "The booking card with the Calendly option selected, the Calendly event type and the booking link field"
    caption: "Choose Calendly, its event type and the link leads should use"
---

With Calendly, qualified leads are sent your Calendly link and book the time themselves on Calendly. ClientTurn cannot create a Calendly booking on the lead's behalf, so it never tells a lead they are booked until Calendly reports that they are.

## Set it up

1. Open **Settings → Connections** and find **Calendly** under **Booking**.
2. Choose **Connect** and sign in to Calendly.
3. Open **Settings → Workspace**. Under **How qualified leads book**, choose **Calendly**.
4. In **Calendly event type**, paste the address of the event type you want leads booked into. Open the event type in Calendly and copy its page address, which looks like `https://calendly.com/event_types/…`. The assistant uses it to offer real times from that event type.
5. In **Booking link**, paste the Calendly link you want leads to use. It must start with `https://`.
6. Choose **Save booking settings**.

Without an event type, the assistant cannot read your Calendly availability: it sends your booking link instead, or hands the lead to a person.

## What happens

1. The lead qualifies.
2. They are sent your booking link. If the conversation assistant is talking to them and they have already named a time, it asks them to pick that time on Calendly.
3. They choose a time on Calendly.
4. Calendly tells ClientTurn. The booking is recorded against the lead, the lead moves to **Booked**, and automatic follow-up stops.

ClientTurn finds the lead by the phone number or email address used on Calendly. If it cannot match anyone, you get a notification so you can check it.

## Reschedules and cancellations

When a lead reschedules on Calendly, the same booking moves to the new time. When they cancel, the booking is marked cancelled, the lead goes back from **Booked** to **Qualified**, and any booking reminder for that meeting stops.

## Sending the link yourself

On any lead, choose **Actions → Send booking link**. It is sent on your default channel.

## Disconnecting

Disconnecting stops booking links being sent automatically and stops Calendly bookings being recorded against leads.

## Related

- [Managing bookings](/help/booking-and-sales/managing-bookings)
- [Booking with Google Calendar](/help/booking-and-sales/booking-with-google-calendar)
- [Manual bookings and confirmation](/help/booking-and-sales/manual-bookings-and-confirmation)
