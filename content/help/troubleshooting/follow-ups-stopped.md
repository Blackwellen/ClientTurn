---
title: Follow-ups stopped
summary: Why a lead's follow-up sequence stopped or hasn't started, and when the next step will go
category: troubleshooting
keywords: [follow up stopped, sequence stopped, no follow up, automation paused, quiet hours, human takeover, opted out, next step]
order: 80
updated: 2026-09-29
---

Follow-up stops on purpose in several situations. For one lead, open the lead and read **Why hasn't anything happened?**. For the whole workspace, open **Settings → System check**.

## Why a sequence stops

Before every message, ClientTurn checks again whether it should still go. A sequence stops when:

| Reason | What happens |
|---|---|
| The lead replied | Follow-up stops so a person, or the AI assistant, can answer them |
| The lead booked | Follow-up stops; booking reminders still go |
| Marked won or lost | Nothing automatic is sent |
| The lead opted out | Nothing is sent again, and that can't be overridden |
| A person took over | Automation stays quiet until the conversation is handed back |
| Automation paused on the lead | Resume it from the lead's actions |
| Sending paused by billing | A failed payment or ended subscription pauses sending; leads are still captured |
| The channel can't send | A connection needs attention: see **Settings → System check** |
| Every contact route is suppressed | The lead's addresses are on your suppression list |

## When it hasn't stopped, just waited

- **Quiet hours**: messages due during quiet hours are held, not dropped, and go when quiet hours end. **Why hasn't anything happened?** shows the exact time.
- **Waiting for their reply**: the last step has gone and the next is scheduled; the card shows when.
- **No lawful channel**: if the lead may not be contacted on any channel you use (for example no consent where it's needed), nothing is sent until that changes.

## Related

- [Using System check](/help/troubleshooting/using-system-check)
- [Taking over a conversation](/help/booking-and-sales/taking-over-a-conversation)
