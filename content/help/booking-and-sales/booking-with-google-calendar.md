---
title: Booking with Google Calendar
summary: Connect Google Calendar so the assistant can offer real free times from your calendar and write confirmed meetings into it, with a calendar invite to the lead
category: booking-and-sales
keywords: [google calendar, gcal, availability, free slots, calendar invite, business hours, appointment duration, buffer, slot taken, double booking, connect calendar]
order: 20
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/booking-and-sales/booking-with-google-calendar-1.png
    alt: "The Google Calendar card in the Booking group with its Connect button"
    caption: "Connect Google Calendar from the Booking group in Settings, Connections"
---

With Google Calendar connected, the conversation assistant can offer a qualified lead real free times from your calendar and book the one they choose. A meeting only counts as booked once Google has accepted the event.

## Connect it

1. Open **Settings → Connections** and find **Google Calendar** under **Booking**.
2. Choose **Connect** and sign in to the Google account whose calendar you want to use.
3. Open **Settings → Workspace**. Under **How qualified leads book**, choose **Google Calendar**.
4. Set the **Appointment shape**: **Appointment duration (minutes)** and **Buffer between appointments (minutes)**.
5. Choose **Save booking settings**.

Check your **Business hours** in **Settings → Workspace** too. Free times are only ever offered inside them.

## How a booking is made

1. The lead qualifies.
2. The assistant asks Google which times are busy, and works out free slots inside your business hours, allowing for the appointment length and buffer. It offers a few of them.
3. The assistant can only mention times that came from your calendar. A draft naming any other time is rejected before it is sent.
4. The lead picks a time. ClientTurn writes the event into your calendar.
5. Only when Google accepts it is the lead told "that is booked", with a calendar invite sent to their email address if they gave one. The lead moves to **Booked** and automatic follow-up stops.

If someone else has taken the time in the meantime, the lead is told so and offered other free times.

> **Note:** Offering calendar slots is done by the conversation assistant. It needs to be switched on in **Settings → Workspace → AI assistant**, set to **Reply automatically**. Without it, a qualified lead is sent your **Booking link** if you have set one, or handed to your team.

## If the calendar cannot confirm

If the connection has stopped working, ClientTurn does not pretend. The chosen time is recorded as a **request**, the lead is told it is not confirmed yet and someone will be in touch, and it appears on your Dashboard under **Awaiting confirmation**. See [Manual bookings and confirmation](/help/booking-and-sales/manual-bookings-and-confirmation).

The Google Calendar card in **Settings → Connections** shows **Reconnect required** when this happens.

## Different meeting lengths or people

To vary the length or buffer by service, use a different calendar, or share bookings across your team, add meeting types. See [Meeting types and routing](/help/booking-and-sales/meeting-types-and-routing).

## Disconnecting

Disconnecting stops qualified leads being offered calendar slots, and new appointments are no longer written to your calendar. Bookings already made stay in ClientTurn.

## Related

- [Managing bookings](/help/booking-and-sales/managing-bookings)
- [Booking with Calendly](/help/booking-and-sales/booking-with-calendly)
- [Workspace settings](/help/settings/workspace-settings)
