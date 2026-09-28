# Billing rules: dunning, disputes, cancellation, limits, VAT

_2026-09-28, billing batch 2 of the gap audit (`docs/revenue-engine/15-system-gap-audit.md`). Every rule here is enforced in code. The file names are where to look, and the tests are where each rule is pinned._

Tests: `tests/stripe-webhook-dunning.test.ts`, `tests/entitlement-holes.test.ts` (both in `test:g1`). Neither calls Stripe; where a client is needed it is a fake.

Migration: `0165_billing_disputes_invoices_mrr.sql` (written, **not applied**). Until it is applied, everything below still runs: the new writers skip and log instead of failing a Stripe event, and admin falls back to list prices.

## 1. Failed payments and dunning

| Rule | Where |
|---|---|
| **Only the subscription governs access.** A failed one-off payment (an AI token pack, an SMS or WhatsApp top-up, a voice minute pack, a manual invoice) never sets PAST_DUE and never opens dunning. The purchase stays unpaid and grants nothing. | `stripe-events.ts` `invoiceFailureDecision`, `dunning.ts` `recordInvoiceFailure` |
| A subscription invoice (`subscription_create`, `_cycle`, `_update`, `_threshold`) that fails opens the existing 30-day daily retry: full access on days 0–2, sending, AI and voice paused from day 3, cancelled and read-only after 30 retries. | `dunning.ts`, `lifecycle.ts` |
| **Add-on items follow the subscription.** The Pro voice item and the dedicated-number item are items on the subscription, billed and dunned with it. Voice now follows the same grace days as the rest of the product: before, it stopped the moment any invoice failed. | `lifecycle.ts` `addOnSubscriptionStatus`, `voice/server-deps.ts` |
| **3-D Secure (SCA).** `invoice.payment_action_required` sends the owner to Stripe's hosted invoice page to confirm. No access change by itself: a failure arrives as `invoice.payment_failed`, and a confirmed payment as `invoice.paid`. A daily retry that hits `requires_action` counts as a failed attempt. | `dunning.ts` `recordInvoiceActionRequired` |
| **Delayed payment methods.** A Checkout paid by bank debit completes as `unpaid` and grants nothing. `checkout.session.async_payment_succeeded` is applied exactly as a paid completion; every grant is keyed on its purchase or session, so it credits once. `checkout.session.async_payment_failed` marks the purchase FAILED and tells the owner. The subscription is never touched. | `route.ts` `applyAsyncPaymentFailed`, `stripe-events.ts` |

**Owner check:** Stripe's own Smart Retries should be **off** for subscriptions, because the in-house 30-day retry does the retrying. The subscription's "if all retries fail" setting should be "leave past due" (our job cancels at day 30).

## 2. Disputes (chargebacks)

1. `charge.dispute.created` reverses affiliate commission (as before). It then records one `billing_disputes` row (unique on the dispute id) and **queues** `billing.refund_reverse` (kind `dispute`) to claw back the disputed purchase's unused units.
2. The job uses the same rule and the same RPCs as a refund (`refundability.ts`, migration 0142). Attribution is FIFO. Only still-unused units are taken, never below zero, keyed on `dispute:<id>`.
   - AI tokens go through `reverse_ai_token_purchase`.
   - SMS and WhatsApp credit go through `reverse_message_credit_purchase`.
   - Voice packs use `voicePackRefund`, with a `PACK_REFUND` ledger row.
3. `charge.dispute.closed`:
   - **Won** (or `warning_closed`/`prevented`): exactly what was taken is given back through `restore_disputed_*` (0165) or a voice `ADJUSTMENT` row, keyed on `dispute_won:<id>`.
   - **Lost**: it stays removed.
   - The owner is told at each step.
4. A dispute on a subscription payment claws back nothing (there is no pack behind it). The owner is told.

Known limits:

- ~~A won dispute does not re-accrue affiliate commission.~~ Fixed by affiliate audit 17 (`docs/revenue-engine/17-affiliate-audit.md`): `charge.refunded` and `charge.dispute.created`/`.closed` now queue `affiliate.billing_event`, which reverses in proportion (cumulative, keyed) and re-accrues exactly what a WON dispute reversed (`affiliates/commissions.ts` `reaccrueDisputedCommission`). The webhook no longer calls Stripe for affiliates.
- A voice pack restored after a won dispute still counts as "reversed" if the same pack is later refunded, so that refund under-reverses. This is conservative in the customer's favour.

