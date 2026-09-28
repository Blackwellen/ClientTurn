# 17 — Affiliate / partner programme audit

_2026-09-28. Scope: click → signup → trial → paid → renewals → refunds / disputes → payouts, tiers, partner portal, admin, public terms, security. Everything below was read in code, fixed in code, and pinned by tests. No live Stripe call was made. No payout was sent._

**Tests.**

- `tests/affiliate-audit.test.ts` (`test:g1`, 44 tests) covers the pure rules and the wiring checks.
- `tests/affiliate-ledger-chain.test.ts` (`test:g3`, 13 tests) runs the **real ledger code end to end** against an in-memory PostgREST behind `fetch` (`tests/fixtures/fake-postgrest.ts`). Stripe is replaced by an injected resolver.

**Migration:** `0166_affiliate_programme_hardening.sql` is written and **not applied**. Every code path works before it is applied: it skips and logs, and nothing becomes automatic.

**Design confirmed.** CLAUDE.md resolved conflict 8 is about *customers'* sales: their money goes to their own Stripe, with no Connect. Paying *our* affiliates is ClientTurn's own payout. The existing design is **Stripe Connect Express** transfers from the platform (`affiliates/stripe-connect.ts`), and that is kept. Connect accounts and transfers are now tagged `app=clientturn`.

Severity: **C** critical (money wrong or lost) · **H** high (compliance or abuse exposure) · **M** medium · **L** low.

## 1. Click tracking

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 1.1 | `/r` rate limit was 240/min per IP. One machine could add ~14k counted clicks an hour. The limiter's own table stored the **raw IP** as its key. | H | 20 clicks / 10 min per network. Keyed by a **keyed HMAC of the IP** (`fraud-rules.ts` `ipHash`), so the limiter holds no address. Over the limit, the visitor still reaches the page but is not counted or cookied. |
| 1.2 | Visitor hash kept forever: a stable salted hash of IP+UA is pseudonymous personal data with no retention. | H | `purge_affiliate_identifiers()` (0166), run by the daily ledger job. Hashes are replaced after **120 days**. Click rows are deleted after **400**. IP/device fingerprints expire after 120 days. Link counters survive. |
| 1.3 | Bot filter missed link previews and HTTP libraries: facebookexternalhit, WhatsApp, axios, node-fetch, Go, Postman, Playwright and others. Browser prefetch and prerender counted as clicks. | M | Patterns extended in `attribution-core.ts`. `isPrefetch` treats `Sec-Purpose` and `Purpose` prefetch/preview as automated. |
| 1.4 | The cookie window always used the **default** plan, even for a partner on a different plan. | M | `/r` reads the crediting partner's own `commission_plan_id`, clamped to 90 days. |
| 1.5 | Attribution rule. It was last-click in code, but not stated as a rule next to the code. | L | Documented in `/r`, `attribution.ts`, `describeAttribution` and the new terms. A test pins that every counted click overwrites the cookie. |
| 1.6 | No VPN or proxy signal. | L | `proxySuspected()` checks only the `Via` header and a forwarding chain longer than 2 hops. It is recorded as INFO on the click (`suspect_reasons`) and never blocks. There is no paid IP intelligence. |
| 1.7 | `attributeSignup` never wrote `source_link_id`. Per-link signups, trials and revenue were therefore always 0 in `affiliate_link_metrics`. | M | Fixed: the referral stores the clicked link. |
| 1.8 | **Referral cookie `ct_ref` has no consent and is missing from the Cookie Policy.** The ICO treats affiliate-tracking cookies as not strictly necessary. | H | **Owner decision** (see below). Not changed in code, because it is a legal call. |

## 2. Self-referral, duplicates, fraud

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 2.1 | Self-referral checked only `affiliate.user_id === signup user`, plus a daily scan for membership of the referred workspace. That scan was unordered, took the first 500 rows, and could re-read the same rows forever. | H | Signup screening (`attribution.ts` `screenSignup`, rules in `fraud-rules.ts`). **Reject** on: same user; same email, normalised for `+tags` and Gmail dots. **Hold** on: same company email domain (free-mail excluded); same device or network as the partner's portal sessions; signer already had a workspace. **Info** only: instant signup (under 5 s); proxy. Scan bounded to the last 60 days, newest first. |
| 2.2 | No payment-side check: same Stripe customer, same card. | H | Daily `checkPaidReferrals` in the ledger job. Stripe is read in the **job**, never in the webhook. **Reject** on: the referred customer is the partner's own Stripe customer; a card fingerprint matches; the partner is a member of the workspace. |
| 2.3 | A flagged referral stopped *new* accruals, but already-accrued PENDING commission was still auto-approved and paid. | C | `approve_due_commissions` and `claim_commissions_for_payout` (0166) skip positive money on a held referral. Negative clawback rows are always claimed. |
| 2.4 | No review queue. Clearing a flag lost every invoice skipped while it was held. | H | Admin → Affiliates → **Fraud review**. **Clear** lifts the hold and replays the paid invoices from `billing_invoices` (0165), keyed per invoice so nothing accrues twice. **Confirm** rejects, reverses unpaid commission, and claws back paid commission. Signals live in service-role-only `affiliate_fraud_flags`: the partner never learns which signal fired. |
| 2.5 | Coupon abuse. | L | Not reachable today: affiliate promo codes are **not wired to Stripe Checkout** (`stripe_promotion_code_id` is never set). A 100% coupon earns nothing anyway, because commission is on cash paid. Owner decision on whether promo attribution should exist. |

