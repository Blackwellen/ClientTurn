# 12 — Voice Sales Agent + Quote-to-Cash: audit and gap map

Brief: "FULL REVENUE ENGINE UPGRADE", part 1 (§0 audit) and part 2 (§41–76). Written 2026-09-27.
Read-only audit: no code, schema or other doc was changed to produce this file.
Pricing research (§1) is a separate document owned by another agent. Voice COGS and
package prices are not stated here.

**Legend.**
- **E**: exists and works.
- **P**: partial.
- **M**: missing.
- **Extend**: the existing module the new work must grow from. Build a parallel one only where this doc says NEW.

Paths are repo-relative.

---

## Owner decision OD-1 (2026-09-27): call disclosure, identity and branding

| Item | Decision | Enforced in |
|---|---|---|
| Fixed opener (locked, not editable) | "This is an AI assistant calling from **{calling_as_name}** about the enquiry you sent us on **{day}**. Is now an OK time for a couple of minutes?" | Call engine: `lib/voice/opener.ts` (pure) produces it. The turn adapter speaks it before any model output. The validator rejects a first utterance that differs. |
| Recording notice | When recording is on, a fixed recording notice follows the opener immediately. | Same module, and the `voice_settings.recording_enabled` switch |
| Customer-editable text | Only what comes **after** the locked parts: the reason line, the persona phrasing, and the route-specific next sentence. The locked strings are never stored as customer text. | Settings → Voice (the editor shows the locked parts read-only) |
| Required before voice can be enabled | `calling_as_name` (brand/trading name, required). `legal_entity_name` + `identification_contact` (a contact address **or** a freephone number) given on request, per PECR identification. Optional `assistant_persona_name`. | `voice_settings` columns + a server check in `lib/voice/entitlement.ts` (`voice not ready` = integration-required state). Snapshotted onto every `voice_calls` row (`calling_as_name`, `legal_entity_name`, `identification_contact`, `persona_name`, `opener_version`). |
| Identification on request | If asked "who are you / who is this company / how do I contact you", the agent gives the legal entity name and the identification contact **deterministically** (a tool reads the call snapshot, not the model). | Call engine tool `get_caller_identity` |
| ClientTurn naming | ClientTurn is **not** named in the opener. It is named only if the prospect asks who built the assistant. | Call engine (deterministic answer); voice style rules |
| "Powered by ClientTurn" | Badge on the public **quote**, **signature** and **booking** pages. | `app/(public)/q/[token]/*`, signature page, public booking page: a shared `components/public/powered-by-badge.tsx` |
| White-label (badge removal) | A **candidate paid add-on**. It is a capability key `white_label_public_pages`, off by default, checked through `can()`. | `lib/billing/capabilities.ts`, `plan_entitlements` |
| Legal review | The fixed script and recording notice go to a lawyer, with the owner getting that check done (see Risk R15). | Release criterion R2 |

## Owner decision OD-2 (2026-09-27): voice packaging

Prices are from `12-voice-provider-research.md`. Each keeps at least 80% gross margin at base and at least 75% under the FX +10% and provider +10% stress.

| Item | Decision | Enforced in |
|---|---|---|
| Starter, Growth | Voice is an **add-on only**. The subscription price is unchanged. Prepaid minute packs: 100 / 250 / 500 / 1,000 minutes at £49 / £115 / £225 / £449. Dedicated number: £11.99/month. | Stripe TEST prices; `lib/billing/capabilities.ts` (`voice_sales_enabled` once a pack and a number are held) |
| Pro | **Voice is bundled by default at £499/month**: £399 plus a £100 voice subscription item giving 200 included minutes a month and the dedicated number. | A separate Stripe **subscription item** (not a new `plan_key`), so Pro's other limits are unchanged. `voice_minutes_included = 200` comes from the item, not the plan. |
| Pro without voice | The customer can **remove voice** and pay £399. The change is prorated. The number is released at the end of the period, after a warning. | Billing settings and a checkout toggle. The pricing page shows "Pro £499 with Voice · Don't need voice? £399". |
| Minutes | Included minutes don't roll over. Top-ups are prepaid with **no overage** and are non-refundable once used. Auto-recharge is opt-in. | Voice ledger / reservation (phase P3) |
| Trials, demos, free | Never place a live call, whatever the plan being trialled. | `lib/voice/entitlement.ts` on every initiation path |
| Premium voice | +£0.20/min when ElevenLabs voices plus a larger model are selected. | Voice settings and the cost model |
| Tests | `tests/plan-margins.test.ts` gains a voice-item assertion. This file is owner-held for edits (todo.md §3). | |
| Annual Pro | **No annual discount on the voice item.** It stays £100/month (£1,200/yr). At 15% off (£85/mo) the gross margin is ~76.9% at base but ~72.4% under the ×1.21 stress, below the 75% floor. The annual discount applies to the platform price only. | `plans.ts` `VOICE_ADDON`; `tests/plan-margins.test.ts` |
| Downgrade from Pro | The £100 voice item is removed with the plan change. The customer is offered minute packs plus the £11.99 number so an existing number can be kept. | `plan-change.ts` |
| **Blocking bug before any second Stripe item** | `billing/subscription-sync.ts` reads `subscription.items.data[0]` as the plan (lines ~49 and ~233–234). Stripe doesn't guarantee item order. The fix is to pick the item whose price maps via `planForPriceId`, and to sync the voice item separately into `business_entitlement_grants`. | P3; owner: lane F |

### OD-2 implementation map (where the code must change)

**Modelling rule.** Voice is a **separate Stripe subscription item** plus **capability entitlements** (`voice_sales_enabled` boolean, `voice_minutes_included` numeric). It is **not a new `plan_key`**, so Pro's other limits in `plan_entitlements` are unchanged.