## 3. Cancellation and data retention

| Phase | What happens |
|---|---|
| Cancellation requested (period end) | Everything runs until the period end. Billing shows when access ends and the dates below. |
| Ended (Stripe `customer.subscription.deleted`, or dunning exhausted) | **Read-only for 90 days**. Every record stays readable and exportable. Nothing is sent, no AI runs, no call is placed. Resubscribing (no second trial) restores it as it was. |
| Day 14 after the end | The **dedicated number is released**, so ClientTurn stops paying rent. The existing `voice.number_release` job does it: the owner is warned at the end with the date, then the number is released and quarantined for 90 days. Resubscribing with voice before day 14 cancels the release (`CANCEL_RELEASE`). |
| Day 90 after the end | The workspace counts as closed. Lead records, messages and workspace data are deleted, as the privacy policy says ("90 days after account closure"). Minimised suppression records and billing/tax records (6 years) are kept. |

Code: `billing/cancellation.ts` (the policy and dates), `billing/number-release.ts`, `subscription-sync.ts`. It is shown in **Settings → Billing & Usage → Subscription status**.

**Day-90 deletion is built** (2026-09-28): the daily `billing.workspace_deletion` job (`billing/workspace-deletion.ts`, migration `0170_workspace_day90_deletion.sql`, **not applied**).

- It keeps `workspace_deletion_schedule` in step with cancelled subscriptions. A resubscribe clears the row.
- The owner is notified on **day 60** and **day 83** (in-app and email, type `billing`, idempotent per workspace, day and end date). The notice states the date, what is deleted, what is kept, and how to export or resubscribe.
- From **day 90**, and never sooner than 7 days after the final notice was actually sent, it re-reads the state (still cancelled, not held) and deletes:
  - every lead and prospect through the existing data-rights path (`data_rights_delete`: anonymise, hard-delete, retain the pseudonymous records it lists), bounded per run;
  - R2 objects through tombstones: PREFIX rows in `r2_object_tombstones` for `logo/`, `import/`, `support/` and `quotes/` of that workspace, purged by the same job. Voice recordings and transcripts cascade with their lead and go through 0150's voice tombstones and `voice.retention`;
  - members, API keys, webhook endpoints, integrations and their secrets, mailboxes, sender identities and payment endpoints (`workspace_close_after_retention`, which refuses while any lead or prospect remains). The business row is kept, renamed "Deleted workspace" and marked `deleted_at`, because the retained billing, dispute and suppression rows hang off it.
- **Hold:** Admin -> Billing -> Scheduled deletions lists every scheduled workspace with the dry-run decision for today and a **Hold** toggle (guarded, step-up, audited, reason required) for disputes and legal holds. A held workspace gets no notice and is never deleted; releasing it resumes the schedule, final notice first.
- **Dry run:** the job only reports its plan until `WORKSPACE_DELETION_ENABLED=true` is set, so switching the policy on is a deliberate step after 0170 is applied and the first report has been checked. A `{ "dryRun": true }` payload forces a report at any time.
- Tests: `tests/workspace-deletion.test.ts` (fakes only).

## 4. Downgrading while over the new plan's limits

**Allowed.** Refusing it would trap a customer on a price they chose to leave. Deleting their people, mailboxes or schedules for them would destroy work.

Once the lower plan applies:

- Nothing that already exists is removed or switched off.
- Creating more of anything over its limit is refused, server-side, until the workspace is back under it:
  - a seat or an invitation;
  - a sender identity with a new address;
  - a new or resumed saved search;
  - a new intent monitor.
- A campaign cannot launch while active sender identities exceed the plan.
- Period allowances (new leads, prospects, runs, email, SMS) simply use the lower number from the next period.
- When the downgrade is scheduled, the owner gets a notice listing exactly what to reduce. After it applies, an app banner and the Billing page show the same list.

