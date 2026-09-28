# 14 — Quote-to-cash: capability entitlements and plan defaults

Written 2026-09-27 (P2 quote-to-cash). The code is `src/lib/billing/capability-rules.ts`
(pure rules and defaults) and `src/lib/billing/capabilities.ts` (`can(businessId, capability)`).
Migration **0156** writes the rows. **It is not applied yet.** Until it is, `can()` falls back to
the identical defaults in code. `tests/capabilities.test.ts` holds the code, the migration rows and
the public site (`marketing/voice-offer.ts` `QUOTES_ON_PLAN`) together.

## One enforcement path

A capability is a `plan_entitlements` row (`unit = 'boolean'`, 1 or 0; a numeric capability holds
its allowance), plus any live `business_entitlement_grants` row for the workspace:

- A grant only raises a value.
- An expired or revoked grant is ignored.
- An inactive subscription allows nothing.
- An unknown plan denies.

Quote, e-signature, invoicing and voice gates call only `can()`. None of them checks a plan by name
(`tests/quote-service.test.ts` asserts this for the quote-to-cash files).

## Plan defaults (owner decision 2026-09-27)

| Capability | Trial | Starter | Growth | Pro | Enterprise |
|---|---|---|---|---|---|
| `quote_builder_enabled` | off | on | on | on | on |
| `esign_enabled` | off | on | on | on | on |
| `invoicing_enabled` | off | on | on | on | on |
| `quote_approval_enabled` | off | off | on | on | on |
| `quote_ai_enabled` | off | on* | on* | on* | on* |
| `direct_close_enabled` | on | on | on | on | on |
| `white_label_public_pages` | off | off | off | off | off |
| `voice_sales_enabled` | 0 | 0 | 0 | 0 | 0 |
| `voice_minutes_included` | 0 | 0 | 0 | 0 | 0 |

\* `quote_ai_enabled` also needs the existing AI-assistant entitlement (`aiAssistAllowed`, applied in
`capabilities.ts`) and the workspace's own AI switch, which the agent runtime checks.

## Why

- **Quotes, e-signature and invoicing are on every paid plan.** A quote costs almost nothing to
  produce: a PDF, a few rows and one stored object. Quoting, signing and invoicing are also what turn
  a qualified lead into revenue. That makes them a differentiator on every plan, not an upsell.
- **The trial is off.** A public, signable, branded document sent from an account that has not paid
  is an abuse vector, and the trial gains nothing from it. The locked state names the plan that
  unlocks it (the plan-limit-reached state).
- **Approvals start at Growth.** Growth is the first plan with more than one user, and an approval
  chain needs a second person.
- **White-label is off everywhere.** OD-1 says the "Powered by ClientTurn" badge shows on public
  pages. Removing it will be a future paid add-on, granted as a row in `business_entitlement_grants`.
- **Voice stays 0 on every plan.** OD-2 grants voice from the Stripe voice item or a minute pack,
  never from the plan. This uses the 0151 rows unchanged.
- **Direct close is on for the trial and every plan.** Every workspace has it today. The key exists
  so later gates can go through `can()`, and this default changes nothing that already works.

## Economics note

Per-quote cost of goods:

| Item | Cost |
|---|---|
| PDF | Rendered in the background job by an in-repo writer: no dependency and no provider cost (see below). |
| Storage | One R2 object per sent revision. |
| Email | One email through the workspace's existing sending path, counted against its normal allowance. |
| Reminders | At most two automated reminders per quote, through the re-engagement frequency guard. |

There is no new metered usage. Payment is collected through the customer's own Stripe account, so
ClientTurn never holds the money and pays no processing fees.

## PDF dependency decision

The repo has no PDF library, and a quote is text, rules and a table. `src/lib/quotes/pdf.ts` is a
small PDF 1.4 writer. It uses the standard Helvetica fonts (built into every reader, nothing embedded)
with WinAnsi encoding.

This has three advantages over a dependency:

- no bundle-size or cold-start cost;
- no supply-chain surface;
- **deterministic output**: the same revision always produces byte-identical bytes.

The logo is not drawn in the PDF. The public page shows it.

## Open questions

- Should white-label be sold as an add-on, and at what price?
- Should Enterprise contracts include white-label by default?