## 3. Attribution chain and ledger

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 3.1 | Commission was taken on `invoice.amount_paid`, which **includes VAT**. | C | Base = VAT-exclusive total after discounts, scaled to the cash actually paid when customer credit covered part (`ledger-rules.ts` `commissionBaseMinor`). The gross is kept in metadata as the scale for refunds. |
| 3.2 | Any paid invoice earned commission, including `manual` and other non-subscription invoices. | M | Only `subscription_create/cycle/update/threshold` invoices earn. Payments in a currency other than the plan's are skipped for an operator, not converted. |
| 3.3 | The recurring window counted **payments**, not months. An annual customer on a 12-month plan earned commission for 12 *years*. | C | Window = calendar months since the referral's first paid invoice (`commissionForPayment`). The payment index is the referral's own accrual count, so a held-and-skipped invoice cannot shift it. |
| 3.4 | Partial refunds: an unpaid entry was flipped to REVERSED in **full** while reporting a proportional amount. | C | Rewritten (`reverseInvoiceCommission`). See 3.5 and 3.6. |
| 3.5 | Partial refunds: `charge.amount_refunded` is **cumulative**, and was treated as incremental. The paid-entry key `reversal:<invoice>:<entry>` also swallowed every refund after the first. | C | Target reversal = commission × cumulative-refunded ÷ gross, minus what has already been reversed net of re-accruals. Keyed on the cumulative amount. |
| 3.6 | The same reversal rewrite decides how each reversal is written. | C | An unpaid full reversal flips the entry. Anything else writes a negative REVERSAL row. That row mirrors PENDING while the accrual is still in its hold, and is APPROVED (a clawback) once the money is approved or paid. |
| 3.7 | **Refunds and disputes never found the invoice** on current Stripe API versions (`charge.invoice` removed in 2025-03-31+). The chargeback path also called `stripe.charges.retrieve` **inside the webhook** (a CLAUDE.md breach). | C | The webhook now only enqueues `affiliate.billing_event` (keyed on the event id). The job resolves the invoice: the event's id if present, otherwise `invoicePayments.list` for the PaymentIntent (`billing-events.ts`). |
| 3.8 | **A won dispute did not re-accrue** (the known gap in `BILLING.md`). | C | `charge.dispute.closed` with won, `warning_closed` or `prevented` → `reaccrueDisputedCommission`. It writes one REACCRUAL row per reversal that dispute made, keeps the original availability date, is keyed per dispute and row, and sets the referral back to PAID. A lost dispute changes nothing. |
| 3.9 | Approval used `created_at + hold_days` and ignored `available_at`. | M | 0166 `approve_due_commissions` uses `coalesce(available_at, created_at + hold)`. |
| 3.10 | Idempotency on invoice ids. | ok | Kept: `accrual:<invoice>` is unique, and every reversal and re-accrual is keyed. Replays are proven no-ops in the chain test. |

## 4. Tiers

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 4.1 | A `tier` column existed, but nothing read it. The UI said tiers "do not change your rate". | M | `affiliate_tiers` (0166) holds, per tier: thresholds by active referred customers **or** referred MRR (real MRR from 0165); a rate; recurring months. `effectivePlan` applies a tier to accrual, and never pays below the plan. |
| 4.2 | No recalculation, history or notification. | M | The daily ledger job runs `recalculateTiers`. Promotion is immediate; demotion happens only at the monthly review on the 1st. An admin lock holds a tier in place. Every change writes `affiliate_tier_history` and notifies the partner. |
| 4.3 | Sales-tier tracking: the partner could not see which plans their customers were on. | M | `salesTierBreakdown` shows active referred customers and MRR by plan, anonymised. It appears on the partner dashboard (Tier panel) and in the admin partner detail. |
| 4.4 | Seeded tiers carry **placeholder thresholds and no rate uplift**. | — | **Owner decision.** |