Code: `billing/allowance-gates.ts` (rules), `billing/over-limit-service.ts` (reads), `billing/sender-limit.ts`, `find-leads/actions.ts`, `intent/actions.ts`, `services/operations/team.ts`, `limits-service.ts` `getBillingNotice`, `checkout.ts` `changeSubscriptionPlan`.

## 5. Allowances and where each is enforced

The lead cap counts a lead once, the first time ClientTurn works it (the `lead_processed` meter, key `lead:<id>`).

| Allowance | Enforced at |
|---|---|
| New leads: an enquiry that **arrives** (ad forms, web forms, connectors, DMs, CRM pulls) | Always stored and never lost. `lead.process` holds it past the cap: no follow-up, a flag on the lead, and an owner notice. |
| New leads: a lead someone **creates** (Add lead, CSV import that starts follow-up, API `POST /v1/leads`, MCP `create_lead`) | Refused before anything is stored: `ingest/service.ts` `leadIntakeGate`. API answers 403 `PLAN_LIMIT`. |
| New leads: Find Leads promotion; resuming follow-up on a never-counted lead | Refused at the cap, otherwise counted once: `find-leads/actions.ts`, `lead.resume_follow_up` (`billing/lead-meter.ts`). |
| New leads: voice inbound | Creates no lead (unknown callers get the message or transfer path), so there is nothing to cap. |
| Seats | `services/operations/team.ts` (invitations count). |
| SMS segments; WhatsApp tokens | `limits-service.ts` send gate (allowance, then prepaid credit, then refused). |
| Reactivation contacts | `campaigns/reactivation-limit.ts` at launch, add and expand. |
| AI tokens | `ai/tokens.ts` reservation. |
| WhatsApp / campaigns / AI assist switches | `assertEntitlement(feature)`. |
| Verified prospects, search runs | `find-leads/server/budget.ts` `resolveBudget`. |
| Saved searches | ACTIVE schedules counted at create and resume. **Was never counted before.** |
| Intent monitors | ACTIVE monitors counted at create and resume. The create check read a meter nothing writes, so it **never refused before**. |
| Sender identities | New address at create, and the count at campaign launch. **Was capped only by connected mailboxes before.** |
| Email sent | `outreach/dispatch.ts` `checkCapacity("email_sent")`. |
| Sourcing / cold email switches | `assertCapability`. |
| Analytics (trials) | `/app/analytics` page refuses a trial server-side, the same rule as the nav (`analyticsAllowed`). |

## 6. Real revenue in Admin

- `invoice.paid` stores every paid invoice's real amounts in `billing_invoices`: amount paid, currency, subtotal, discounts, tax, and total before tax.
- Each full-period subscription invoice (`subscription_create` / `_cycle`) sets `subscriptions.mrr_minor`: what the customer is actually billed a month, after coupons, before VAT, annual ÷ 12, including add-on items.
- Admin reads that value on the billing list, summary and detail, the customer drawer, the overview MRR and the economics dashboard. It falls back to list price only while no paid invoice is recorded.
- Code: `billing/invoice-ledger.ts`, `billing/revenue.ts`.

## 7. VAT (Stripe Tax)

- `STRIPE_AUTOMATIC_TAX=true` turns on, for every Checkout ClientTurn builds (subscription, top-ups, AI packs, voice packs):
  - `automatic_tax`;
  - VAT-number collection (`tax_id_collection`);
  - billing-address collection;
  - `customer_update`, or `customer_creation` on a payment with no customer.
- It is **off by default**. The owner must first register for VAT, add the registration in Stripe Tax, and set a product tax code.
- The pricing FAQ says "added at checkout" only when the switch is on. Otherwise it says prices exclude VAT and any VAT due is shown on the invoice. The pricing page is static, so changing the switch needs a redeploy.
- Code: `billing/tax.ts`.

## 8. Paid enrichment

Apollo, Hunter and Clearbit are **off** in every environment (CLAUDE.md resolved conflict 7):

- `env.ts` never reads their keys unless `ENABLE_PAID_ENRICHMENT=true`.
- The provider registry drops them unless it is set.
- The test asserts the default is off, that the privacy policy still says "we do not enrich it from external data brokers", and that none of the three is a sub-processor.

Turning it on is a legal change first: privacy policy, sub-processor list and Art 14 notices.
