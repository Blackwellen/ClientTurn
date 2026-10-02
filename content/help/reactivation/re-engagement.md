---
title: Re-engagement check-ins, no-shows and win-back
summary: How ClientTurn gets back in touch when a lead asked you to, when someone misses a meeting, and after a lost deal, and the limits that stop any lead being contacted too often
category: reactivation
keywords: [re-engagement, not now, try me later, resume, check in, deadline, timeframe, no-show, missed meeting, rebook, win-back, lost deal, contact frequency, too many messages, dead lead, best time to send, cost-aware]
order: 15
updated: 2026-09-30
---

Some follow-up should happen at a moment the lead chose, not when a timer fires. ClientTurn does three things on its own, and holds every automated message to one set of contact limits.

## When a lead says "not now"

When a lead replies "not right now, try me in March" or "after Christmas", ClientTurn records when they asked to be contacted. At that time it checks in once. If the AI assistant is on for that channel, it writes the check-in from the conversation, so it can refer to what the lead said. If not, a short standard message is sent.

When a lead names a date or a timeframe ("we need this live by 1 December"), ClientTurn checks in the day after that date.

The check-in is cancelled if, by then, the lead has opted out, booked, been marked won or lost, been taken over by a person, said something newer about timing, or is already talking to you.

## When someone misses a meeting

When you mark a booking as **They did not turn up**, the lead gets a rebooking message within the hour. It offers up to three free times from your connected calendar, or your booking link, or asks when suits. One reminder follows a day later. Both stop if the lead replies or books again.

## When a deal is lost

When you mark a deal lost with a reason, ClientTurn sends one win-back message later. The delay depends on the reason:

| Reason | When |
|---|---|
| Price | About 75 days later. If you have approved checkout links, the first one can be included with its exact price. No discount is ever offered. |
| Timing | At the time the lead gave, otherwise 90 days later |
| Competitor | About 120 days later |
| No response | 60 days later |
| No need, Other | Never |

A reason that says the person asked not to be contacted, was not a fit or has closed down is never followed up, whatever its category.

## Contact limits across everything

Every automated message a lead gets counts towards one set of limits: follow-up sequences, reactivation campaigns, check-ins, win-back and no-show messages, and checkout reminders. By default a lead gets at most:

- **1 automated message a day.** A second one waits until the next day.
- **3 a week** and **6 in 30 days.** Anything over these is skipped, and the reason is recorded on the message.

After **4 automated messages in a row** with no reply (and no open, where opens can be seen) from a lead showing little interest, automated follow-up to that lead stops until they respond. You can still message them yourself.

Your own messages and the assistant's replies to a lead who wrote in are never limited. The first three days after an enquiry follow your sequence's own timing, so a new lead still gets a fast response.

Change the limits, within safe bounds, or switch any of the three checks off in **Follow-Up → Settings → Contact frequency & re-engagement**. Only owners and admins can change them.

## Channel and timing

Check-ins, win-back and no-show messages go by email from your connected mailbox to a lead who has not engaged, and by SMS to a lead who replies by text. See [SMS reactivation](/help/reactivation/sms-reactivation).

Check-ins and win-back go at the hour the lead has replied in before, or your leads' most common reply hour, or Tuesday to Thursday at 10am. No-show messages go straight away. Quiet hours and every contact rule are checked again at the moment each message is sent. See [Who reactivation will not contact](/help/reactivation/who-reactivation-will-not-contact).

## See the results

**Analytics → Re-engagement performance** shows each of these, alongside sequences and campaigns: leads reached, meetings booked, sales won and their value, opt-outs and complaints, and usage in SMS segments and AI credits. Reply rate is shown last and is not used to rank anything.
