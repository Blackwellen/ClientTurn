---
title: Usage and limits
summary: Where to see your use against every limit this period and today, what happens when you reach each one, and how daily sending limits and overage work
category: billing
keywords: [usage, allowance, quota, limit reached, daily limit, monthly limit, daily cap, overage, spend cap, lead limit, seats, 80%, meter, paused, sending stopped]
order: 25
updated: 2026-09-26
---

Every limit on your plan is shown in one place: **Settings → Billing & Usage → Usage & limits**. Limits are enforced at the moment a message is sent, not only shown on this page. Only the workspace owner can open Billing & Usage.

## The Usage & limits table

Each row is one limit. The columns are:

| Column | What it shows |
|---|---|
| Limit | The name of the limit |
| This period | Use so far this billing period, against the allowance |
| Today | Messages sent today against the daily limit, or **No daily limit** |
| Top-up credit | Credit you have bought for that channel |
| At the limit | What ClientTurn does when the limit is reached |

When any limit reaches 80%, a card appears under its row with the options that apply: the next plan, if it raises that limit, and top-up bundles for SMS and WhatsApp.

## What happens at each limit

| Limit | When it is reached |
|---|---|
| New leads | Leads keep being captured and followed up. A lead is never dropped because of a limit. If you often go over, the next plan fits better |
| SMS | Sends use top-up credit next, then overage if it is on and under your cap. Otherwise SMS sending stops until the period resets |
| WhatsApp | The same as SMS. WhatsApp needs Growth or above |
| Email (outreach) | Outreach email stops at the allowance, unless your plan allows overage and it is switched on |
| AI tokens | The assistant pauses. Follow-up and qualification rules keep running. Top up tokens to resume |
| Team members | New invitations are refused until a seat is freed or the plan is upgraded. Pending invitations count as seats |
| Verified prospects | Sourcing stops at the allowance unless overage is on |
| Sourcing runs | New runs are refused until the next period |

A message that is refused for a limit is not lost silently. The reason is recorded on the message, for example "This month's SMS allowance is used up and there is no top-up credit left".

## Daily sending limits

Monthly allowances control what you pay for. Daily limits control pace: they stop a large campaign from sending everything in one day.

- They count **messages**, not SMS segments.
- They reset at **midnight UTC**.
- They apply to automated follow-up and campaign sends. A reply you type yourself is not held back by them.
- A message over the daily limit is **held until the next day**, not dropped.

To change them, go to **Communication allocation → Daily sending limits (all channels)**. You can lower a limit. You cannot raise one above the ceiling shown under the box, which comes from the platform, your plan and, for email, the health of your sending identities. Choose **Save daily limits**.

## Overage

Overage is **off** until you switch it on. To switch it on:

1. In **Overage control**, set a **Monthly additional spend cap**.
2. Turn on **Allow automatic overage**.
3. Confirm in the **Turn on automatic overage?** dialog.

With overage on, sending continues past the allowance and is charged at your plan's rate, up to the cap. At the cap, sending stops. Switch it off at any time. Overage rates are in [Plans and what each includes](/help/billing/plans-and-pricing). There is no overage during a trial, and none for AI tokens.

## Other panels on the page

- **Usage this month** shows leads, messages and team members against the plan, and the date usage resets.
- **Monthly usage overview** covers prospects sourced, messages sent, intent monitors and search runs.
- **Communication allocation** lets you split your monthly message allowance between channels. It must total exactly 100%.
- **Channel usage** shows messages sent, delivery and replies per channel this month.
- **Usage history** shows past months.
- **AI allowance** shows tokens used and left, roughly how many assistant replies remain, and when the included allowance renews.

## Warnings you will see

- A banner across the app when this month's SMS or WhatsApp allowance passes 80%, and again when it is used up, unless top-up credit is covering it.
- A notification when AI token use passes 80% and again at 95%.

## Related

- [Top-up credits for AI, SMS and WhatsApp](/help/billing/top-up-credits)
- [Changing your plan](/help/billing/changing-your-plan)
- [Billing & Usage settings](/help/settings/billing-and-usage-settings)
