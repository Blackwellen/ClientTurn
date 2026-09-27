# Upsell plan (2026-09-27)

Owner brief: "analyse and assess areas we can add pop-ups for upsells; be careful as it can
annoy customers". What we offer: **AI token packs**, **WhatsApp tokens** (Growth and above),
and **a higher tier**. Every offer reads its price and size from the catalogue
(`plans.ts`, `tokens.ts`, `whatsapp-tokens.ts`). Nothing is hard-coded in copy.

Code: `src/lib/billing/upsell-moments.ts` (pure decision), `upsell-service.ts` (reads),
`upsell-actions.ts` (events, setting), `components/billing/upsell-moment*.tsx` (UI).
Persistence: migration `0149_upsell_moments.sql` (`upsell_events`,
`business_settings.upgrade_suggestions_enabled`, `subscription_welcome_emails`).

## Candidates

| # | Moment (key) | Trigger | Offer | Expected value | Annoyance risk | Verdict |
|---|---|---|---|---|---|---|
| 1 | AI paused (`ai_paused`) | AI tokens used up (state `EXHAUSTED`) | AI token pack | High: the assistant has stopped replying, a pack restores it now | Low: it names a real blocker | **Build. Modal on the Dashboard** (blocker), banner elsewhere |
| 2 | AI tokens low (`ai_tokens_low`) | AI tokens at 80% or more (`TOKEN_WARN_PERCENT`) | AI token pack | Medium: prevents the pause above | Medium | **Build. Banner only** |
| 3 | Lead waiting on WhatsApp (`whatsapp_lead_waiting`) | In the last 7 days a lead messaged on WhatsApp, or asked to use WhatsApp ("can I WhatsApp you?"), and WhatsApp cannot be sent | Starter: a higher tier (WhatsApp is Growth and above). Growth and above with no WhatsApp tokens: a WhatsApp token pack | High: a named lead is waiting | Low: it is about their lead, not about us | **Build. Modal on the Dashboard** (blocker), banner on that lead's page |
| 4 | Lead cap approaching (`lead_cap_approaching`) | New leads at 80% or 95% of the plan's cap | Higher tier | Medium | Medium | **Build. Banner only** |
| 5 | Lead cap two months running (`lead_cap_repeated`) | Last period's leads reached the cap and this period is at 80% or more | Higher tier | High: a structural fit problem | Low | **Build. Banner only**, ranks above #4 |
| 6 | Feature gate: seats (`seats_full`) | Team members at the plan's user limit | Higher tier (only when it raises the limit) | Medium | Low | **Build. Banner only** |
| 7 | Feature gate: Find Leads prospects (`prospects_cap`) | Verified prospects at the plan's allowance | Higher tier | Medium | Low | **Build. Banner only** |
| 8 | Feature gate: agents | n/a | n/a | None: no plan caps agents today, so there is nothing to sell | n/a | **Rejected** (never invent a limit) |
| 9 | Booked meeting milestone (`bookings_milestone`) | Meetings booked this period reach 10, 25, 50 or 100 | A soft mention of the next tier | Low to medium; positive moment | Low if soft | **Build. Inline card on the Dashboard**, once per milestone |
| 10 | Billing page, passive (`billing_passive`) | Always, in Settings, Billing | AI token packs, WhatsApp tokens (where the plan allows), next tier | Medium | Very low: the owner came to buy | **Build. Non-modal card**, not frequency-capped, not dismissible |
| 11 | Usage trend projects over the cap (`usage_projection`) | 7 or more days into a period, this period's lead rate projects over the cap while usage is still under 80% | Higher tier | Medium | Medium | **Build. Banner only** |
| 12 | SMS running low | Already owned by `allowance-alerts.ts` (banner, notification, Usage & limits) | SMS pack | n/a | High if duplicated | **Rejected as a separate upsell**: never duplicated or contradicted |
| 13 | Composer, onboarding, checkout, trial | Any | Any | n/a | High | **Rejected**: never mid-task; the trial has its own prompt |

## Rules (enforced in `decideUpsellMoment`)

| Rule | How |
|---|---|
| Owner and admin only | Other roles get nothing. Only the owner sees buy buttons; an admin is told the owner can buy in Billing. |
| Setting off | "Show me upgrade suggestions" (Settings, Billing, default on) off hides every moment, including the Billing card. |
| Never in a trial | `plan === "trial"` or state `TRIALING`: nothing. The trial has its own upgrade prompt. No top ups are sold in a trial. |
| Only a working paid subscription | Past due, cancelled or read only: nothing (the dunning banner owns that screen). |
| Never mid-task | Surfaces `composer`, `onboarding` and `checkout` get nothing. Modals only on the Dashboard; the lead page gets banners. |
| One at a time | The highest priority eligible moment wins; one upsell per page. |
| Never contradicts running low | While a billing notice (running low, dunning, trial) shows, only the two blockers (#1, #3) can show, and as banners. A WhatsApp pack suggestion uses `allowance-alerts` `recommendBundle`. |
| Modal cap | At most 1 modal per user per 7 days, and at most 1 modal per offer per 30 days. Otherwise the moment falls back to a banner. |
| Dismiss = snooze 30 days | A dismissal hides that moment for that user for 30 days. |
| Recently bought | A purchase of the same offer in the last 30 days hides that offer. |
| Honest upgrades | A tier is offered only when the next tier raises the limit in question (`upsellFor` rule). Enterprise is "contact sales". |
| Upgrade keeps the interval | The tier CTA uses `startPlanCheckout` without an interval, so annual stays annual, after a confirm step that states the charge is pro rata today. |

## Analytics

`upsell_events` rows: `impression` (at most once a day per user, moment and surface),
`click`, `dismiss`, `purchase`. Purchases are attributed to the last click on the same
offer in the previous 7 days: token and WhatsApp packs from the Stripe webhook, tier
upgrades from `startPlanCheckout` when the change applies.

## Welcome email on subscription

Sent once per Stripe subscription (marker table `subscription_welcome_emails`, plus the job
idempotency key) when it becomes `ACTIVE` on a paid plan: trial conversion or direct
subscribe. To the owner only, through `notification.send`, so it counts against the daily
system email cap. Covers what the plan includes, AI token packs, WhatsApp tokens (or
"available on Growth and above" on Starter), how to buy, and the non refundable once used
note. No voice teaser (owner, 2026-09-27: voice gets its own surfaces once it can be bought).
