---
title: Who reactivation will not contact
summary: The people a reactivation campaign always leaves out, why, and the further checks every message passes at the moment it is sent
category: reactivation
keywords: [excluded, suppressed, not sent, why not contacted, opted out, invalid number, active conversation, recently contacted, cooldown, already booked, won, consent, blocked message, suppression reasons]
order: 60
updated: 2026-09-26
---

A reactivation campaign never messages everyone in its audience. Two sets of checks decide who is left out.

## 1. Excluded from the audience

These people are removed when the audience is built. The builder shows how many under **Automatically suppressed**, and the review step lists them under **Suppression reasons**. Each person is counted once, under the first reason that applies:

| Reason | Who |
|---|---|
| Opted out | Anyone who opted out of your messages |
| Invalid number | No usable address on the campaign's channel, such as no valid mobile for SMS or no email for an email campaign |
| Deleted / suppressed | Anyone on your do-not-contact list |
| Active conversation | Anyone whose conversation a person on your team has taken over |
| Recently contacted | Anyone you contacted within the cooldown, 30 days by default |
| Won customers | Leads marked won |
| Already booked | Leads who have booked |

## 2. Checked again before each message

Between launch and sending, things change. So every message is checked again at the moment it is sent:

- **Opt-outs and suppression**, in case the person opted out since launch.
- **Replies and bookings.** Someone who has replied or booked since does not get the follow-up message.
- **Contact rules.** Imported contacts who are not confirmed companies need a relationship or consent on record. See [Reactivating a CSV list](/help/reactivation/reactivating-a-csv-list).
- **WhatsApp opt-in and templates**, for WhatsApp campaigns. See [WhatsApp templates for reactivation](/help/reactivation/whatsapp-templates-for-reactivation).
- **Quiet hours.** The message waits until the next permitted time rather than being dropped.
- **Your limits.** A daily limit makes it wait until tomorrow. A used-up monthly allowance with no credit and no overage stops it. See [Usage and limits](/help/billing/usage-and-limits).
- **Your subscription.** If a payment has failed and sending is paused, messages wait until it is paid. See [What happens if a payment fails](/help/billing/failed-payments).

A message that is refused is not lost silently: the reason is recorded on it. A message that is only waiting goes out as soon as it is allowed.

## If a campaign reaches fewer people than you expected

1. Check **Automatically suppressed** in the builder and **Suppression reasons** on the review step.
2. Relax a filter if it is too tight, for example **Has no reply** or the **Cooldown (not contacted in)** period.
3. For SMS or WhatsApp, check that your leads have mobile numbers. For email, check they have email addresses.
4. Check the campaign's results for failed messages, and open one of those leads to see why.

> **Note:** You cannot override these exclusions from the campaign. They exist so that nobody is contacted who asked not to be, or who should not be.

## Related

- [Reactivation overview](/help/reactivation/reactivation-overview)
- [Suppression, STOP and unsubscribe](/help/compliance/suppression-and-unsubscribe)
- [Compliance overview](/help/compliance/compliance-overview)