## 5. Payouts

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 5.1 | The monthly run created payouts directly as **APPROVED**. There was no approval step. | H | Payouts are raised as DRAFT, shown as **"Pending approval"**. Admin can approve one payout, or **Approve all** for the run. Approval sends nothing. Auto-approval and auto-sending are separate admin settings (`affiliate_programme_settings`, both OFF). Sending also needs `AFFILIATE_AUTO_PAYOUT=true` (`autoDispatchAllowed`). |
| 5.2 | **Retrying a failed payout reopened it with its old amount** while its commissions had already been released to the balance. The next run would have paid them **twice**. | C | `retryFailedPayout` re-claims the currently available commission into the payout, sets the amount to what was claimed, and returns it to DRAFT. If nothing is available, it is cancelled. |
| 5.3 | A payout raised and then netted below the threshold by clawbacks deleted itself, but left its entries PAYABLE with no payout. | M | Entries are released before the draft is deleted. A negative available balance never raises a payout. The partner is told how the deficit is recovered. |
| 5.4 | No cancel. Send and Retry existed as actions but had no buttons. Adjustments had no UI. The adjustment key (operator + reason) silently merged two genuine adjustments with the same wording. | M | Payout rows now have Approve, Send (with confirm), Retry, Cancel (commission released) and Mark paid. The partner detail has an audited adjustment form, keyed per form entry. |
| 5.5 | Tax and self-billing. | M | Stripe Express collects identity and tax. Statements now carry **remittance-advice** wording ("not a VAT invoice; send us a VAT invoice if registered"). They only switch to self-billing wording where a self-billing agreement exists (`selfBillingLines`). **Marked for owner review.** |

## 6. Partner dashboard

Already present: clicks, signups, trials, paid customers, conversion, commission pending/approved/paid, payout history and statements, links with UTMs and QR codes, resources.

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 6.1 | Missing: MRR referred, tier progress, sales tiers, negative-balance explanation, link to the terms. | M | `TierProgressPanel`, a new component. It is server-rendered, mobile-first and uses the existing panel primitives. |
| 6.2 | No `loading.tsx` or `error.tsx` under `/affiliates/app`. | M | Added: page skeleton, and `RouteError` with a way back. |
| 6.3 | Same-day referrals had identical anonymised labels. | L | `Referral · 4 Mar 2026 · #ABCD` (from the row id, non-identifying). |

## 7. Admin

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 7.1 | No partner detail, fraud queue, tier configuration, payout approval, programme settings or export. | H | New tabs **Fraud review** and **Tiers & settings**. Partner detail via `?affiliate=<id>` shows tier and override/lock, sales tiers, balances and the adjustment form. Payout run approval. **Export** CSV of partners, ledger and payouts: admin-only, audited, never bank, tax or Connect ids. Every write goes through `guarded` (authorised, step-up, audited), with new audit actions `affiliate.*`. |

## 8. Legal / terms

| # | Gap found | Sev | Fix |
|---|---|---|---|
| 8.1 | **There was no affiliate terms page.** The application linked "programme terms" to the *customer* `/terms`. The portal linked to `/affiliates`, which redirects partners back into the portal (a loop). | H | New `/affiliates/terms` (`noindex` until approved). Every number is read live from the plan. It states: last-click and the window; commission excluding VAT; the hold; proportional reversal; restore on a won dispute; clawback from future commission; admin-approved payouts via Connect; remittance advice versus self-billing; ineligible referrals and fraud holds; tiers. It lists prohibited methods: brand bidding, cookie stuffing, incentivised clicks, fake reviews. It sets out **PECR**: no unsolicited email or SMS to individuals, sole traders or unincorporated partnerships without consent; corporate messages must identify the sender and give an opt-out; no bought or scraped lists; TPS/CTPS for calls; CAP-code disclosure. It covers anonymised customer data. The onboarding and help links now point to it. **DRAFT FOR OWNER REVIEW.** |
| 8.2 | The public landing page says commission is "approved automatically". | ok | Still true. The *commission* hold auto-approves; *payouts* need admin approval, which the terms state. |

## 9. Security

| # | Check | Result |
|---|---|---|
| 9.1 | RLS: partners see only their own rows. | Holds. `current_affiliate_id()` policies are on every partner table (0036/0056). The new `affiliate_tier_history` has the same policy. `affiliate_tiers` is readable only by active partners and admins. Flags, fingerprints and settings are service-role only (FORCE RLS, no grants). |
| 9.2 | No customer PII to partners. | Holds. Portal queries never join `businesses`, and a test pins this. Labels are anonymised. `affiliate_clicks` and `affiliate_attributions` (hashes) stay service-role only. `business_id` (a uuid, not PII) is visible on the partner's own referral rows through RLS. Hardening this to column grants is optional (L). |
| 9.3 | Webhook idempotency. | Holds. `webhook_events` is unique on the event, the job is keyed on the event id, and every ledger write is keyed. |