| Where | Change needed | Owner (§11.2) |
|---|---|---|
| `lib/billing/plans.ts` | Add `VOICE_MINUTE_PACKS` (4 packs above), `VOICE_NUMBER_MONTHLY_GBP = 11.99`, and a `VOICE_ADDON` definition (`monthlyPriceGbp: 100`, `includedMinutes: 200`, `includesNumber: true`, `defaultOnPlans: ["pro"]`, `availableAsPackOnly: ["starter","growth"]`). Add a Pro feature line such as "Voice sales agent: 200 minutes a month and a dedicated UK number (removable, −£100)". **Do not** change `PLANS.pro.monthlyPrice` (it stays 399; the £499 is plan + item). Trial: `voiceLiveCalls: false`. | F |
| `plan_entitlements` (migration 0156 or F's slot) | New metric rows: `voice_sales_enabled` (unit boolean). It is 0 for trial/starter/growth/pro plan rows, because the **item** grants it and it is not granted by the plan. `voice_minutes_included` is 0 on all plan rows. The Pro item and Starter/Growth packs grant these through `business_entitlement_grants` (`reason = 'STRIPE_ITEM:<si_…>'` / `'VOICE_PACK'`), written by the Stripe webhook. That keeps a single enforcement path: `can()` reads plan row + grants. | A (capability keys) + F (grant writer) |
| Minute accounting | Period allowance = `voice_minutes_included` (reset at invoice period, no roll-over). Beyond it, pack balance in `voice_minute_ledger` (never expires, same as other top-ups). Beyond that, the call is **refused** (no overage). Reservation order: included first, then packs. | B (reservation) + F (ledger/packs) |
| Stripe TEST objects | Prices: `STRIPE_PRICE_VOICE_ADDON_MONTHLY` (£100, recurring), `STRIPE_PRICE_VOICE_NUMBER_MONTHLY` (£11.99, recurring), 4 one-off pack prices. Annual Pro gets a separate annual voice item price **only if** the owner wants the 15% discount applied to it (**open question**). All TEST mode. | Owner creates (like todo.md §2), F wires env |
| `lib/billing/checkout.ts` | Pro checkout `line_items` gets **two** items (plan + voice add-on), with an opt-out toggle. The plan-change path (`checkout.ts:239` / `plan-change.ts:140-147`) must replace the **plan item only**, keeping the voice item. Moving down from Pro keeps the item only if the owner allows voice as an add-on subscription on Growth (**open question**; by the decision, Starter/Growth get packs + number, not the £100 item, so a downgrade removes the item and offers packs). | F |
| `lib/billing/subscription-sync.ts` | **Bug risk:** it reads `subscription.items.data[0]` as **the plan** (lines 49, 233-234). With a second item, the order is not guaranteed. It must pick the item whose price maps to a plan (`planForPriceId`), and sync the voice item separately into grants. Fix this **before** any two-item subscription exists. | F |
| Removing voice from Pro | Server action: `subscriptionItems.del` with `proration_behavior: 'create_prorations'`. Set `voice_number.release_at = period_end`. Notice job at removal and 7 days before release. Cancel queued calls. Keep the number until period end, then `voice.number_release` job. | F (billing) + A (number release) |
| Dedicated number for Starter/Growth | A £11.99 recurring item on the existing subscription. Its lifecycle mirrors the Pro removal (release at period end). | F + A |
| Billing settings (`components/settings/billing/*`, `_sections/billing-section.tsx`) | Show the voice item, included minutes used/left, pack balance, number, "Remove voice (−£100/month)" with proration and number-release warning, and buy packs. Trial shows "Voice isn't available during the trial" (plan-limit state). | F |
| Pricing page (`app/(marketing)/pricing`, `components/marketing/pricing.tsx`) | Pro shows **£499 including the voice sales agent (200 min + number), or £399 without**. Starter/Growth show "Voice add-on: minute packs from £49 and a number at £11.99/month". No "unlimited". Prices ex-VAT per the resolved VAT decision. | F |
| `tests/plan-margins.test.ts` (**owner-held**, todo.md §3) | Add: (a) the Pro plan item margin is unchanged; (b) the voice item margin: £100 − (200 min × COGS + number cost + Stripe share) at ≥ 77% target / ≥ 75% floor, at max usage; (c) each pack at ≥ 75% under the stressed COGS from `12-voice-provider-research.md`; (d) number ≥ 75% (the research notes £9.99 fails under stress; £11.99 passes). The owner must allow edits under `tests/` first. | F (after owner permission) |
| `unit-costs.ts` / `planCost()` | Add the voice COGS constant (from the research doc, re-verified) and a `voiceAddonCost()`, so admin economics and the simulator include voice. | F |
| Entitlement gate | `assertVoiceAllowed()` requires `voice_sales_enabled` **and** a non-trial subscription state **and** minutes available (included or pack). A test call on trial is routed to the stub. | A |
| Refunds | Packs follow `refundability.ts` (0142: unused packs only). The Pro item is prorated by Stripe on removal. | F |

---

## 0. Headline facts

| # | Fact | Evidence |
|---|---|---|
| F1 | **There is no voice or phone-call code.** No Retell, Vapi, TwiML `<Dial>/<Connect>`, `calls.create` or voice webhook exists. "Call" today means: (a) a manual "Call" button (`tel:`) in `components/leads/lead-manual-actions.tsx` and `lead-drawer.tsx`, (b) the lead source `PHONE_CALL`, (c) a lead asking for a call, which is booked as a *phone-call meeting* (`agent/closing.ts:15,52`) and recorded as `leads.preferred_contact_channel='phone'` (0147). | grep across `src/`, `supabase/migrations/` |
| F2 | `AgentChannel` = `sms, whatsapp, email, messenger, instagram, tiktok, linkedin` (`agent/types.ts:49`). There is **no `voice` channel**. `inbox_channels.channel` CHECK (0044) has no VOICE. `lead_touches.source_type` has no CALL. | |
| F3 | **There is no quote, CPQ, invoice-to-customer or e-signature code.** The only commercial surface is **commercial authority** (`lib/commercial/authority.ts`, table `commercial_authority` in 0125). It lists up to 25 customer-owned checkout links, `max_discount_percent` and `requires_human_above_value_minor`. The only "quote" concept is the goal key `REQUEST_QUOTE` in Find Leads campaigns and the stage `PROPOSAL`. `lib/billing/invoices.ts` is ClientTurn's own Stripe subscription invoices, not customer invoicing. | |
| F4 | The direct-sale loop covers **customer-owned** checkout links → payment → WON → thank-you → abandoned nudges. It uses `checkout_attempts` and `checkout_payments` plus `payment_endpoints` (0143) and `lib/payments/*`. It is **written, not applied.** It uses no Stripe Connect: payments are confirmed from the customer's own Stripe account using a pasted signing secret (`api/webhooks/payments/stripe/[endpointId]`). | 0143 header |
| F5 | Migrations: latest is **0147**. **0138–0147 are all untracked in git.** 0143, 0144, 0146 and 0147 say "written, not applied". 0145 is applied (todo.md). WhatsApp tokens, sales craft, intent catalogue and upsells are in progress in parallel and may take 0148+. | `ls supabase/migrations`, `git status` |
| F6 | Telephony is **one shared platform SMS sender** (`TWILIO_SMS_FROM` / `TWILIO_MESSAGING_SERVICE_SID`, `lib/env.ts:118-130`). There are no per-workspace numbers, no number purchasing, no regulatory bundle handling, no subaccounts. | economics.md §1.1 "Number" row |
| F7 | **The Twilio auth-token issue.** `api/webhooks/twilio/route.ts` verifies `X-Twilio-Signature` with `serverEnv.twilio.authToken` (falls back to `TWILIO_CLIENT_SECRET`). The request signature is always the **account auth token** HMAC, never an API-key secret. So if the configured value is an `SK…` secret or a rotated token, every inbound SMS and status callback returns **403** (todo.md §1). A voice webhook built on the same helper inherits the same failure. | `route.ts:61-76`, `env.ts:101-125` |
| F8 | Quiet hours use **workspace** time (`business.timezone`, `policy/packs.ts:98` default 20:00–08:00, SMS/WHATSAPP only). There is **no recipient timezone** on `leads`. | `jobs/handlers/send-store.ts:649,687` |
| F9 | There is **no auto-recharge**. Top-ups are one-off prepaid purchases: `message_credit_*` (0129), `ai_token_*` (0116/0122) and WhatsApp tokens (in progress). There is no overage anywhere (0141). | grep `auto_recharge` = 0 hits |
| F10 | Stripe is **TEST-only** by construction. `env.ts:16,37` refuses a live key in `STRIPE_SECRET_KEY_TEST`. TEST prices are not yet created (todo.md §2). Stripe Tax / VAT is not on, and the pricing copy promises VAT at checkout (todo.md O7). | |

---

## 1. Gap map — part 1 areas

### 1.1 Voice Sales Agent

| Brief area | Exists (E/P) | Missing (M) | Extend, don't duplicate |
|---|---|---|---|
| Voice as an execution surface of the same agent | **E** One orchestrator/turn: `agent/orchestrator.ts`, `context.ts`, `strategy.ts`, `closing.ts`, `qi-turn.ts`, `validate.ts`. Memory: `opportunities/memory*.ts`, `conversation_summaries`. Deterministic NBA: `qualification-intelligence/nba.ts`. | **M** `voice` in `AgentChannel`. A realtime turn adapter: Retell calls the LLM per utterance, so the model path differs from the job-queued SMS turn. | Add `"voice"` to `AgentChannel`. Build `agent/voice/turn-adapter.ts` that reuses `context.ts` (lead, offer card, authority, QI state) and `validate.ts`, and writes `agent_runs` / `conversation_agent_actions` exactly like a text turn. **Do not** fork prompts: add a voice style block beside `agent/human-style.ts`. |
| Paid-only, enforced on every call path | **P** Capability gates: `billing/v4-entitlements.ts` `assertCapability` / `assertCapacity`, `plan_entitlements`, `business_entitlement_grants`. | **M** Voice metrics (`voice_enabled`, `voice_minutes`, `voice_numbers`, `voice_concurrency`). Checks at every entry point: outbound dial, inbound answer, callback, test call, MCP/API. | Add metrics to `V4Metric`, with plan rows in a migration. One `assertVoiceAllowed()` in a new `lib/voice/entitlement.ts` that calls `assertCapability`. See §60 below. |
| `VoiceProvider` / `TelephonyProvider` / `NumberProvider` | **P** Pattern exists for messaging: `messaging/provider.ts`, `registry.ts`, `stub.ts`, `twilio.ts`, `types.ts` (a `MessagingProvider` interface plus a stub). | **M** All three interfaces, Retell adapter, Twilio voice/number adapter. | NEW `lib/voice/providers/{types,registry,stub,retell,twilio-telephony,twilio-numbers}.ts`, copying the `messaging/registry.ts` + `stub.ts` pattern. Reuse `messaging/twilio.ts` credential resolution (`TwilioCredentials`, the SK/AC guard). Extract it to a shared `lib/twilio/credentials.ts`; do not copy it. |
| Dedicated business number per workspace, no rotation | **M** Only the shared platform number (F6). | **M** Number inventory, purchase, UK regulatory bundle, release, reputation. | NEW table `voice_numbers` (also usable for SMS later). `inbox_channels` (0044) already models "the number this connection speaks for" (`external_account_id`). Register each number as an `inbox_channels` row with channel `VOICE` (CHECK extension) instead of a parallel "connections" concept. |
| Five routes (Qualification, Booking Close, Direct Close, Nurture, Reactivation) | **P** Goals already exist: `GOAL_KEYS` A–G (0144 CHECK), motions (`sales-library/motions.ts`), closing (`agent/closing.ts`), reactivation campaigns (`lib/campaigns`, `reengagement/*`). | **M** Route config (`voice_routes`) mapping each route to goal, script policy, minute allocation and eligibility. | Routes = **goal × trigger**, not new logic. Qualification → `A_QUALIFY_ONLY`, Booking → `B_BOOK_MEETING`, Direct close → `C_DIRECT_SALE`, Nurture → `F_NURTURE`, Reactivation → campaign/re-engagement trigger. Store the route per call; the engine decides as today. |
| Quoting as a cross-channel tool | **M** | **M** | Add quote tools to the **service registry** (`lib/services/registry.ts` + `operations/*`), so agent, MCP, API and UI share one implementation (memory: "service layer is the spine"). Agent tool beside `propose_checkout` in `agent/tools.ts`. |
| Call state machine | **P** Lifecycle state machine pattern: `agent/lifecycle.ts` (`LIFECYCLE_STATES`), booking transitions (0113/0125). | **M** | NEW `lib/voice/call-state.ts` (pure, tested): `QUEUED → DIALING → RINGING → IN_PROGRESS(OPENER/PERMISSION/…) → WRAP_UP → COMPLETED`, plus `NO_ANSWER / VOICEMAIL / BUSY / FAILED / CANCELLED / BLOCKED_BY_POLICY`. Transitions written only through one RPC, like `close_opportunity`. |
| Five-minute budget, TIME_AMBER / TIME_RED, "is now a good time" opener, pacing, natural voice rules, anti-loop | **P** Anti-loop exists for text: repeated-question suppression in `qualification-intelligence/qa.ts`/`grade.ts`, question craft `agent/question-craft.ts`, human style `agent/human-style.ts`. | **M** Time-budget signals, opener, pacing engine, ASR/dialect robustness. | Put the time budget in the **deterministic** layer (`lib/voice/pacing.ts`) and feed it into `strategy.ts` as a context flag, so the model can't overrule it. Reuse the QA repeated-question checks for anti-loop. |
| Ethical sales psychology | **E** Anti-pressure rules in `sales-library/objections.ts` header (no scarcity, fake urgency or NLP). Honest "are you a bot?" answer (todo.md §4). | **P** Voice-specific AI disclosure at call start. | Extend `sales-library` rules. The disclosure is **not** a prompt instruction. It is the locked OD-1 opener from `lib/voice/opener.ts`, spoken before the model and checked by the validator. |
| Objection taxonomy + per-objection tracking | **E** 29 `ObjectionEntry` playbooks (`sales-library/objections.ts`, `OBJECTION_KEYS` in `types.ts:218`). Workspace overrides: `workspace_sales_overrides` kind OBJECTION (0121/0147), `sales-library/workspace-objections.ts`, `objection-responses.ts`, `classify.ts`. | **P** No per-lead / per-call objection **events** table, so no objection→outcome analytics. | Add `objection_events` (lead, opportunity, channel, call_id, key, handled_outcome). Write it from the same classifier the text path uses. **Do not** create a second taxonomy. |
| Human escalation settings | **E** `agent/handover-policy.ts`, `HANDOVER_REASONS`, `agent_handoffs`, `request_assist` (ASSIST_REQUEST), Slack notifications (`jobs/handlers/notification-slack.ts`). | **M** Live **warm transfer** of a call. Voice escalation settings (transfer number, hours, fallback to callback task). | Extend `handover-policy.ts` with `LIVE_TRANSFER` as a *delivery mode* of an existing reason, not a new reason set. Settings sit on the voice settings row. |
| Inbound return-call handling | **M** | **M** | Inbound webhook → match caller number to lead (`leads.phone_e164` + `contact_permissions.phone_e164`) → same agent with route derived from the open opportunity's goal. The unmatched path creates a lead via `lead.create` (source `PHONE_CALL` already exists). |
| Voicemail / no-answer | **M** | **M** | Deterministic policy in `lib/voice/attempts.ts`. On no-answer, fall back to SMS/email through the existing follow-up engine (`follow-up/channel-strategy.ts`) with the frequency guard (0146, `reengagement/frequency.ts`). A voicemail message counts as a touch. |
| Consent / eligibility (PHONE_NUMBER_PROVIDED vs CALL_REQUESTED; `canCallLead`) | **P** `contact_permissions` (0030) has relationship, consent status and scope, subscriber type. `policy/channel-policy.ts` has the per-channel decision. `compliance/contact-legality.assessPhone` screens form numbers. `preferred_contact_channel='phone'` (0147). | **M** Call-specific consent basis. `canCallLead()` pure gate. TPS/CTPS screening decision. | Add consent scope values `CALL_REQUESTED`, `PHONE_NUMBER_PROVIDED` (and `AUTOMATED_CALL_CONSENT`) to `contact_permissions.consent_scope`. Put `canCallLead` in `policy/channel-policy.ts` as a new channel `VOICE`, so the send guard, quiet hours and suppression reuse one path. |
| Calling hours in recipient-local time | **P** Quiet hours in workspace time only (F8). | **M** `leads.timezone` (derived from phone country / postcode / form), recipient-local window. | Extend `channel-policy.ts` `isWithinQuietHours` to take recipient tz when present; the default pack gains a `VOICE` window (e.g. 09:00–20:00 weekdays, stricter weekends). |
| Recording + transcription + retention | **P** Retention framework: `data_rights_retention_candidates()` (0124), anonymise triggers (0134/0143 pattern), R2 signed URLs (`storage/r2.ts` `createDownloadUrl`, 300 s). | **M** Recording storage, notice, retention job. | Copy recordings from the provider into R2 (`voice/recordings/<business>/<call>`), serve only through `createDownloadUrl`, and add a `voice_calls` branch to the retention and anonymise functions. |
| Post-call structured extraction | **E** for text: `qualification-intelligence/extractors.ts`, `interpret.ts`, `record_lead_assessment()` (0134), `answer-provenance` job. | **M** Transcript → facts. | Run the **same** extractors over the transcript with provenance `CALL`. Do not build a voice-only extractor. |
| Minute budget + route allocations, concurrency + priority queue, capacity forecast | **P** Budget pattern: `ai_budgets`, `ai_token_reservations` (reserve→settle, 0116), `usage_reservations`. Queue: `jobs` + `jobs/queue.ts` (dedupe by unique), claim/pause/retry (0137). | **M** Voice minute ledger, reservations, per-workspace concurrency, priority. | Model voice minutes on **AI tokens** (`billing/token-service.ts`, `ai_token_ledger`, `ai_token_reservations`): reserve N minutes before dialling, settle on `call_ended`. Concurrency = count of `voice_calls` in active states under row lock. Priority = a column on the call-queue row, claimed by the existing worker. |
| Voice packages, voice in higher tiers, number pricing, prepaid + auto-recharge | **P** Packs/top-ups: `plans.ts` `MESSAGE_CREDIT_BUNDLES`, `billing/tokens.ts` `TOKEN_PACKS`, `whatsapp-tokens.ts`. Checkout: `billing/checkout.ts`, `token-actions.ts`. Refund rules: `refundability.ts` (0142). | **M** Voice packs, number add-on subscription item, auto-recharge (new everywhere). | Add `VOICE_MINUTE_PACKS` beside `TOKEN_PACKS`, one checkout path. Auto-recharge is a **new generic** capability (saved PM + threshold + monthly cap), usable by SMS/WA/AI/voice. See the risk on working capital (§12). |
| Immutable usage/cost ledger | **P** `cost_events` (0018, server-only, `estimated/reconciled`), `provider_price_book`, `business_cost_daily`, `business_margin_monthly` (0145), `unit-costs.ts`. | **M** Voice rows. Note: the price book already under-states WhatsApp (economics.md note 1), and Find Leads doesn't read it (note 3). | Write every call's provider cost to `cost_events` (provider `retell` / `twilio`, metric `voice_minute_*`), reconciled from the provider's final call object. Add price-book rows. Make `cost_events` append-only (revoke UPDATE/DELETE, reconcile by a new row), which also fixes the ledger claim for the other channels. |
| Admin economics (voice GM) | **E** `/admin/economics` (`lib/admin/economics-live.ts`, `economics-model.ts`, `economics-alerts.ts`, job `economics-margin-check.ts`, 0145 `admin_economics_usage`). | **M** Voice line, per-route GM, number costs. | Add voice metrics to `admin_economics_usage` (new migration replacing the function) and to `planCost()` in `unit-costs.ts`. Keep one simulator. |

### 1.2 Quote-to-cash

| Brief area | Exists (E/P) | Missing (M) | Extend, don't duplicate |
|---|---|---|---|
| Catalogue (products, services, bundles, tiers) | **P** `services` (0002: name, description, `average_value`, active, position) is **the offer entity** (`qualification-intelligence/offer-profile.ts` header). `services.offer_profile` jsonb (0134) holds pricingModel, averageDealValue, billing, differentiators, `checkoutLinkId`. todo.md queues "offer catalogue & commercial rules". | **M** Priced line items, SKUs, units, tiers, bundles, VAT class, cost price (margin floor). | See §4 (placement decision): **`services` stays the offer**. NEW child table `catalogue_items` (FK `service_id`, nullable for add-ons) + `catalogue_bundles`. Do **not** put prices into `offer_profile` jsonb: quotes need relational, versionable prices. |
| VAT | **M** The workspace has no VAT number/registration. ClientTurn's own VAT is also unresolved (F10). | **M** | `quote_settings.vat_registered`, `vat_number`, default rate. Per-item `vat_rate` (20 / 5 / 0 / exempt / reverse-charge). Deterministic calculator only. |
| Workspace quote settings | **P** `commercial_authority` row per workspace (0125/0143). | **M** Numbering, validity days, T&Cs, deposit default, branding, payment terms. | NEW `quote_settings` (1 row per workspace). Keep `commercial_authority` as the **authority** (what the AI may do) and extend it with quote permissions (§74). Settings and authority are different questions, so they go in two rows. |
| 5 quote types, deterministic calc tools | **M** | **M** | NEW pure `lib/quotes/calc.ts` (integer minor units, banker-safe rounding, line → subtotal → discount → VAT → total, deposit/instalment split). The AI calls tools. It never writes a number. Validator rule in `agent/validate.ts`: every money figure in an outbound message must equal a quote/revision figure or an approved `price_text`. |
| Lifecycle state machine | **P** Opportunity stages include `PROPOSAL`, `CHECKOUT_SENT`, `NEGOTIATION` (0125). | **M** | NEW `quotes` + `quote_revisions` (immutable). Quote status: `DRAFT → PENDING_APPROVAL → SENT → VIEWED → ACCEPTED/SIGNED → INVOICED → PAID`, plus `DECLINED/EXPIRED/SUPERSEDED/VOID`. Project onto the opportunity via `ensure_interest_opportunity` (0144) → `PROPOSAL`/`NEGOTIATION`. Do not add quote statuses to opportunity stages. |
| Branded public quote page + PDF on immutable revisions | **P** Public token pattern: `checkout_attempts.token` (opaque, unique). Branding: `settings/ai-selling/brand-card.tsx`, logo in R2. `make-pdf` exists only as a skill; there is **no PDF library** in the app. | **M** | NEW `app/(public)/q/[token]/page.tsx`, showing the workspace brand plus the "Powered by ClientTurn" badge (OD-1; removed only with the `white_label_public_pages` capability). The same applies to the signature and public booking pages. Token = random 32+ chars, hashed at rest (see §7). PDF rendered server-side at revision freeze, stored in R2, served by signed URL. Revision rows are never updated; a trigger forbids UPDATE of priced columns. |
| First-party e-signature | **M** | **M** | NEW `quote_signatures`: typed name, intent checkbox, IP, UA, timestamp, revision SHA-256, email OTP. Claim it only as a **simple electronic signature** (see risks). |
| Invoicing (deposit, balance, partial, instalments, Stripe, reminders, credit notes) | **P** Customer payment **confirmation** is in 0143 (`checkout_payments`, matching, REVIEW/UNMATCHED). Reminders pattern: abandoned checkout nudges (`payments/abandoned.ts`, job `checkout-nudge.ts`). Dunning pattern for our own billing: `billing/dunning*.ts`. | **M** Invoices, schedules, credit notes, creating payment links on the **customer's** Stripe. | NEW `customer_invoices`, `invoice_payment_schedule`, `credit_notes`. Payment collection: v1 = the customer's own Stripe via a **restricted key** they paste (sealed with `security/secret-box.ts`, like `payment_endpoints`), creating Checkout Sessions with `client_reference_id` = invoice token. Confirmation reuses the 0143 Stripe endpoint + matcher (add `match_kind='INVOICE'`). No Stripe Connect in v1 (as 0143). |
| Discount-control rules | **P** `max_discount_percent`, two-step discount rule and discount-ask detection (`agent/handover-policy.ts:195-210`), `requires_human_above_value_minor`. | **M** Margin floor, per-item max, approval chain, "only after objection" restraint. | Extend `commercialAuthoritySchema` (`discount_policy: {mode: NEVER|AFTER_OBJECTION|PROACTIVE, max_percent, margin_floor_percent, approval_above_percent}`). One checker `lib/quotes/discount-guard.ts`, called by the calc tool and the validator. |

### 1.3 Other surfaces audited (part 1 list)

| Area | State | Key paths | Relevance / extend point |
|---|---|---|---|
| Leads & opportunities | E | `lib/leads/*`, `opportunities/{service,stages,interests,memory}.ts`, 0125 RPCs, 0144 multi-interest (pending) | Quotes attach to an **opportunity** (per interest), not the lead. Voice calls attach to the lead + current opportunity. |
| Conversations / inbox | E | `lib/inbox/*`, `components/inbox/{inbox-view,agent-panel}.tsx`, `conversations`, `messages`, `inbox_channels` | Calls go on the same conversation timeline as a `messages`-adjacent `voice_calls` item (§47). |
| Qualification intelligence | E | `lib/qualification-intelligence/*`, 0134, reports 08/10 | Voice feeds facts through the same extractors. QI thresholds decide when to quote (`offer_profile.thresholds.directSale`). |
| Automations | E | `lib/automation/{event-types,events,scheduler,defaults}.ts`, `automations/*`, `automation_*` tables, job `automation-advance.ts` | Add event types (§45). |
| Bookings / meeting types | E | `lib/bookings/*`, `meeting-types.ts`, `meeting_types`, Calendly/Google, phone-call meeting type (`closing.ts`) | Booking Close route calls `get_calendar_availability` / `create_booking` tools unchanged. |
| Stripe / billing | E | `billing/{plans,checkout,token-service,message-credits,refundability,trial-upgrade-*,limits}.ts`, `api/webhooks/stripe` | Voice packs and number add-ons go here. Stripe TEST only (F10). |
| SMS / WhatsApp / Meta / TikTok / email | E/P | `lib/messaging/*`, `lib/social/*`, `email-provider.ts`, `whatsapp-tokens.ts` (in progress) | Voice fallback channels. The number could double as a per-workspace SMS sender later (removes the shared-sender risk F6). |
| Analytics | P | `lib/analytics/{revenue-surfaces,source-funnels*,v4-*,question-performance*,reengagement-query}.ts`, `lead_touches` (0123) | §41–42. |
| RBAC | E | `has_business_role()` (0010), `team/rules.ts` (owner/admin/member/viewer) | Quote approval = owner/admin. Voice settings = owner/admin. |
| Audit | E | `lib/audit.ts` `recordAudit`, `AuditAction` union | Add `voice.*`, `quote.*`, `invoice.*`, `signature.*` actions. |
| Onboarding | E | `lib/onboarding/provision.ts` (seeds `services`) | Add an optional "Voice" step later. Don't block core onboarding. |
| Marketing site / pricing | E | `app/(marketing)/pricing/page.tsx`, `components/marketing/pricing.tsx`, `plans.ts` features, `/enterprise` ("We do not describe any allowance as unlimited") | §49–52. Note: `plans.ts` features say "Unlimited follow-up email from your own mailbox" ×3, which conflicts with the no-"unlimited" rule. |
| Settings | E | `app/(app)/app/settings/_sections/*` (ai-selling, billing, business-profile, connections, data-controls, developer, team, workspace), `components/settings/*` | §44. |
| Admin | E | `app/admin/(ops)/{economics,billing,customers,system,support,...}`, `lib/admin/*` | §58–59. |
| Jobs / cron | E | `lib/jobs/{queue,registry,register,send-core}.ts`, `handlers/*`, `api/cron/{worker,daily}`, `docs/CRON.md` | §56. |
| Storage | E | `lib/storage/r2.ts` (`createUploadUrl`, `createDownloadUrl` 300 s, `ALLOWED_TYPES`) | Add `recording` (audio/mpeg, audio/wav) and `quote_pdf` kinds. |
| Webhook architecture | E | `webhook_events` (unique provider+external id), `api/webhooks/*`, job `ingest-webhook.ts`, `webhook-replay.ts`, outgoing `lib/webhooks/*` | §57. |
| Developer platform / MCP | E | `lib/services/registry.ts` + `operations/*`, `lib/mcp`, `api/v1` | Quote/call operations are registered once and exposed to API/MCP by scope. |

---

## 2. Gap map — part 2 (§41–76)

| § | Topic | Exists | Partial / missing | Extend |
|---|---|---|---|---|
| 41 | Cross-channel attribution: one revenue journey, first/last/multi-touch, funnel, timeline, campaign analytics | `lead_touches` (0123: ad/form/UTM/click ids, `source_type`), `revenue-surfaces.ts` funnel (`REVENUE_FUNNEL_STAGES`, `sampledRate`, `LOW_SAMPLE_N=30`), `source-funnels*.ts`, `checkout_payments` revenue (0143), `domain_events`, `agent_activity_events` | **M** A unified **journey event** view spanning touch → message → call → quote → signature → payment. First-touch exists implicitly (earliest `lead_touches`). There is **no** last-touch or multi-touch model, and revenue isn't linked back to touches. | NEW SQL view `revenue_journey_events` (UNION of `lead_touches`, `messages`, `voice_calls`, `quote_events`, `checkout_payments`, `bookings`) + pure `analytics/attribution.ts` (first, last, linear, position-based 40/20/40). No new event table: reuse sources. Add `CALL` to `lead_touches.source_type` for inbound calls that create leads. |
| 42 | Quote analytics | — | **M** all | `analytics/quote-metrics.ts` over `quotes`/`quote_revisions`/`quote_events`: sent→viewed→accepted→paid rates, time-to-view/accept/pay, discount given vs margin impact (needs `cost_minor` on items), AI vs human author (`created_by_kind`). Reuse `sampledRate`. |
| 43 | Conversion-learning experiments | `experiments` (0131: kinds `WARM_FOLLOW_UP, REACTIVATION`, 2–4 variants, holdout, `min_sample_per_arm ≥ 100`, primary metric), `learning/experiments.ts`, `experiments-service.ts`, `services/operations/experiments.ts`, `outreach/variant-assignment.ts`, QI kind `QUESTION_STRATEGY` (0134), reactivation A/B (0146) | **P** No automatic promotion/rollback, no significance gate beyond sample size. There is no kind for voice openers or quote presentation. | Extend the `experiments.kind` CHECK (`VOICE_OPENER`, `VOICE_ROUTE`, `QUOTE_PRESENTATION`, `QUOTE_FOLLOW_UP`). Add a pure `learning/decide.ts` (two-proportion z-test or Bayesian, promote at p<0.05 with both arms ≥ min sample, auto-rollback on guardrail metrics: complaint/opt-out rate). One engine. |
| 44 | Settings IA: Voice / Sales Agent / Quotes & Invoices, progressive disclosure | Sections: `ai-selling` (brand, budget, channels, compliance, qualification policy, sales behaviour, scoring, strategy), `business-profile` (ICP, goal, **direct-close editor**), `connections` (incl. `payments-section`), `billing`, `team`, `developer`, `data-controls`, `workspace`; `meeting-types` panel | **M** Voice section; Quotes & invoices section; catalogue editor. There is no services/catalogue UI beyond onboarding and seeds. | Keep 5 top-level destinations (CLAUDE.md conflict 0). Add **Settings → Voice** (`_sections/voice-section.tsx`: first an **identity** block that must be completed before voice can be enabled, then numbers, routes, hours, escalation, recording and minutes). The identity block (OD-1) has required `calling_as_name`, required legal entity name, a required contact address or freephone number, and an optional persona name. The opener preview shows the locked parts read-only, with the editable remainder after them. Add **Settings → Quotes & invoices** (`_sections/quotes-section.tsx`: catalogue, VAT, numbering, terms, payment collection). **Move** `direct-close-editor.tsx` under it as "Commercial authority". Rename ai-selling → "Sales Agent" only by label. Voice-disabled plans see a locked state (plan-limit-reached). |
| 45 | Automation triggers/actions for voice and quotes | `automation/event-types.ts` (lead.*, message.*, automation.*, qualification.*, booking.*, campaign.*) | **M** `call.*`, `quote.*`, `invoice.*`, `signature.*` | Add events `call.completed`, `call.no_answer`, `call.voicemail_left`, `call.requested`, `quote.sent`, `quote.viewed`, `quote.accepted`, `quote.expired`, `invoice.paid`, `invoice.overdue`, `signature.completed`. Actions: `schedule_call` (policy-gated), `send_quote_reminder`. Emit through `automation/events.ts` + outgoing webhooks (`webhooks/events.ts`). |
| 46 | Pipeline semantics (Quoted, Booking Pending, Payment Pending…) on configurable stages | Opportunity stages are a **fixed** CHECK (`OPEN…NEGOTIATION`, `CLOSED` only via `close_opportunity`), `opportunities/stages.ts` | **M** There are no configurable pipelines. | Don't build configurable pipelines now. Add a **derived** `system_status` (Quoted, Booking pending, Payment pending, Signed, Deposit paid) computed from quote/invoice/booking state in `opportunities/stages.ts`, shown as a badge. If configurable stages come later, map `system_status → stage` by a lookup row. The status badge map stays in one place (CLAUDE.md). |
| 47 | Inbox call card | `inbox-view.tsx`, `agent-panel.tsx`, `lead-page-conversation.tsx` | **M** | NEW `components/voice/call-card.tsx` (outcome, duration, route, summary, extracted facts, objections, recording play via signed URL, transcript expand), rendered in the conversation timeline. |
| 48 | Voice + quote context on lead profile | Lead detail tabs (`lead-page-tabs.tsx`), `next-best-action-card.tsx`, `checkout-payments-card.tsx`, `intent-panel.tsx` | **M** | Add `calls` and `quotes` tabs/cards, following `checkout-payments-card.tsx`. The NBA card can recommend "Call" / "Send quote" (§71). |
| 49/50/52 | Marketing + pricing: voice as a paid capability, quote-to-cash story, no "unlimited" | `(marketing)/pricing`, `components/marketing/pricing.tsx`, `/product`, `/how-it-works`, `/compliance`, `/sub-processors` (`marketing/subprocessors.ts`: Twilio listed) | **M** Voice and quotes copy. **Violation:** "Unlimited follow-up email" in `plans.ts` features. **M** Retell in sub-processors. | Voice appears as an **add-on / higher-tier** row with minute packs. Fix the "Unlimited" wording (for example "Follow-up email from your own mailbox, no ClientTurn cap"). Add Retell (and its LLM/TTS sub-processors) to `subprocessors.ts` **before** any live call. No fabricated proof (CLAUDE.md). |
| 53 | Adjacent gaps | see §9 below | | |
| 54 | Domain model | see §5 | | |
| 55 | RLS + security tests incl. public quote tokens and signature endpoint | `tests/rls.test.ts`, `rls-v4.test.ts`, `rls-new-tables.test.ts` (need a local Supabase stack, todo.md §5) | **M** | see §7 |
| 56 | Jobs | see §8 | | |
| 57 | Webhooks: Retell, Twilio voice, Stripe, calendar; dedupe + replay | see §8 | | |
| 58/59 | Admin voice ops + GM monitoring | `/admin/economics` (margin per workspace, below-75% alerts, simulator), `/admin/system` (health, jobs, providers: `lib/admin/{health,jobs,providers,provider-catalogue}.ts`) | **M** | Add a **Voice ops** tab under Admin → System: live calls, concurrency per workspace, failure/no-answer rates, provider status, number reputation flags (spam-likely reports), per-route GM. Add voice lines to Economics (the same `economics-margin-check` job, **77% voice floor** alert). Admin shell stays Overview/Customers/System (V3). |
| 60 | Centralised capability entitlements | `v4-entitlements.ts` (`assertCapability`, `assertCapacity`), `entitlements.ts` (`assertEntitlement`, `getEntitlements`), `plans.ts` flags (`whatsappEnabled`, `campaignsEnabled`, `aiAssistAllowed`), `planThatUnlocks(feature)` | **P** Scattered literal plan checks: see §6 | One `lib/billing/capabilities.ts`: `can(business, capability)` returning allowed/locked + reason + unlocking plan. Plan rows live in `plan_entitlements` (boolean unit) and grants in `business_entitlement_grants`. Migrate the literal checks gradually; the voice and quote gates must only use it. |
| 61 | Observability | `ai_runs`, `agent_runs`, `agent_tool_calls`, `conversation_agent_*`, `platform_error_triage`, `domain_events`, `api_request_logs`, admin jobs/errors pages | **M** Per-call latency (first-response ms, turn latency, barge-ins), provider error codes, cost per call. | `voice_call_events` (append-only) + metrics on `voice_calls`. Surface in admin Voice ops. Alert via the existing `platform_error_triage`. |
| 62 | 20 call QA simulation scenarios | Golden conversations harness `tests/golden-conversations.test.ts` (24 convs, 49 turns), `tests/fixtures/prompt-token-snapshot.json` | **M** | `tests/voice-scenarios.test.ts` with a stubbed `VoiceProvider` driving the **turn adapter** through transcripts. Minimum set: busy/not-now opener, permission denied, wrong person, gatekeeper, price objection, discount ask beyond authority, "are you a bot", request human, silence/no speech, talk-over, heavy accent / ASR garbage, loop attempt, TIME_AMBER, TIME_RED wrap-up, booking success, booking no slots, direct close link, quote request, opt-out mid-call, voicemail. |
| 63–65 | Quote, billing and economic QA | `tests/plan-margins.test.ts` (owner-held edit), `direct-close.test.ts`, margin tests | **M** | `tests/quote-calc.test.ts` (property-based: totals, VAT, rounding, deposit + balance = total, credit note ≤ invoiced), `tests/quote-lifecycle.test.ts`, `tests/voice-economics.test.ts` (every pack ≥ 77% GM at the COGS constant in `unit-costs.ts`). |
| 70 | ROI UI | Dashboard revenue surfaces, `checkout_payments` revenue, ai cost per lead (lead-page-tabs AI runs) | **M** There is no ROI view (revenue attributed ÷ ClientTurn cost). | Dashboard card: attributed revenue (payments + won values) vs subscription + usage spend in the period. Label it "attributed", with the model named. |
| 71 | Channel orchestration in the NBA | `qualification-intelligence/nba.ts`, `follow-up/channel-strategy.ts` (cheapest channel first, `preferredStepChannel`), `reengagement/{planner,send-time,frequency}.ts` | **M** Voice as a channel choice | Add `CALL` as a next action in the NBA with deterministic preconditions (`canCallLead`, entitlement, minutes available, lead preference/requested, calling hours). Channel strategy ranks voice by cost × expected lift. It is never the first touch unless the lead requested a call. |
| 72 | Quote follow-up | Abandoned-checkout nudges (`payments/abandoned.ts`, `checkout-nudge` job, settings on `commercial_authority`), frequency guard (0146) | **M** | Generalise the nudge scheduler to "commercial nudges" (checkout, quote viewed-not-accepted, expiring, invoice due/overdue), all through the frequency guard. **Quote expiry → re-engagement trigger** (`reengagement/triggers.ts`). |
| 73 | Locks + idempotency for commercial actions | `send_key` unique (0143, `send-core.ts`), `webhook_events` unique, `FOR UPDATE` lead-row serialisation (0144 RPCs), `idempotency_key` ledgers (0129), job unique dedupe (`queue.ts:112`) | **M** for quotes/calls | Every state change goes through a SECURITY DEFINER RPC that locks the quote row (`FOR UPDATE`) and checks `expected_status`. Accept/sign/pay are idempotent on `(quote_revision_id, action)`. A dial is idempotent on `call_key = lead+route+attempt_n`. One active call per lead (partial unique index). |
| 74 | AI permission capabilities | `business_ai_settings` (`allow_ai_reply`, `allow_ai_interpretation`), `AGENT_OPERATING_MODES` (OFF/SUGGEST_ONLY/AUTO_REPLY), `commercial_authority`, `agent/draft-approval.ts` | **M** Granular: may call, may quote, may discount, may send invoice, may accept a signed quote as WON | Extend `commercial_authority` with `ai_permissions` jsonb validated in `authority.ts` (`quote: NEVER|DRAFT_FOR_APPROVAL|SEND_WITHIN_CATALOGUE`, `discount`, `invoice`, `call_routes[]`). Voice call permission sits on the voice settings row. The validator enforces both. |
| 75 | Release criteria | `docs/revenue-engine/11-final-report.md` gates, todo.md §5 | — | see §11 |

---

## 3. Telephony state today

| Item | State | Consequence for voice |
|---|---|---|
| Platform SMS sender | One number / messaging service (`TWILIO_SMS_FROM`, `TWILIO_MESSAGING_SERVICE_SID`) shared by all workspaces | Voice needs a **per-workspace** number (brief: dedicated, no rotation). SMS could move to it later. |
| Credentials | `env.ts` resolves `AC` vs `SK` (a past bug: `SK` in `TWILIO_ACCOUNT_SID` gave 20404). Auth can be API key; **webhook signature needs the account auth token** | Voice webhooks must verify with the **auth token** (Twilio) and the **Retell** webhook signature (API key HMAC) separately. Add a startup readiness check to `lib/admin/readiness.ts` that fails when `TWILIO_AUTH_TOKEN` looks like an SK secret. |
| Auth-token issue (todo.md §1) | Inbound SMS + status callbacks = 403 in production | **Blocker** for any Twilio voice webhook and for STOP handling. It is owner action O-level and has to be fixed first. |
| Subaccounts | None | Recommended: a Twilio **subaccount per workspace** for number ownership, cost isolation and a clean release on churn. A single account with number tagging is acceptable for v1. Decide in Phase V1. |
| UK regulatory bundle | None | UK numbers need a regulatory bundle (business name, address, registration). The purchase flow collects it from the workspace and submits it via the Numbers API. Pending review = `REQUIRES_SETUP` state. |
| Voice code | None (F1) | Greenfield under `lib/voice/*`. |

---

## 4. Where the quote catalogue lives

| Option | Verdict |
|---|---|
| Put prices in `services.offer_profile` jsonb | **Rejected.** jsonb has no FK from quote lines, no price history, and `offer_profile` is browser-writable through `services`' table grant (CD-22, `offer-profile.ts` header). A priced catalogue must be server-written. |
| New top-level `products` replacing `services` | **Rejected.** `services` is the offer entity across QI, 0144 opportunities (`service_id`), `lead_intent_signals`, `qualification_questions`, bookings and campaigns. Replacing it would fork the model. |
| **`services` = offer; NEW `catalogue_items` (priced lines, FK `service_id` nullable for standalone add-ons); `catalogue_bundles` + `catalogue_bundle_items`; `quote_settings` (workspace); authority stays in `commercial_authority`** | **Chosen.** The offer card (`agent/offer-card.ts`) reads catalogue items for approved price wording. `approved_checkout_links[].price_text` keeps working for direct close; a catalogue item may reference a `checkout_link_id`. Member read, owner/admin write via server actions only (service role), with price columns never browser-writable. |

Hierarchy: `commercial_authority` (may the AI…) → `quote_settings` (how quotes look/behave) → `services` (the offer) → `catalogue_items` (priced lines) → `quotes` / `quote_revisions` / `quote_lines` (frozen copies).

---

## 5. §54 Domain model: concept → table

| Concept | Existing table | New table (proposed) | Notes |
|---|---|---|---|
| Lead / contact | `leads`, `contact_permissions` | — | + `leads.timezone`, `leads.phone_type` |
| Consent to call | `contact_permissions.consent_scope` | — | new scope values; evidence in `consent_evidence` |
| Interest / deal | `opportunities` (0125, 0144) | — | quote & call FK to `opportunity_id` |
| Channel / number | `inbox_channels` | `voice_numbers` | CHECK `+ 'VOICE'` on inbox_channels |
| Voice settings | — | `voice_settings` (1/workspace) | hours, recording, escalation, routes on/off. OD-1 identity: `calling_as_name` (required), `legal_entity_name`, `identification_contact` (address or freephone), `assistant_persona_name` (optional), `opener_suffix` (editable part only) |
| Route | goals (0144 CHECK) | `voice_routes` | goal + trigger + minute allocation |
| Call | — | `voice_calls` | state machine, provider ids, durations, outcome, cost. The OD-1 identity snapshot and `opener_version` are stored per call |
| Call events | — | `voice_call_events` (append-only) | webhook-derived, observability |
| Transcript | `messages` (text) | `voice_transcripts` (or JSONB on call) | R2 for long ones; retention |
| Recording | — | R2 object + `voice_calls.recording_key` | signed URL only |
| Call queue | `jobs` | `voice_call_queue` (priority, not_before, route) | or `jobs` with priority column (extend 0137) |
| Minutes balance | `ai_token_balances/ledger/reservations` pattern | `voice_minute_balances`, `voice_minute_ledger`, `voice_minute_reservations` | or generalise to a `usage_credit_*` family; see Risk R9 |
| Provider cost | `cost_events`, `provider_price_book` | — | new metrics; append-only |
| Objection occurrences | `workspace_sales_overrides` (config only) | `objection_events` | all channels |
| Handover | `agent_handoffs` | — | + delivery mode `LIVE_TRANSFER` |
| Catalogue | `services` | `catalogue_items`, `catalogue_bundles`, `catalogue_bundle_items` | |
| Quote settings | `commercial_authority` (authority only) | `quote_settings` | |
| Quote | — | `quotes`, `quote_revisions` (immutable), `quote_lines` | |
| Quote public access | `checkout_attempts.token` pattern | `quote_access_tokens` (hashed) | |
| Quote events | `domain_events` | `quote_events` (viewed, sent, reminded) | |
| Signature | — | `quote_signatures` | revision hash |
| Invoice | `checkout_payments` (confirmations) | `customer_invoices`, `invoice_schedule_items`, `credit_notes` | payment → `checkout_payments` with `match_kind='INVOICE'` |
| Customer Stripe key | `payment_endpoints` (webhook secret) | `payment_endpoints.kind += 'STRIPE_API'` (restricted key, sealed) | server-only |
| Experiments | `experiments` | — | kind CHECK extended |
| Attribution | `lead_touches` | view `revenue_journey_events` | |
| Entitlements | `plan_entitlements`, `business_entitlement_grants` | — | new metric keys |
| Auto-recharge | — | `auto_recharge_settings` | generic across credits |
| Audit | `audit_log` | — | new actions |

---

## 6. §60 Scattered plan checks to centralise

Literal plan-name checks (grep 2026-09-27). **Voice and quote gates must not add to this list.**

| File:line | Check |
|---|---|
| `app/(app)/layout.tsx:95`, `app/api/search/route.ts:54` | `analytics: plan !== "trial"` (a capability expressed as a plan name) |
| `app/(app)/app/settings/_sections/billing-section.tsx:64,66` | `limits.plan === "trial"` |
| `components/settings/billing/limits-panel.tsx:131` | `plan === "enterprise"` |
| `lib/billing/plans.ts:321` | `creditPurchaseAllowed`: `plan !== "trial"` |
| `lib/billing/limits-service.ts:604`, `jobs/handlers/send-store.ts:323` | trial checks affecting sends |
| `lib/follow-up/channel-strategy.ts:141` | trial halves the SMS allowance share |
| `lib/billing/sourcing-allowances.ts:104-105` | enterprise/trial display |
| `lib/billing/trial-upgrade-prompt.ts:143,245` | trial state |
| `lib/billing/token-service.ts:189` | grant reason |
| `lib/billing/plan-change.ts:43-44,186` | plan ordering (fine: ordering, not capability) |
| `lib/admin/{billing,customers,overview,economics-model,economics-live}.ts` | labels/revenue (fine: admin display) |
| `lib/settings/{queries,types}.ts` | labels |
| `plans.ts` flags `whatsappEnabled`, `campaignsEnabled`, `aiAssistAllowed` + `planThatUnlocks()` | code-side capabilities that duplicate `plan_entitlements` |

The capability checks (analytics, credit purchase, send-affecting trial rules) go behind `can()`. Labels and ordering can stay.

---

## 7. RLS patterns to copy and the §55 test plan

### 7.1 Patterns (copy exactly)

| Pattern | Source | Use for |
|---|---|---|
| **Member-read, service-role-write**: `enable` + `force row level security`; `revoke all from anon, authenticated`; `grant select to authenticated`; policy `using (public.is_business_member(business_id))` | 0134 header, 0143 `checkout_attempts` / `checkout_payments` | `voice_calls`, `voice_call_events`, `voice_numbers`, `quotes`, `quote_revisions`, `quote_lines`, `quote_events`, `quote_signatures`, `customer_invoices`, `credit_notes`, `objection_events`, minute balances/ledger |
| **Server-only (no browser policy)**: RLS on, revoke all, read through a redacted view via service role | 0143 `payment_endpoints`; 0116 `ai_token_reservations`; 0018 `cost_events` | provider secrets, customer Stripe restricted key, `voice_minute_reservations`, `quote_access_tokens`, `cost_events` voice rows, raw provider webhook payloads |
| **Owner/admin-only writes from the browser** (only where needed) | `has_business_role(business_id, array['owner','admin'])` (0010), `services_insert` policy | Prefer server actions + service role over browser writes. Catalogue prices are **not** browser-writable (see §4). |
| **Data-rights hooks**: cascade on lead delete, clear PII on `leads.anonymised_at`, refuse new rows for anonymised leads | 0134 §8, 0143 `direct_sale_clear_on_anonymise()`, 0124 `data_rights_retention_candidates()` | transcripts, recordings (delete R2 object via job), signer name/IP, invoice email |
| **Immutable rows**: trigger raising on UPDATE/DELETE | ledger tables (`message_credit_ledger` idempotency), 0129 | `quote_revisions`, `quote_lines`, `quote_signatures`, `voice_minute_ledger`, `cost_events` (new) |
| **Server-only import boundary** | memory "server-only boundary"; `import "server-only"` in `messaging/twilio.ts` | `lib/voice/providers/*`, `lib/quotes/server/*`; pure calc in sibling `types.ts` / `calc.ts` |

### 7.2 Test plan (§55)

| # | Test | Where |
|---|---|---|
| T1 | Cross-tenant: member of A cannot select any B row in each new table | `tests/rls-new-tables.test.ts` (extend; local Supabase stack needed) |
| T2 | `authenticated` cannot insert/update/delete any new table (service-role-write) | same |
| T3 | anon has no access to any table, including via the quote token | same |
| T4 | Public quote page: token is ≥128-bit random, stored as SHA-256; lookup by hash; constant-time compare; expired/voided/superseded token → 404-equivalent without leaking existence; rate-limited (`rateLimitResponse`) | `tests/quote-public-access.test.ts` |
| T5 | Quote page renders **the frozen revision only**; editing the draft never changes a sent revision; PDF hash equals stored hash | `tests/quote-lifecycle.test.ts` |
| T6 | Signature endpoint: CSRF-safe POST with token + revision id + email OTP; replay → idempotent; signing a superseded revision refused; captured IP/UA/time/hash stored; no PII in logs | `tests/quote-signature.test.ts` |
| T7 | Provider webhooks: bad signature → 403 and no `webhook_events` row; duplicate id → one row; out-of-order events don't regress the call state | `tests/voice-webhooks.test.ts` |
| T8 | Entitlement: every voice entry point refuses a workspace without `voice_enabled` (dial, inbound answer → polite fallback message, callback, test call, MCP, API) | `tests/voice-entitlement.test.ts` |
| T9 | `canCallLead`: no consent basis / suppressed / TPS-flagged sole trader / outside recipient hours / opted-out → blocked with reason | `tests/can-call-lead.test.ts` |
| T10 | Service-role key and provider secrets never appear in client bundles or responses (existing `service-role-exposure` checks) | build check |
| T11 | Recording URLs: only via `createDownloadUrl`, 300 s, member-checked; object key not guessable | `tests/voice-recordings.test.ts` |

---

## 8. §56 Jobs and §57 webhooks

### 8.1 Jobs (register in `lib/jobs/registry.ts`; handlers retry-safe, re-read state first)

| Job | Trigger | Idempotency |
|---|---|---|
| `voice.dial` | queue row due (priority, not_before) | `call_key`; re-check entitlement, minutes, `canCallLead`, hours, concurrency, lead state immediately before dialling |
| `voice.webhook_ingest` | Retell/Twilio webhook row | `webhook_events` unique |
| `voice.post_call` | call ended | per call: extract facts (QI extractors), objections, summary, NBA, settle minutes, cost event |
| `voice.recording_fetch` | recording ready | copy provider → R2, then delete at provider (retention minimisation) |
| `voice.no_answer_fallback` | no-answer/voicemail | hands to follow-up engine with frequency guard |
| `voice.number_provision` / `voice.number_release` | settings action / churn | provider order id |
| `voice.reconcile_costs` | daily | provider call list vs `voice_calls`; append correcting `cost_events` |
| `voice.capacity_forecast` | daily | read-only |
| `quote.render_pdf` | revision frozen | revision id |
| `quote.nudge` / `quote.expire` | schedule | per quote + nudge n; expiry → re-engagement trigger |
| `invoice.issue` / `invoice.remind` / `invoice.schedule_due` | schedule | invoice id + step |
| `auto_recharge.charge` | balance below threshold | `(business, threshold_crossing_id)`; monthly cap |
| Retention: extend `retention-cleanup.ts` | daily | recordings and transcripts past retention |

### 8.2 Webhooks (verify → `webhook_events` row → ack fast → queue; no provider I/O inline)

| Endpoint | Verification | Dedupe key |
|---|---|---|
| `api/webhooks/retell` (NEW) | Retell signature header (HMAC with API key) | `call_id:event` |
| `api/webhooks/twilio/voice` (NEW: status callbacks, inbound call TwiML for routing to Retell) | `X-Twilio-Signature` with the **auth token** (F7) | `CallSid:CallStatus` |
| `api/webhooks/twilio` (existing SMS) | same | unchanged |
| `api/webhooks/payments/stripe/[endpointId]` (existing, 0143) | customer's signing secret | extend event handling for invoice Checkout Sessions (`client_reference_id` = invoice token) |
| `api/webhooks/stripe` (existing, ClientTurn billing) | platform secret | add voice pack / number add-on / auto-recharge PaymentIntents |
| `api/webhooks/calendly` (existing), Google Calendar (sync job) | existing | unchanged; Booking Close route reuses them |
| Replay | `jobs/handlers/webhook-replay.ts`, `connector.replay_event` op | extend to the new providers |

---

## 9. §53 Adjacent gaps checklist

| Gap | State | Owner phase |
|---|---|---|
| Consent provenance (who/when/how a call was allowed) | P (`contact_permissions` evidence fields) | V1 |
| Contact preferences | E (0147 `preferred_contact_channel`), pending apply | — |
| Catalogue | M | Q1 |
| Commercial authority | E, extend | Q1 |
| Margin floor | M | Q1 |
| Approval chains (quote above X or discount above Y → owner/admin approval) | M; pattern `draft-approval.ts`, `mcp_approvals` | Q2 |
| Deposits / refunds | M (customer side); ClientTurn refunds in `refundability.ts` | Q3 |
| Quote expiry → reactivation | M | Q3 |
| Inbound call-back | M | V3 |
| Recipient timezones | M (F8) | V1 |
| Fallback on call failure | M | V3 |
| Tool failure mid-call (calendar down, calc error) | M; text-side degrade exists | V2: deterministic "I'll text you the times" fallback |
| Provider outage | P (`platform_provider_checks`, `integration-health` job) | V4: circuit breaker per provider, pause the dial queue |
| Number reputation (spam-likely labels, answer-rate drop) | M | V4: monitor answer rate per number and pause; **never rotate** to evade |
| Retention | P framework | V2 |
| Multi-currency | P (currency on checkout rows) | Q1: quote currency fixed per quote; no FX conversion |
| VAT | M (workspace and ClientTurn, F10) | Q1 |
| Audit | E, extend actions | all |
| RBAC | E | all |
| Agency isolation (an agency running several client workspaces) | E by `business_id` RLS; there is no parent-agency model | out of scope; note in release criteria |

---

## 10. Migration numbering

| Number | Status | Owner |
|---|---|---|
| 0138–0142 | written; 0138 status per economics.md "not yet applied" at time of writing, then assumed applied by later work. Untracked in git | other agents |
| 0143 direct-sale loop | **pending apply** | payment-loop agent |
| 0144 lead interests | **pending apply** | multi-interest agent |
| 0145 live economics | applied | — |
| 0146 re-engagement loops | pending apply | re-engagement agent |
| 0147 elite closer | pending apply | sales-craft agent |
| 0148–0149 | **leave free** for in-flight WhatsApp tokens / intent catalogue / upsells | others |
| **0150** `voice_foundation` (voice_settings, voice_numbers, inbox_channels VOICE, contact scope values, leads.timezone, entitlement rows) | proposed | Agent A |
| **0151** `voice_calls` (calls, events, queue, objection_events, minute balance/ledger/reservations, cost_events append-only) | proposed | Agent B |
| **0152** `catalogue_and_quote_settings` | proposed | Agent C |
| **0153** `quotes` (quotes, revisions, lines, access tokens, events, signatures) | proposed | Agent C |
| **0154** `customer_invoicing` (invoices, schedule, credit notes, payment_endpoints kind, checkout_payments match_kind) | proposed | Agent D |
| **0155** `commercial_authority_v2` + `experiments` kinds + automation event CHECKs + auto-recharge | proposed | Agent E |
| **0156** `admin_economics_voice` (replace `admin_economics_usage`) | proposed | Agent F |

Rule (memory "parallel sessions collide"): **re-list `supabase/migrations` immediately before creating a file.** If the number is taken, take the next free number and update this table. 0150+ depends on 0143 (payment_endpoints, checkout_payments) and 0144 (`opportunities.service_id`), so apply those first.

---

## 11. Build phases and file ownership (6 parallel agents, disjoint files)

### 11.1 Phases

| Phase | Goal | Gate to exit |
|---|---|---|
| **P0 Prerequisites** (owner + coordinator) | Fix the Twilio auth token (F7); apply 0143/0144/0146/0147; Stripe TEST prices; decide on Stripe Tax; add Retell to sub-processors text (owner review); decide Twilio subaccounts | inbound SMS 200; migrations applied; types regenerated |
| **P1 Foundations** | Capabilities module + voice/quote entitlements; provider interfaces + stubs; catalogue + quote settings schema; pure calc; `canCallLead` + recipient tz | unit tests green; RLS tests for new tables |
| **P2 Core engines** | Call state machine, queue, minute reservation, Retell/Twilio adapters (TEST numbers), turn adapter; quote lifecycle + revisions + public page + PDF + signature | 20 voice scenarios pass on stub; quote lifecycle tests |
| **P3 Money** | Customer invoicing + customer-Stripe collection + reminders + credit notes; voice packs + number add-on + auto-recharge on ClientTurn Stripe TEST | TEST-mode end-to-end: quote → sign → deposit paid → WON; pack purchase → minutes credited once |
| **P4 Surfaces** | Settings Voice / Quotes & invoices; inbox call card; lead calls/quotes tabs; automations events; NBA channel orchestration; quote follow-up + expiry → re-engagement | every route has loading/empty/error/permission/integration/plan-limit states |
| **P5 Insight + ops** | Attribution view + models; quote analytics; experiments decide/promote/rollback; ROI card; admin Voice ops + GM monitor; observability | analytics tests; admin economics shows voice lines |
| **P6 Public + release** | Pricing/marketing copy (voice paid, quote-to-cash, no "unlimited"), help articles, release evidence | §11.3 criteria |

### 11.2 Ownership (disjoint files)

| Agent | Owns (creates/edits only these) | Must not touch |
|---|---|---|
| **A: Voice platform & compliance** | `lib/voice/providers/*`, `lib/voice/{entitlement,eligibility,hours}.ts`, `lib/twilio/credentials.ts` (extracted; one-line import change in `messaging/twilio.ts` agreed with owner of messaging), `lib/billing/capabilities.ts`, `policy/channel-policy.ts` (VOICE channel + recipient tz only), migration **0150**, `api/webhooks/retell/*`, `api/webhooks/twilio/voice/*`, tests `voice-entitlement`, `can-call-lead`, `voice-webhooks` | agent/*, quotes, billing packs |
| **B: Voice conversation runtime** | `lib/voice/{call-state,pacing,attempts,turn-adapter,post-call,queue}.ts`, `agent/types.ts` (add `voice` only), `agent/voice-style.ts` (new), `jobs/handlers/voice-*.ts`, `jobs/registry.ts` (append entries), `sales-library/objection-events.ts`, migration **0151**, `tests/voice-scenarios.test.ts`, `tests/call-state.test.ts` | `agent/orchestrator.ts` beyond one call-site hook, reviewed with the sales-craft agent |
| **C: Catalogue + quotes + signature** | `lib/quotes/*` (calc, lifecycle, discount-guard, tokens, pdf), `lib/catalogue/*`, `services/operations/quotes.ts` + registry entries, `agent/tools.ts` (quote tools appended), `app/(public)/q/[token]/*`, `storage/r2.ts` (new kinds only), migrations **0152–0153**, quote tests | invoices, commercial_authority schema |
| **D: Invoicing + collection** | `lib/invoicing/*`, `payments/*` extensions for `INVOICE` matching, `api/webhooks/payments/stripe/[endpointId]` (invoice events), `jobs/handlers/invoice-*.ts`, migration **0154**, invoice tests | ClientTurn's own billing (`lib/billing/*`) |
| **E: Commercial rules, automations, orchestration, experiments** | `commercial/authority.ts` (v2 schema), `components/settings/business-profile/direct-close-editor.tsx` (moved), `automation/event-types.ts`, `qualification-intelligence/nba.ts` + `follow-up/channel-strategy.ts` (CALL / SEND_QUOTE actions), `reengagement/triggers.ts` (quote expiry), `learning/decide.ts`, migration **0155** (except auto-recharge) | voice runtime, quote calc |
| **F: Billing, economics, analytics, UI + public** | `billing/{plans,tokens,checkout,voice-packs,auto-recharge}.ts`, `unit-costs.ts` voice constants, `api/webhooks/stripe` (pack events), `admin/economics-*`, admin Voice ops page, `analytics/{attribution,quote-metrics}.ts`, `revenue_journey_events` view, settings sections `voice-section.tsx` + `quotes-section.tsx`, `components/voice/*`, lead tabs/cards, marketing pricing/product copy, migration **0156** + auto-recharge table | `economics.md` (coordinator merges) |

Shared hot files that need one owner and serial edits: `agent/types.ts` (B), `agent/tools.ts` (C), `services/registry.ts` (C appends; others request), `jobs/registry.ts` (B appends; D requests), `lib/audit.ts` `AuditAction` union (F collects additions), `database.types.ts` (regenerated once per phase by the coordinator).

### 11.3 §75 Release criteria

| # | Criterion |
|---|---|
| R1 | No voice path reachable without `voice_enabled` (T8) and without a passing `canCallLead` (T9); proven by tests and one TEST call per route. |
| R2 | Every call starts with the locked OD-1 opener (AI disclosure, calling-as name, enquiry day, "Is now an OK time") and then the recording notice when recording is on. Voice cannot be enabled without the identity fields. The identity is snapshotted per call. An opt-out mid-call suppresses the lead. The script has been lawyer-checked (R15). |
| R3 | Minutes reserved before dialling and settled once; the ledger reconciles to provider cost within 2%. |
| R4 | Voice packs ≥ 77% GM at the documented COGS (economics.md merge); admin alert under 77%. |
| R5 | Quote totals are produced only by `calc.ts`; the validator blocks any unapproved money figure; revisions immutable; PDF hash matches. |
| R6 | Signature evidence complete; wording claims "electronic signature", never "qualified" or "eIDAS-qualified". |
| R7 | All Stripe objects in TEST mode; no live-account writes. |
| R8 | RLS tests T1–T3 green on a local stack; public token tests T4–T6 green. |
| R9 | Routes have all six states; the Settings IA keeps 5 primary destinations. |
| R10 | Sub-processors, privacy notice and help articles updated and owner-reviewed. |

---

## 12. Risks and dependencies

| # | Risk | Detail | Mitigation |
|---|---|---|---|
| R1 | **PECR reg 19: automated calling systems** | Automated calls with recorded/synthetic marketing content need **prior specific consent** from the subscriber. This applies to corporate subscribers too. An AI voice agent is very likely an "automated calling system" for this purpose. TPS/CTPS screening (reg 21) covers **live** marketing calls, and consent overrides it. | Voice only to leads with `CALL_REQUESTED` or explicit call consent captured on the form (wording stored). No cold AI calls (todo.md already says so). A `PHONE_NUMBER_PROVIDED` basis alone is **not** consent to automated marketing calls: treat it as *service follow-up about their enquiry* only, and have legal confirm before enabling it. Default off. |
| R2 | UK call recording notice | UK GDPR transparency + Article 6 basis. Callers must be told at the start. | Opening line template (non-removable) + privacy notice section; recording off by default or on with notice; retention default 90 days. |
| R3 | e-Signature claims | UK law (ECA 2000, UK eIDAS) accepts simple e-signatures for most commercial contracts. "Advanced/qualified" needs specific tech and a trust service. | Describe it as "electronic signature with audit trail". Never "eIDAS-qualified" or "legally binding in all cases". Some documents (deeds, certain guarantees) are excluded, so show a note. |
| R4 | VAT | ClientTurn's own VAT (F10) is unresolved. Workspace quotes need correct VAT treatment (rates, reverse charge, VAT number shown). | Deterministic VAT from item rate + workspace registration; no AI VAT decisions; show "VAT registration: not set" state. Decide Stripe Tax for ClientTurn (owner). |
| R5 | Stripe TEST only | `.env` holds live keys for Propvora; `env.ts` blocks live in `_TEST`. Customer-side collection uses the **customer's** Stripe key. | Keep the guard; tests assert `livemode=false`; the customer restricted key is sealed and scoped (Checkout Sessions write + read only). |
| R6 | Working-capital protection | ClientTurn pays Retell/Twilio in arrears (or prepaid USD) while customers prepay minutes. Auto-recharge failure or chargebacks leave a gap; the USD cost is FX-exposed. | Prepaid only (no overage, 0141); reserve before dial; hard stop at 0; auto-recharge with a monthly cap and 3DS-safe off-session charges; refund policy per `refundability.ts` (unused packs only); FX buffer in pricing; provider balance alerts in admin. |
| R7 | Twilio auth token (F7) | Blocks inbound SMS/STOP today; blocks voice webhooks. | P0 owner action. |
| R8 | Number reputation | Carrier "spam likely" labels on outbound numbers; the brief forbids rotation. | One number per workspace; branded caller ID where available; answer-rate monitor pauses the dial queue; volume/concurrency caps. |
| R9 | Balance-model sprawl | AI tokens, SMS credits, WhatsApp tokens and now voice minutes: four ledgers. | Voice copies the **AI token** reserve/settle shape exactly. Recommend a later consolidation into one `usage_credit_*` family (not in this programme). |
| R10 | Realtime latency | Retell calls the LLM per turn; the current agent path is job-queued with a ~4k-token envelope. | Turn adapter uses a cached prefix, a voice-specific short envelope, and deterministic tools; latency budget measured in scenarios. |
| R11 | Parallel edits | `agent/*`, `jobs/registry.ts`, `services/registry.ts`, `plans.ts` are hot. | Ownership table §11.2; coordinator merges hot files. |
| R12 | Pending migrations | 0143/0144 are prerequisites for invoicing and per-interest quotes. | P0 applies them. |
| R13 | No PDF library | Adding a server-side PDF dependency increases serverless bundle size. | Choose a pure-JS renderer; render in a job, not in the request. |
| R14 | "Unlimited" copy | `plans.ts` feature strings | Fix in P6 (Agent F). |
| R15 | **Fixed call script: owner to get it lawyer-checked** | The OD-1 opener ("This is an AI assistant calling from {calling_as_name} about the enquiry you sent us on {day}. Is now an OK time for a couple of minutes?"), the recording notice, and the identification-on-request answer (legal entity + address/freephone). Not naming ClientTurn is also part of the check. | Owner action before any live call. Wording lives in one versioned module (`lib/voice/opener.ts`, `opener_version` stored per call), so a lawyer's change is a single edit. |

---

## 13. Top 10 gaps (priority order)

| # | Gap |
|---|---|
| 1 | There is no voice channel, provider abstraction, call model or webhook at all (F1, F2). |
| 2 | Twilio auth-token misconfiguration returns 403 on all Twilio webhooks (F7). It is a prerequisite for voice. |
| 3 | There is no call-consent basis or `canCallLead` gate, and no recipient-local calling hours (F8), so PECR reg 19 exposure is unmitigated. |
| 4 | There is no priced catalogue. `services` has only `average_value`, and prices live as free-text `price_text` on checkout links. |
| 5 | There is no quote engine: no deterministic calc, lifecycle, immutable revisions, public page, PDF or e-signature. |
| 6 | There is no customer invoicing (deposits, instalments, reminders, credit notes). The 0143 loop confirms payments only, and is unapplied. |
| 7 | There is no voice minute ledger, reservation, concurrency control or auto-recharge. `cost_events` is not append-only and under-states some channels. |
| 8 | Capability entitlements are scattered (literal plan checks, §6) and there are no voice/quote capability keys. |
| 9 | Discount control is a single `max_discount_percent`, with no margin floor, restraint mode or approval chain, and the AI has no granular permissions (§74). |
| 10 | Attribution is first-touch only, with no journey view and no multi-touch or quote analytics. Experiments have no promote/rollback. The Settings/inbox/lead surfaces have no voice or quote UI. |