## Owner decisions (resolved 2026-09-28)

The owner decided all of these on 2026-09-28. They are implemented and pinned by `tests/affiliate-owner-decisions.test.ts`. Migrations `0168`/`0169` are written and **not applied**.

1. **Referral cookie: consent first.** `/r` no longer sets `ct_ref`; it carries the signed referral in the landing URL (`?ct_ref=`).
   - With cookie consent, `ReferralCapture` asks `/api/affiliates/referral` to set the httpOnly cookie for the rest of the window. Withdrawal deletes it.
   - Without consent, the parameter is carried on same-site links to `/signup`, including Google sign-up, in the same visit, with nothing stored.
   - `ct_ref` is listed in the Cookie Policy as optional.
2. **Negative balance at the end of a partnership: written off**, never invoiced. Admin -> Affiliates -> **End partnership** (`endPartnership` -> `closePartnership`) writes one `WRITE_OFF` ledger entry equal to the deficit. The terms, admin panel, portal help and the negative-balance notice say so.
3. **No self-billing at launch** (`SELF_BILLING_AT_LAUNCH = false`). Statements are remittance advice, not VAT invoices, and VAT-registered partners send ClientTurn an invoice. This is stated in the terms, payouts page, help and admin.
4. **Promo codes: removed from the UI.** Real Stripe promotion codes were judged disproportionate: there is no offer, coupon or admin pipeline behind them, and the checkout is a card-up-front trial, so a code would only discount the first paid invoice and would add a second, webhook-late attribution path. With one-off commission on cash, a discount also cuts the partner's commission. Both actions refuse (`link-actions.ts`). The table and rows are kept.
5. **Commission is one-off.** It is paid once per referred customer, on the first paid subscription invoice.
   - The basis is the **full** first payment, VAT-exclusive and after discounts. An annual plan pays on the whole annual invoice.
   - Renewals, add-ons and top-ups earn nothing. The refund, dispute and hold rules are unchanged.
   - 0169 turns `RECURRING_PERCENT` plans into `FIRST_PAYMENT_PERCENT`, forces `recurring_months` to 1 and caps rates at 10%.
   - **Existing referrals:** attribution is kept, and first-payment commission is untouched. Unpaid renewal accruals are cancelled: pending, approved and in-draft ones are REVERSED, and a draft payout is reduced. Nothing committed or paid is clawed back. There were no commission rows on the live database when this was written.
6. **Tiers 6% / 8% / 10%.**
   - Partner: 6%. Pro Partner: 8% from 5 paid referred customers in the last 12 months. Elite Partner: 10% from 15.
   - Promotion is daily, demotion is on the 1st, and the admin lock remains. A tier is never below the plan.
   - The MRR threshold is removed: it is kept as a column, set to 0 and unread, because one-off commission does not pay on later revenue.
   - Public pages and the terms read the rates from the tier table.

### Earlier open items (historical)

1. **Referral cookie consent (H).** `ct_ref` is set on click, with no consent, and is not in the Cookie Policy. Options:
   - (a) treat it as necessary and add it to the Cookie Policy (legal risk: the ICO says affiliate cookies need consent);
   - (b) only set it after consent: `/r` would pass a signed token in the URL, and the site would store it once the banner allows;
   - (c) server-side attribution by signed URL token only, with no cookie.
2. **Tier thresholds and rates.** 0166 seeds Partner at 5 customers or £500 MRR and Premium at 15 or £2,000, with **no rate uplift**. Set the real values in Admin → Tiers, then update the landing-page copy if tiers pay more.
3. **Programme terms wording.** `/affiliates/terms` is a draft. It needs legal review, then removal of the `noindex` and the draft banner. If auto-approval is ever switched on, section 5 ("reviewed and approved by our team") must change.
4. **Self-billing.** Decide whether to offer HMRC self-billing agreements to VAT-registered partners. Until then, statements are remittance advice.
5. **Negative balances at exit.** Decide whether an unrecovered deficit is written off or invoiced when a partnership ends. The copy deliberately promises neither.
6. **Promo codes.** Decide whether affiliate promo codes should become real Stripe promotion codes (and a promo-code attribution path), or be removed from the portal.
7. **Apply 0166**, after 0165 (already applied). The number is free; 0167 is taken.

## Not changed (other owners' surfaces)

- The landing page (`affiliate-landing.tsx`) was being edited by the UI sweep, so it was not touched.
- Partner dashboard visuals were limited to the new tier panel.
- No live Stripe objects were created. Connect onboarding was not exercised against Stripe.
