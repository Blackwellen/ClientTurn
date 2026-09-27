# ClientTurn — plan economics

Tracker item 8.14 (`docs/revenue-engine/06-coverage-tracker.md`). Written 2026-09-27.

> **Read this first.**
> - All figures are **GBP, ex-VAT**, per workspace per month unless stated.
> - USD prices are converted at **£0.7549 per $1** (GBP/USD 1.3246, the mid-market rate on 2026-09-27; source A21). The code uses a more conservative `USD_TO_GBP = 0.8` (`src/lib/ai/budget.ts`). At 0.8, every USD-priced cost below is about 6% higher.
> - Every provider price was checked on **2026-09-27** against the URL listed in the Appendix. Where a price could not be verified against the provider's own page, the text says so.
> - **ASSUMPTION** marks every input that is not a fact from the repo, the database or a provider. Change these to your own figures. The formulas are shown next to them.
> - Part 1 is facts and arithmetic. The **recommendations are in Part 9 only**.
> - No live traffic exists yet, so **no figure here is a measured cost per customer**. Costs are modelled from allowances × unit prices.
>
> **Revision 2026-09-27 (cost and margin work).** Three owner rules were applied the same day, and the catalogue was changed to meet them:
> 1. **A trial must cost at most 50p to run** (worst-case marginal cost). New figure: **£0.486** (§2).
> 2. **Every plan and billing interval must have at least 75% gross margin at maximum usage**, on the §1.1 method, while staying competitive. Prices are unchanged. Included SMS was re-sized, WhatsApp became a paid add-on, and bundles were re-priced (**Part 10**). Overage was then removed altogether (item 4).
> 3. **Per-lead cost is cut by channel, SMS and token budgeting.** The default follow-up is now "SMS for the first message, email after". A lead on the SMS path costs **£0.093, down from £0.218** (§3.6).
> 4. **No overage, anywhere** (owner decision, later the same day: "it will get abused, make them top up"). Prepaid top-up credit is the only way past an allowance. SMS and WhatsApp go plan allowance → top-up credit → refused; verified prospects, sourcing runs and outreach email stop at the allowance until the next period or an upgrade. There is no "Allow automatic overage" control and no monthly additional spend cap. The plan margins at maximum usage are **unchanged** by this (§10.2: Starter 80.0% / 77.4%, Growth 79.0% / 76.1%, Pro 78.4% / 75.4%, monthly / annual), because the max-usage model never counted overage revenue. Removing overage can only remove revenue above the allowance, never add cost: every unit past the allowance is now either prepaid at ≥ 75% margin (§10.3) or not sent.
>
> 5. **WhatsApp is priced to compete with WhatsApp specialists, in tokens** (owner decisions, later the same day: "we must be competitive with WhatsApp specialists"; and WhatsApp is sold as non-monetary **WhatsApp tokens**, never a £ balance). WhatsApp is the one purchase allowed below 75%: the owner's target is about 50% (todo.md §4), with a hard floor of cost + 25%. A conversation reply or utility template costs 2 tokens (4p), a marketing template 5 tokens (10p), at 2p a token in 1,000 / 2,000 / 5,000-token packs (£20 / £40 / £100). There is no WhatsApp platform fee. The flat 27p a message is gone (§5.4, §10.3, §10.4). Plans are unaffected: they include no WhatsApp.
>
> Parts 0–9 below keep the **baseline** analysis ("before"), updated where a figure changed. Part 10 is the new catalogue and its proof. The unit costs and the margin model are code: `src/lib/billing/unit-costs.ts`, pinned by `tests/plan-margins.test.ts`.

---

## 0. Inputs

### 0.1 Plans (facts from the repo)

Source: `src/lib/billing/plans.ts` (`PLANS`, `TRIAL`, `ANNUAL_DISCOUNT_PERCENT = 15`), `src/lib/billing/sourcing-allowances.ts`, and the live `plan_entitlements` table (read 2026-09-27). The code and the table agree for every row below.

> **This is the BASELINE catalogue (before the 2026-09-27 revision).** The revised catalogue is in §10.1: it is in `plans.ts` now, and migration `0138_margin_catalogue_and_channel_budget.sql` (**not yet applied**) seeds it. Until 0138 is applied, the live `plan_entitlements` rows still hold the baseline values below. Runtime reads the table first, so the database enforces those old values until then.

| | Starter | Growth | Pro | Enterprise | Trial |
|---|---|---|---|---|---|
| Monthly price | £99 | £199 | £399 | Contact sales (`null`) | £0, 14 days |
| Annual price = monthly × 12 × 0.85, rounded | £1,010 (£84.17/mo) | £2,030 (£169.17/mo) | £4,070 (£339.17/mo) | — | — |
| New leads / month (hard) | 100 | 400 | 1,000 | 100,000 (code only; **no `lead_processed` row in the DB**) | 25 |
| Users | 1 | 3 | 10 | 100 | 1 |
| Outbound SMS segments | 250 | 800 | 1,800 | 100,000 | 50 |
| WhatsApp messages | 0 (off) | 1,000 | 3,000 | 100,000 | 0 (off) |
| AI tokens (hard) | 1M | 4M | 12M | 40M | 100k |
| Reactivation contacts | 100 | 500 | 2,500 | 100,000 | 0 |
| Verified prospects (hard) | 100 | 500 | 2,000 | 10,000 | 0 (sourcing off) |
| Search runs (hard) | 10 | 50 | 200 | 1,000 | 0 (sourcing off) |
| Outbound email (hard, customer's own mailbox) | 2,000 | 8,000 | 25,000 | 100,000 | 0 (cold email off) |

The baseline also priced overage per unit (SMS, WhatsApp, verified prospects, email). **Overage was removed entirely on 2026-09-27**, so those rows are no longer shown.

**Top-ups** (`plans.ts` `MESSAGE_CREDIT_BUNDLES`, `billing/tokens.ts` `TOKEN_PACKS`). Credits never expire. They are spent after the allowance, and are the only way past it (`billing/limits.ts`).

| Bundle | Price | Per unit |
|---|---|---|
| SMS 100 / 500 / 1,000 segments | £9 / £40 / £75 | 9p / 8p / 7.5p |
| WhatsApp 250 / 1,000 messages | £15 / £50 | 6p / 5p |
| AI tokens 0.5M / 2M / 6M | £15 / £49 / £129 | £30 / £24.50 / £21.50 per 1M |

**There is no overage** (2026-09-27). At the allowance, a send uses prepaid credit or is refused (`limits.ts` `splitConsumption`).

### 0.2 Unit costs

| # | Item | Provider price (date checked 2026-09-27) | In GBP | Repo value | Match? |
|---|---|---|---|---|---|
| U1 | Twilio UK outbound SMS, per segment (mobile number or alphanumeric sender) | $0.056 (A1) | £0.0423 | `provider_price_book` twilio/uk_sms_outbound_segment $0.056 | Yes |
| U2 | Twilio UK inbound SMS, per message | $0.0075 (A1) | £0.0057 | price book $0.0075 | Yes |
| U3 | Twilio UK mobile number, per month | $2.50 (A1). Local number $1.15. Alphanumeric sender ID: free | £1.89 | price book $2.50 | Yes |
| U4 | Twilio failed-message processing fee | $0.001 per failed message (A1) | £0.0008 | none | Not in price book (negligible) |
| U5 | Twilio WhatsApp fee, per message **sent or received** | $0.005. Twilio passes Meta's fee through with no markup (A2) | £0.0038 | price book twilio/whatsapp_message $0.005 | Yes, but see note 1 |
| U6 | Meta WhatsApp UK **marketing** template | $0.0635 (A4, A5; rate card effective 2026-07-01) | £0.0479 | none | **Not in price book** |
| U7 | Meta WhatsApp UK **utility** template (outside the window) | $0.0220 (A4, A5) | £0.0166 | none | **Not in price book** |
| U8 | Meta WhatsApp UK **authentication** | $0.0220 (A4, A5) | £0.0166 | none | not used by ClientTurn |
| U9 | Meta WhatsApp **service** (free-form reply inside the 24h window) | Free until 2026-09-30. **From 2026-10-01, charged at the utility rate**, and utility templates inside the window stop being free too (A3, Meta primary) | £0.0166 from 1 Oct | none | **Not in price book** |
| U10 | Azure OpenAI gpt-5.4-mini, per 1M tokens (input / cached / output) | $0.75 / $0.075 / $4.50 (A6 OpenAI list price; A7 Azure, secondary) | £0.566 / £0.057 / £3.40 | `ai_model_tiers` tier 2 and price book: identical | Yes (see note 2) |
| U11 | Azure OpenAI gpt-5.4-nano, per 1M tokens | $0.20 / $0.02 / $1.25 (A6, A7) | £0.151 / £0.015 / £0.944 | `ai_model_tiers` tier 1: identical | Yes (see note 2) |
| U12 | Resend transactional email | Pro $20/month for 50k, then $0.90 per 1,000 (A8) | $0.0004 each at Pro volume ≈ £0.0003 | price book resend $0.0004 | Yes |
| U13 | Campaign / cold email | Sent through the customer's own mailbox (Gmail API, Microsoft Graph, SMTP) | £0 | price book google & microsoft $0 | Yes |
| U14 | Google Places Text Search, per request | The field mask requests `places.websiteUri`, which bills the **Text Search Enterprise** SKU: $35 per 1,000 requests, 1,000 free per month per billing account (A9, A10). Up to 20 results per request (`pageSize: Math.min(20, limit)`) | £0.0264 per request | Price book has no Google row. Find Leads meters `COMPANY_SEARCH` at a hard-coded 1p per **record** (`find-leads/cost-model.ts`) | See note 3 |
| U15 | Companies House API | No charge is published. The rate limit is 600 requests per 5 minutes (A11) | £0 (ASSUMPTION: free) | `companies-house.ts` `freeOfCharge: true` | — |
| U16 | Website contacts and website intent | Our own fetcher. The AI parse (`website_contacts`, nano) draws on the token allowance | £0 external | `freeOfCharge: true`. Price book website_intel $0.001 is a "Seeded placeholder" | — |
| U17 | Stripe UK cards | Standard UK 1.5% + 20p. Premium UK 2.8% + 20p. EEA 2.5% + 20p. International 3.15% + 20p. +2% for FX (A12) | — | — | — |
| U18 | Stripe Billing | 0.7% of billing volume, pay-as-you-go (A12) | — | — | — |
| U19 | Stripe card verification for the card-first trial | **No fee is published** for SetupIntents or $0 authorisations on standard pricing (A12, A13) | ASSUMPTION: £0 | `checkout.ts` `payment_method_collection: "always"` | Unverified |
| U20 | Supabase Pro | $25/month incl. $10 compute credit (Micro). 8 GB disk, then $0.125/GB. 250 GB egress, then $0.09/GB (A14) | £18.87 | — | — |
| U21 | Vercel Pro | $20/seat/month incl. $20 usage credit (A15). **Hobby is "restricted to non-commercial personal use only"** (A16) | £15.10 | `docs/CRON.md` says the deployment is on Hobby | See Part 6 |
| U22 | Cloudflare R2 | $0.015/GB-month. Class A $4.50/M, Class B $0.36/M. Egress free. Free tier: 10 GB, 1M A, 10M B (A17) | ≈ £0 at our scale | — | — |

**Notes**

1. **The price book under-states WhatsApp cost.** `twilio/whatsapp_message` ($0.005) is only Twilio's fee. There is no row for Meta's category fee. A UK marketing template really costs $0.0685 ($0.0635 + $0.005), about 13× the booked figure. Any admin cost view built from `cost_events` will under-report WhatsApp cost by the same factor.
2. **Azure pricing page not machine-readable.** Azure's own page could not be read. The Microsoft Q&A answer (A7) shows the table only as an image. The figures match OpenAI's list price (A6) and a secondary Azure calculator (A7b). **Unverified:** whether an EU Data Zone deployment carries a premium over Global. AI is under 5% of cost at every tier (below), so even a +10% premium changes no conclusion.
3. **Find Leads metering does not read the price book.** `loadUnitCosts()` (`find-leads/server/budget.ts:94`) selects rows `where product in CAPABILITIES` ("COMPANY_SEARCH", ...). The seeded rows are named `company_lookup`, `contact_profile` and so on, and carry the capability in a separate `capability` column. So nothing matches, and every run is estimated from `FALLBACK_UNIT_COST_MINOR`. The same function also reads a USD `unit_cost` × 100 as **pence**, with no FX. This is recorded as a finding only; no code was changed.
4. **Meta's UK rates are from secondary sources.** Two independent BSP publications (A4 Drag, A5 SleekFlow) give identical figures, and both cite Meta's rate card effective 2026-07-01. Meta's own pricing page (A3) links the rate card as a downloadable file, which could not be read. **Treat U6–U8 as verified by two secondary sources, not by the primary.** One other search snippet gave utility as $0.0034 and was not corroborated. Meta's primary page (A3b) says service messages are charged from 1 October 2026 with "no volume tiers". Some BSPs mention 1,000 free service messages per number per month; **that allowance is not stated by Meta and is not used here.**

### 0.3 Token counts (facts from the repo)

| Figure | Value | Source |
|---|---|---|
| `agent_decision` system prompt | 1,115 tokens. Static, and sent first; the per-workspace offer card (≤ 600) comes next and the per-turn block last. So the cacheable prefix is about 1,715 tokens, above Azure's 1,024-token caching minimum | `tests/fixtures/prompt-token-snapshot.json`; `ai/model-router.ts` |
| NBA strategy block per turn | mean 75, max 92 tokens (legacy 151 / 186) | same file, `turn.nba_strategy_block` |
| Conversation context per turn (2026-09-27, lossless) | SMS thread **578 → 343** tokens; email thread **1,821 → 1,364**. What changed: the current message is sent once (it had been sent twice), and the untrusted-content notice appears once rather than before every lead message. **Nothing is truncated**: every loaded message still goes whole, under the owner rule "no token trimming that removes facts". A bounded mode (500 characters a message, 2,800 in total) is kept in `BOUNDED_TRANSCRIPT_LIMITS`. It would cut the email thread to 972. It is measured only and not used by a live turn | `src/lib/agent/transcript.ts`; snapshot `conversation_blocks` |
| Turn input (estimated at characters ÷ 4) | SMS **2,368 → 2,133** (−10%); email **3,611 → 3,154** (−13%) | snapshot `agent_turn_input` |
| Per-lead AI token ceiling | **250,000 tokens per lead, lifetime** (about 90 turns). This is an **abuse ceiling**, not a budget: a golden conversation uses 2.04 model turns. It applies when no `ai_budgets` LEAD row sets `ceiling_tokens`, and reaching it hands the lead to a person. A qualified lead (OPPORTUNITY) has its own ceiling. A 40k (~14-turn) cap was built first and then raised: it would have cut long live conversations | `ai/budget.ts` `DEFAULT_LEAD_TOKEN_CEILING` |
| Tier routing | Classification, answer extraction, social-reply classification and website contacts run on **nano** (tier 1). Composing tasks (agent decision, summaries, briefs, copy) run on **mini** (tier 2). Already optimal; unchanged | `ai/tiers.ts`, `ai_model_tiers` |
| `agent_decision` envelope (mini) | 4,000 in / 400 out | `src/lib/ai/tiers.ts` `TASK_TOKEN_ENVELOPES` |
| `answer_extraction` (nano) | 900 / 200. Runs only when the rules read nothing and the reply is ≥ 20 chars | same; `docs/revenue-engine/10-qualification-engine-report.md` §14 |
| `handoff_brief` (mini) | 1,500 / 200 | same |
| `reactivation_copy` (mini) | 800 / 200. Only when "Personalise with AI" is on | same; `jobs/handlers/campaign-send.ts:301` |
| `conversation_summary` (mini) | 2,500 / 250. Only once a conversation reaches 14 messages | same; `agent/types.ts` `SUMMARY_TRIGGER_MESSAGE_COUNT = 14` |
| `copilot_turn` (mini) | 6,000 / 800 | same |
| `website_contacts` (nano) | 6,000 / 900 | same |
| UI yardstick | **2,750 tokens per "assistant reply"**. It was 1,700, which over-stated replies by about 60%. The plan copy now reads about 360 / 1,450 / 2,180 replies for 1M / 4M / 6M | `billing/tokens.ts` `TOKENS_PER_CONVERSATION_TURN` |
| Golden conversations | 24 conversations, **49 turns → 2.04 turns per conversation** | report 10 §13 |
| Turns that need no model call | **18/49 = 37%** (report 10 §13, 11 Part P). A run of `tests/golden-conversations.test.ts` today prints `modelCallsAvoided=21/49` (**43%**). **The "29%" in the brief does not appear anywhere in the repo**, so this document uses the documented 37% and shows 0% as the worst case | report 10; test output 2026-09-27 |
| Turns that send no message | WAIT 3 + NO_ACTION 3 of 49 → **43/49 turns send a reply** | test output 2026-09-27 |
| AI overdraw ceiling | 10% of included tokens | `ai/tokens.ts` `OVERDRAW_CEILING_RATIO = 0.1` |
| AI £ ceilings (live `ai_budgets`) | Pre-reply 20p/lead. Per lead £2. Per opportunity £10. Plan/month: trial £3, Starter £15, Growth £50, Pro £150. Emergency £500/month per workspace | `0122_ai_economics.sql:161-170`; DB read 2026-09-27 |

**Cost of one call**, computed from U10/U11:

| Call | Formula | $ | £ |
|---|---|---|---|
| Agent turn at full envelope (mini) | 4,000×0.75 + 400×4.50, per 1M | 0.00480 | **0.00362** |
| Agent turn, typical (ASSUMPTION: 2,500 in, of which 1,100 cached = the stable system prefix; 250 out) | 1,400×0.75 + 1,100×0.075 + 250×4.50, per 1M | 0.00226 | **0.00170** |
| Agent turn, SMS, after the trim (2,133 in, 1,715 cached, 250 out) | 418×0.75 + 1,715×0.075 + 250×4.50 | 0.00157 | **0.00118** (was 0.00132 on the same basis) |
| Agent turn, email, after the de-duplication (3,154 in, 1,715 cached, 250 out) | 1,439×0.75 + 1,715×0.075 + 250×4.50 | 0.00233 | **0.00176** (was 0.00202) |
| Answer extraction (nano) | 900×0.20 + 200×1.25 | 0.00043 | 0.00032 |
| Handoff brief (mini) | 1,500×0.75 + 200×4.50 | 0.00203 | 0.00153 |
| Reactivation copy (mini) | 800×0.75 + 200×4.50 | 0.00150 | 0.00113 |
| Copilot turn (mini) | 6,000×0.75 + 800×4.50 | 0.00810 | 0.00611 |
| Website contacts parse (nano) | 6,000×0.20 + 900×1.25 | 0.00233 | 0.00176 |

**The token yardstick is optimistic.** A typical agent turn is modelled at about 2,750 tokens (up to 4,400 at the envelope), against the 1,700 used for "about 590 assistant replies" in the plan copy. The system prompt alone is 1,115 tokens. Live per-turn tokens are not measured yet (report 10 §14). The cost impact is tiny, but the **advertised reply count may be high by about 40–60%**.

**One AI token costs** (mini, uncached, 80% input / 20% output, ASSUMPTION): 0.8×0.75 + 0.2×4.50 = **$1.50 per 1M = £1.13 per 1M**. The absolute ceiling (every token billed as mini output) is $4.50 = £3.40 per 1M.

---

## 1. Summary per plan

### 1.1 Method

**Max** = every allowance used to 100%. Cost per line:

| Line | Formula (max) | Formula (typical) |
|---|---|---|
| AI | allowance × 1.1 (overdraw) × £1.13/1M | allowance × 50% × $1.09/1M × 0.7549 (the `agent_decision` envelope mix) |
| SMS out | segments × £0.0423 | segments × 50% × £0.0423 |
| SMS in | segments × 50% (ASSUMPTION: replies) × £0.0057 | half of that |
| Number | £1.89 per workspace (ASSUMPTION: a dedicated number each; today there is **one shared platform number**, `TWILIO_SMS_FROM`, so the marginal cost is ~£0) | £0 (shared number) |
| WhatsApp | msgs × (marketing $0.0635 + Twilio $0.005) + inbound 50% × $0.005, i.e. **all marketing templates, the worst case** | msgs × 50% × (30% marketing, 70% utility/service at $0.022, + $0.005) + inbound. ASSUMPTION mix |
| Resend | (leads × 3 + 100) × £0.0003. ASSUMPTION: 3 system emails per lead (owner alert, booking confirmation, reminder) + 100 other | half the leads |
| Google Places | ⌈verified prospects × 9 ÷ 20⌉ × £0.0264. The ×9 is `FUNNEL_MULTIPLIER.COMPANY_SEARCH`, and ÷20 is results per request. Ignores the 1,000 free requests (platform-wide) | half |
| Paid contact data (Hunter, Apollo, Clearbit) | **£0: none is configured** (no key in `.env`/`.env.local`; only `GOOGLE_PLACES_API_KEY` is set) | £0 |
| Campaign email | £0 (customer mailbox, U13) | £0 |
| Stripe | (price × 1.2 VAT) × (2.8% premium card + 0.7% Billing) + 20p. ASSUMPTION: B2B customers pay with a premium/commercial card, and the fee is charged on the VAT-inclusive amount | standard card: (price × 1.2) × (1.5% + 0.7%) + 20p |
| Infrastructure | **ASSUMPTION £2.00 per customer per month.** Fixed stack = Supabase Pro $25 + Vercel Pro $20 + Resend Pro $20 + one number $2.50 = $67.50 = £50.96/month. £2 each ⇔ about 25 paying customers. **Allocation = £50.96 ÷ N customers**, and it falls as N grows | same |

### 1.2 Monthly billing

| £ / month | Starter max | Starter typical | Growth max | Growth typical | Pro max | Pro typical |
|---|---|---|---|---|---|---|
| **Price** | 99.00 | 99.00 | 199.00 | 199.00 | 399.00 | 399.00 |
| AI tokens (tier 1 nano / tier 2 mini) | 1.25 | 0.41 | 4.98 | 1.65 | 14.95 | 4.94 |
| Twilio SMS out | 10.57 | 5.28 | 33.82 | 16.91 | 76.09 | 38.05 |
| Twilio SMS in | 0.71 | 0.35 | 2.26 | 1.13 | 5.10 | 2.55 |
| Number rental | 1.89 | 0.00 | 1.89 | 0.00 | 1.89 | 0.00 |
| WhatsApp (Meta + Twilio) | 0.00 | 0.00 | 53.60 | 15.83 | 160.79 | 47.50 |
| Resend | 0.12 | 0.08 | 0.39 | 0.21 | 0.94 | 0.48 |
| Google Places | 1.19 | 0.61 | 5.94 | 2.99 | 23.78 | 11.89 |
| Azure (other than tokens) | 0 | 0 | 0 | 0 | 0 | 0 |
| **Variable cost** | **15.72** | **6.73** | **102.89** | **38.72** | **283.53** | **105.41** |
| Stripe | 4.36 | 2.81 | 8.56 | 5.45 | 16.96 | 10.73 |
| Infrastructure (ASSUMPTION) | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 |
| **Total cost** | **22.08** | **11.55** | **113.45** | **46.17** | **302.49** | **118.14** |
| **Gross profit** | **76.92** | **87.45** | **85.55** | **152.83** | **96.51** | **280.86** |
| **Gross margin** | **77.7%** | **88.3%** | **43.0%** | **76.8%** | **24.2%** | **70.4%** |
| Net, if affiliate-referred (− 20% of price, months 1–12) | 57.12 | 67.65 | 45.75 | 113.03 | 16.71 | 201.06 |

"Net" here means **net contribution before overheads (salaries, support, tooling, marketing) and before CAC**. The repo holds no overhead figures. Net profit per plan = gross profit − (monthly overheads ÷ customers) − CAC amortised (Part 8).

### 1.3 Annual billing (15% discount)

Stripe is charged once a year on the annual gross: (annual × 1.2 × rate + 20p) ÷ 12.

| £ / month equivalent | Starter max | Starter typ. | Growth max | Growth typ. | Pro max | Pro typ. |
|---|---|---|---|---|---|---|
| Revenue (annual ÷ 12) | 84.17 | 84.17 | 169.17 | 169.17 | 339.17 | 339.17 |
| Stripe / month | 3.55 | 2.24 | 7.12 | 4.48 | 14.26 | 8.97 |
| Gross profit | 62.90 | 73.20 | 57.16 | 123.97 | **39.37** | 222.79 |
| Gross margin | 74.7% | 87.0% | 33.8% | 73.3% | **11.6%** | 65.7% |

### 1.4 Enterprise (indicative)

There is no public price (`monthlyPrice: null`). At the **seeded** Enterprise allowances (100k SMS, 100k WhatsApp, 40M tokens, 10k prospects):

| | Max | Typical (50%) |
|---|---|---|
| AI | 49.82 | 16.46 |
| SMS out + in | 4,510.53 | 2,255.26 |
| WhatsApp | 5,359.79 | 1,583.40 |
| Resend + Places + number + infra | 213.41 | 106.77 |
| **Cost before Stripe** | **£10,133** | **£3,962** |
| Price for 70% gross margin = cost ÷ 0.30 (before Stripe) | **≈ £33,780/mo** | ≈ £13,210/mo |

The seeded Enterprise allowances are placeholders. **No Enterprise contract should be priced from them.** Use the formula in Part 6.3.

### 1.5 What drives the cost

- **SMS and WhatsApp are 85–95% of variable cost on every plan. AI is 1–8%.**
- At max, WhatsApp is the largest single line on Growth and Pro, because a UK marketing template (£0.0517 all-in) costs 1.2× an SMS segment (£0.0423).
- Pro annual at max (11.6%) is the thinnest margin in the catalogue.

---

## 2. Cost per trial

### 2.1 The trial now (owner rule: at most 50p worst-case marginal cost)

**Design.** Follow-up email through the customer's own connected mailbox carries the trial, and costs us £0. Warm follow-up email is not metered against `email_sent`, which counts cold outreach and stays off in the trial. A small SMS allowance lets the customer see SMS work. AI tokens are sized to real per-turn use, and a £ ceiling makes the AI line a hard bound.

| Allowance | Before | **Now** | Where |
|---|---|---|---|
| Days, leads, users | 14, 25, 1 | 14, 25, 1 | `TRIAL` |
| SMS segments | 50 | **8** | `TRIAL.smsSegmentAllowance`; 0138 `sms_outbound_segment` 6 / 8 |
| AI tokens | 100,000 | **50,000** (about 18 agent replies at ~2,750 tokens) | `TRIAL.aiTokenAllowance`; 0138 `ai_tokens` 40,000 / 50,000 |
| AI £ ceiling (trial PLAN) | £3.00 | **6p** | `TRIAL.aiSpendCeilingPence`; 0138 `ai_budgets` |
| System email (Resend) per day | uncapped | **10** | `SYSTEM_EMAIL_DAILY_CAP.trial` |
| Follow-up email via own mailbox | not the default | **the default after the first text; not limited** | `channel-strategy.ts` |
| WhatsApp, reactivation, sourcing, cold email, overage | off | off | unchanged |
| Card first | yes | yes | unchanged |

**Worst case per trial (new)**, computed by `trialWorstCase()` in `unit-costs.ts` and asserted ≤ £0.50 by `tests/plan-margins.test.ts`:

| Line | Formula | £ |
|---|---|---|
| SMS out | 8 × £0.0423 | 0.338 |
| SMS in | ASSUMPTION: one reply per outbound segment, 8 × £0.0057 | 0.045 |
| AI | min(50k × 1.1 × £1.13/1M = £0.062, 6p ceiling) | 0.060 |
| Resend | cap-bound: 10 a day × 14 days × £0.0003 | 0.042 |
| Follow-up and agent email (customer's mailbox) | £0 | 0.000 |
| WhatsApp, sourcing, Places, enrichment | disabled | 0.000 |
| **Total worst-case marginal cost** | | **£0.486** |
| Not per-trial spend (shown for completeness) | number £1.89 × 14/30 (£0 on the shared number) + infra £2 × 14/30 | (0.88 + 0.93) |

- **Caveat.** Inbound SMS cannot be capped. A lead who texts 50 times adds 50 × £0.0057 = £0.28. The 8-segment allowance caps our replies. Twilio's $0.001 failed-message fee is negligible.
- **What the 50p trial shows** (owner test: "an instant first SMS plus a real AI conversation for a handful of leads"):
  - **Instant first SMS for 4 leads.** Half of the 8 segments are held back for replies (`conversationSmsReserve`).
  - **About 2 AI SMS replies** to a lead who texts back.
  - **AI conversations by email for the other leads**, about 18 AI replies in total. An emailed first touch is followed by the assistant answering by email, which costs us nothing but tokens.
  - Booking and handover.
- **Limit (owner decision).** At 50p the trial **cannot** also give several leads a full SMS conversation. The smallest trial that does is **20 SMS segments**: 4 instant first texts plus about 8 two-segment replies, i.e. 3 leads × 2–3 replies.
  - That trial's worst case: 20 × £0.0423 + 20 × £0.0057 + 6p AI + 4.2p Resend = **£1.06**.
  - The implemented trial is the 50p one. To switch, set `TRIAL.smsSegmentAllowance = 20` and seed the trial `sms_outbound_segment` row at 16 / 20. `tests/plan-margins.test.ts` must then allow £1.10.

### 2.2 Baseline (before)

The trial was defined in `TRIAL` (`plans.ts`) and `plan_entitlements` trial rows: 14 days, 25 leads, 50 SMS segments, 100k AI tokens, no WhatsApp, no reactivation, sourcing off, cold email off, no overage (there is now no overage on any plan). The AI plan ceiling was £3.

| Line | Formula | Worst case £ |
|---|---|---|
| SMS out | 50 × £0.0423 | 2.11 |
| SMS in | ASSUMPTION 50 inbound × £0.0057 | 0.28 |
| AI | 100k × 1.1 × £1.13/1M (absolute bound, all mini output: £0.37) | 0.13 |
| Resend | (25 × 3 + 30) × £0.0003 | 0.03 |
| Number | £1.89 × 14/30 (only if a dedicated number is issued; £0 today) | 0.88 |
| Sourcing, Places, Companies House, enrichment | sourcing disabled in trial (`sourcing_enabled` = 0) | 0.00 |
| WhatsApp | disabled | 0.00 |
| Card verification (Stripe) | no published fee (U19). ASSUMPTION £0 | 0.00 |
| Infrastructure | £2 × 14/30 | 0.93 |
| **Total worst case per trial** | | **£4.37** (£4.62 at the absolute AI bound; **£2.55** with a shared number and no infra allocation) |

**Compared with conversion** (trial-to-paid rate *c* is owner input; no measured figure exists):

- Trial cost per paying customer = £4.37 ÷ *c*. At *c* = 10% that is £43.70. At 25% it is £17.48.
- The first month of Starter (typical) returns £87.45 gross profit. **The trial pays for itself in month one if *c* ≥ 5%** (4.37 ÷ 87.45).
- The card-first trial (8.10) limits abuse: one card, one trial. Repeat trials would have to get past Stripe's card fingerprint as well. That was not verified.

---

## 3. Cost per lead and per qualified lead

### 3.1 Assumptions

| Input | Value | Basis |
|---|---|---|
| Default sequence | 5 SMS steps: 0, 10 min, 2 h, 1 day, 3 days. Stops on reply | `src/lib/automation/defaults.ts` `NEW_LEAD_SEQUENCE` |
| Segments per non-responder | **7 as shipped. 5 if normalised** | Part 4.2 (computed with `countSmsSegments`) |
| Reply rate *r* | **ASSUMPTION 30%** | owner input; no production data |
| Sequence segments before a reply | ASSUMPTION 1.5 steps ≈ 2 segments (1.5 normalised) | — |
| Qualification turns per responder | **2.04** | golden conversations, 49 turns / 24 |
| Turns that send a reply | 43/49 = 88% | golden action mix |
| Segments per agent reply | ASSUMPTION 2. The lint prefers ≤ 3 and rejects > 4 (`SMS_PREFERRED_SEGMENTS`, `SMS_MAX_SEGMENTS`) | `messaging/sms-segments.ts` |
| Model calls avoided | 37% (0% as worst case) | report 10 §13 |
| Answer extraction | ASSUMPTION on 30% of turns | only when the rules read nothing |
| Qualified share *q* of all leads | **ASSUMPTION 15%** (half of responders) | owner input |

### 3.2 Per lead, bottom-up (SMS channel)

| Line | Formula | As shipped £ | Normalised £ |
|---|---|---|---|
| SMS out | [(1−r)×7 + r×(2 + 2.04×0.88×2)] × £0.0423 = 6.57 segs (5.02 normalised) | 0.2779 | 0.2123 |
| SMS in | r × 2.04 × £0.0057 | 0.0035 | 0.0035 |
| AI | r × 2.04 × [(1−0.37) × £0.00170 + 0.30 × £0.00032] + q × £0.00153 (brief) | 0.0010 | 0.0010 |
| Resend | 3 × £0.0003 | 0.0009 | 0.0009 |
| **Variable cost per lead** | | **£0.283** | **£0.218** |
| **Per qualified lead** (÷ q = 0.15) | | **£1.89** | **£1.45** |

AI worst case per lead: full envelope and 0% avoidance gives r × 2.04 × £0.00362 = £0.0022. **AI is under 1% of the cost of a lead.**

### 3.3 At each plan's lead cap (all-in, including Stripe, infra, WhatsApp and Places)

| | Starter | Growth | Pro |
|---|---|---|---|
| Total cost at max ÷ lead cap | £22.08 ÷ 100 = **£0.22** | £113.45 ÷ 400 = **£0.28** | £302.49 ÷ 1,000 = **£0.30** |
| Per qualified lead (÷ 0.15) | **£1.47** | **£1.89** | **£2.02** |
| Price per lead at the cap | £0.99 | £0.50 | £0.40 |

### 3.4 The SMS allowance does not cover the lead cap

This is a fact about the catalogue, not an assumption about customers. At 6.57 segments per lead (shipped sequence, *r* = 30%):

| | Starter | Growth | Pro |
|---|---|---|---|
| Segments needed to run the default sequence on every lead at the cap | 657 | 2,628 | 6,570 |
| Included segments | 250 | 800 | 1,800 |
| **Leads the SMS allowance covers** (allowance ÷ 6.57) | **38** (50 normalised) | **122** (159) | **274** (359) |
| Share of the lead cap covered | 38% | 30% | 27% |

After that, sends are **refused** unless the workspace has bought prepaid credit. The margin is protected, because credit is priced above cost (§10.3) and nothing is sent on account. But a Starter customer who routes 100 SMS leads a month runs out of texts at about lead 38. In B2B, email may carry many leads (it costs £0 through the customer's mailbox), but the **default sequence is SMS-only**.

### 3.6 After channel, SMS and token budgeting (2026-09-27)

**What changed.**

- **Owner guardrail: conversion wins over cost.** Budgeting applies only to UNENGAGED automated steps.
  - A lead is engaged once they have replied, or once the qualification engine reads their intent as MEDIUM or above.
  - An engaged lead's steps stay on the configured channel, with no per-lead SMS cap.
  - The agent's replies in a live conversation are never budgeted.
- **Channel strategy.** The default is "SMS for the first message, email after" (`business_settings.follow_up_channel_strategy`, Follow-Up → Channel & SMS budget).
  - The first touch stays instant: SMS when the lead gave a mobile, SMS is permitted and the SMS budget has room; otherwise email.
  - Later nudges to a lead who has not engaged go by email through the customer's mailbox when the lead has an address and a mailbox is connected. They use SMS only when email is not available.
  - The option "SMS for every step" restores the old behaviour.
- **SMS limits.** Both are enforced at send time in `billingSendGate`. Booking reminders are not limited.
  - Automated follow-up to an unengaged lead may send at most **3 SMS segments per sequence run** (1–20).
  - Agent replies meet only an **abuse ceiling of 40 SMS segments per lead per rolling 24 hours** (20–200). A golden conversation uses about 4 segments in total.
  - At the ceiling, the lead goes to a person (`send-store.ts` `blockedByPolicy`) rather than going unanswered.
  - When the allowance and top-up credit are both used up, an agent reply goes by email if the lead has an email address and a mailbox is connected; otherwise the lead goes to a person and owners/admins are told to top up.
- **Conversation reserve.** Automated first texts stop drawing SMS when the allowance is down to its last 10% (half of it in the trial) with no credit left, and go by email instead. The remainder is kept for replies to leads who text back (`conversationSmsReserve`).
- **Tokens.** The context is de-duplicated only: the current message goes once and the notice once. Every loaded message still goes to the model whole. The per-lead token ceiling is an abuse ceiling, 250k tokens (about 90 turns) (§0.3).

Stop conditions, quiet hours and every compliance rule are unchanged, and are re-checked immediately before every send.

**Assumptions** (as §3.1): *r* = 30% reply, 2.04 turns per responder, 88% of turns send, 2 segments per agent SMS reply, 37% of turns need no model, *q* = 15%.

| Per lead | Before (5 SMS steps, normalised) | **After, SMS path** (lead has a mobile and an email) | **After, email path** (no mobile, or SMS not permitted) |
|---|---|---|---|
| Sequence SMS per non-responder | 5 segments | **1** (the first text; steps 2–5 by email) | 0 |
| Sequence SMS per responder | 1.5 | **1** | 0 |
| Agent SMS per responder | 2.04 × 0.88 × 2 = 3.59 | 3.59 (unchanged; the lead chose SMS) | 0 (replies by email) |
| SMS segments per lead | 5.02 | **(0.7 × 1) + 0.3 × (1 + 3.59) = 2.08** | 0 |
| SMS out | £0.2123 | **£0.0878** | £0 |
| SMS in | £0.0035 | £0.0035 | £0 |
| AI (turn at £0.00132 → £0.00118 SMS; £0.00202 → £0.00176 email) | £0.0008 | **£0.0007** | **£0.0010** (was £0.0011) |
| Resend (3 system emails) | £0.0009 | £0.0009 | £0.0009 |
| **Variable cost per lead** | **£0.218** | **£0.093 (−57%)** | **£0.002** |
| **Per qualified lead** (÷ 0.15) | £1.45 | **£0.62** | **£0.013** |
| Ceiling per unengaged lead | none | 3 follow-up segments = £0.13 | £0 SMS |
| Engaged lead | no cap | no cap. Abuse ceiling only: 40 segments per 24 h (£1.69 a day) | no cap |

**Before, on the email path:** the default sequence was SMS-only, so a lead with no mobile could not be followed up unless the customer had built an email sequence by hand.

**Per plan** (all-in at max = §10.2 total ÷ lead cap; the variable per-lead figure above is the same on every plan):

| | Starter | Growth | Pro |
|---|---|---|---|
| All-in cost at max ÷ lead cap: **before** (§3.3) | £0.22 | £0.28 | £0.30 |
| All-in cost at max ÷ lead cap: **after** (monthly) | **£0.198** (£19.82 ÷ 100) | **£0.105** (£41.81 ÷ 400) | **£0.086** (£86.25 ÷ 1,000) |
| Per qualified lead, after (÷ 0.15) | £1.32 | £0.70 | £0.58 |
| Included SMS segments: before → after | 250 → 200 | 800 → 400 | 1,800 → 1,000 |
| Leads the SMS allowance covers: before (÷ 5.02) | 50 | 159 | 359 |
| Leads the SMS allowance covers: **after** (÷ 2.08) | **96** | **192** | **481** |
| First texts covered (1 per lead) | 200 ≥ 100 ✔ | 400 ≥ 400 ✔ | 1,000 ≥ 1,000 ✔ |

**Every plan covers an instant first text for every lead up to its lead cap.**

- The allowance now covers more leads end to end than before on every plan, despite being smaller, because follow-up after the first text is email.
- **What still draws the allowance is the agent's SMS conversation with responders** (3.59 segments each). By design it is never cut short.
  - On Growth and Pro at full lead volume, a 30% SMS reply rate runs past the included segments. From there, prepaid credit applies, at ≥ 75% margin (§10.3). Owners and admins are prompted at 75%, 90% and 100% with a recommended bundle.
  - With no credit, the AI reply goes by email where the lead has an address and a mailbox is connected; otherwise the lead goes to a person (above).
  - **Owner decision (2026-09-27):** there is no overage, so an AI reply is never sent on account past the allowance, even to an engaged lead.

### 3.7 Cheapest-channel re-engagement and the frequency caps (2026-09-27)

**What changed** (`src/lib/reengagement/`; docs/AGENT_RUNTIME.md "Re-engagement").

- **Reactivation campaigns** are created in the **cost-aware** channel mode by default (`campaigns.channel_mode`, 0146; existing campaigns keep "Always SMS"). A lead who has not engaged (never replied, intent below MEDIUM) gets the message by email from the customer's mailbox when they have an address; SMS only when email is not usable. An engaged lead stays on SMS. The re-engagement agent's drafts and the intent triggers use the same rule (`chooseCostAwareChannel`, which reuses `chooseStepChannel`).
- **Frequency caps across every loop:** 1 automated touch per lead per day, 3 a week, 6 per 30 days, and a dead-lead stop after 4 unanswered touches at intent LOW or below. Replies to a lead who wrote in are never capped (owner rule: conversion wins).

**Per-lead cost impact.** ASSUMPTIONS (no production data): a campaign SMS is 1 segment plus the opt-out line, about 1.1 segments normalised, at £0.0423; an email through the customer's mailbox costs £0; 70% of a reactivation audience has an email address (B2B form leads); 95% of a reactivation audience is unengaged by definition.

| Per reactivation contact | Before (SMS to all, initial + follow-up) | After (cost-aware) |
|---|---|---|
| SMS segments | 2 x 1.1 = 2.2 | unengaged with email: 0; unengaged without email (about 30%) and engaged (5%): 2.2; blended **about 0.73** |
| SMS cost | £0.093 | **£0.031 (-67%)** |
| 500-contact campaign (Growth) | £46.50 of SMS (1,100 segments, more than Growth's 400 included) | **£15.40** (about 363 segments) |

| Per lead, re-engagement loops | Before | After |
|---|---|---|
| Win-back (one message) | not built | £0 when the lead has an email (email first), else about 1.1 segments (£0.047) |
| No-show (rebook + nudge) | not built | at most 2.2 segments on SMS; the 1-a-day cap usually holds the nudge a day |
| NOT_NOW / deadline check-in | not built | one agent turn, about £0.0012-0.0018 of AI, plus about 2 segments if the lead's channel is SMS |
| Automated touches per unengaged lead, worst case | unbounded across loops (sequence + campaign + agent drafts) | **at most 6 per 30 days**, and **at most 4 unanswered in a row** at LOW intent |

The dead-lead rule is the largest saving at scale. The default new-lead sequence has 5 steps; for a lead who never engages at LOW intent the 5th is skipped. On the §3.6 SMS path that step is already an email (£0), so the gain there is deliverability; with "SMS for every step" it saves about 1.1 segments (£0.047) per non-responder. No cap applies to replies, so no conversation is cut short.

### 3.5 WhatsApp variant (Growth and Pro)

Per non-responder (5 templates): utility 5 × £0.0204 = **£0.10**; marketing 5 × £0.0517 = **£0.26**. Per responder turn after 1 October 2026: a service reply costs £0.0204 plus £0.0038 Twilio on each inbound message. Before 1 October the reply was £0.0038 (Twilio only). **The conversational part of WhatsApp becomes about 5× more expensive on 1 October 2026.**

---

## 4. Twilio SMS

### 4.1 Segment rules

Implemented in `src/lib/messaging/sms-segments.ts` `countSmsSegments`, and re-checked against the code today:

| Encoding | 1 segment | Per segment when split | Counted in |
|---|---|---|---|
| GSM-7 | 160 | 153 | septets. `€ [ ] { } \ ~ ^ \|` and form feed cost **2** |
| UCS-2 | 70 | 67 | UTF-16 code units. An emoji outside the BMP costs 2 |

- **Any** character outside the GSM-7 tables switches the **whole message** to UCS-2. Examples: curly quotes ‘ ’ “ ”, en or em dash – —, ellipsis …, non-breaking space, and any emoji.
- **£ is GSM-7** (basic table, 1 septet). **€ is GSM-7** (extension table, 2 septets). **é, è, à, ü are GSM-7. Other accented letters (for example á, ê, ç) are not.** Computed today: "£250 deposit" → GSM-7, 1 segment; "It’s fine" → UCS-2; "Great 👍" → UCS-2; "café" → GSM-7.
- `normaliseForSms()` replaces smart quotes, dashes, ellipsis and non-breaking space with GSM-7 equivalents. **It is applied only in the agent's length lint** (`agent/policy.ts:447`). It is **not** applied to follow-up sequence or campaign bodies before sending. Billing counts the raw body (`billing/limits-service.ts:70`, `jobs/handlers/send-store.ts:880`).

### 4.2 Typical ClientTurn message

Default sequence, rendered with first_name "Sarah", business "Northbank Studio" and service "website redesign". The opt-out line is appended to the first step (`automation-advance.ts` `composeBody`):

| Step | Chars | Encoding | Segments | Normalised | + 23-char signature |
|---|---|---|---|---|---|
| 0 Immediately (+ "Reply STOP to opt out.") | 137 | GSM-7 | 1 | 1 | **161 → 2** |
| 1 10 min (contains "—") | 101 | **UCS-2** | **2** | 1 | 2 (norm 1) |
| 2 2 hours | 94 | GSM-7 | 1 | 1 | 1 |
| 3 1 day (contains "—") | 108 | **UCS-2** | **2** | 1 | 2 (norm 1) |
| 4 3 days | 113 | GSM-7 | 1 | 1 | 1 |
| **Total per non-responder** | | | **7** | **5** | **8** (norm 6) |

The two em dashes in the shipped template add **2 segments per lead: 40% more than necessary.** A message signature (Settings → Workspace, up to 160 chars) is appended to **every** step and can push step 0 over 160.

### 4.3 UK prices

| | $ | £ |
|---|---|---|
| Outbound, per segment (mobile number or alphanumeric) | 0.056 | 0.0423 |
| Outbound, short code | 0.0524 | 0.0396 |
| Inbound, per message | 0.0075 | 0.0057 |
| Mobile number / month | 2.50 | 1.89 |
| Local (geographic) number / month | 1.15 | 0.87 (cannot usually send SMS in the UK: **unverified**) |
| Alphanumeric sender ID | free | — |
| Failed message | 0.001 | 0.0008 |
| Carrier fees | **None listed for the UK.** Twilio: "additional carrier fees may apply" (A1) | unverified |

Also listed on A1: "SMS Pumping Protection $0.025" and "Engagement Suite $0.015 per use (first 1,000 free)". The unit for pumping protection was not clear from the page, so it is **not modelled**.

**Alphanumeric senders.** They are one-way, so STOP cannot be replied. ClientTurn refuses to send from one unless an opt-out URL is appended (`messaging/sms-compliance.ts` `decideSmsSender`). The appended URL adds characters, and often a segment.

**Number model today.** One platform Twilio account and one sender (`TWILIO_SMS_FROM`). Per-workspace numbers via subaccounts are "tracked, not built" (report 11 Part K). Rental is therefore about £1.89 in total today, and £1.89 per workspace once numbers are dedicated.

### 4.4 Worked example (Growth, a month at the SMS allowance)

- Inputs: 800 segments, shipped sequence, *r* = 30%.
- Leads covered: 800 ÷ 6.57 = **122 leads**.
- Outbound: 800 × £0.0423 = £33.82.
- Inbound: 122 × 0.3 × 2.04 = 75 messages × £0.0057 = £0.43.
- Normalising bodies would cover 800 ÷ 5.02 = 159 leads for the same £33.82.
- Past the allowance, the only way to keep sending is prepaid credit (there is no overage since 2026-09-27; bundle margins in §10.3).

---

## 5. WhatsApp

### 5.1 Prices (UK, per delivered message)

| Category | Meta | + Twilio | All-in $ | All-in £ | Notes |
|---|---|---|---|---|---|
| Marketing template | 0.0635 | 0.005 | 0.0685 | **0.0517** | reactivation, promotional nudges |
| Utility template | 0.0220 | 0.005 | 0.0270 | **0.0204** | transactional follow-up, booking confirmation. Free inside the window **until 30 Sep 2026** |
| Authentication | 0.0220 | 0.005 | 0.0270 | 0.0204 | not used |
| Service (free-form, inside 24h) | **0 until 30 Sep 2026; 0.0220 from 1 Oct 2026** | 0.005 | 0.005 → 0.027 | 0.0038 → **0.0204** | the qualification conversation |
| Inbound (lead → business) | 0 | 0.005 | 0.005 | 0.0038 | Twilio charges inbound too |
| Direct Meta Cloud API (workspace-connected number) | as above | 0 | — | — | no Twilio fee (`messaging/registry.ts`) |

- **Free windows.** A 24h customer-service window opens on each inbound message. A 72h free-entry-point window opens after a Click-to-WhatsApp ad or Facebook CTA reply, and all messages are free in it (A3).
- ClientTurn prices an unrecognised template category as MARKETING, the most expensive (`whatsapp-templates.ts` `normaliseCategory`). That is the safe direction.
- **Twilio markup:** none on Meta's fee. Twilio charges its own $0.005 per message in each direction (A2).

### 5.2 Model: a reactivation campaign (Growth, 500 contacts)

ASSUMPTION: 1 initial marketing template + 1 follow-up template to non-responders; 15% reply; 2 service replies each after 1 October.

| Line | Formula | £ |
|---|---|---|
| Initial | 500 × £0.0517 | 25.85 |
| Follow-up | 425 × £0.0517 | 21.97 |
| Inbound replies | 75 × 2 × £0.0038 | 0.57 |
| Service replies (from 1 Oct) | 75 × 2 × £0.0204 | 3.06 |
| AI personalisation (optional) | 925 × £0.00113 | 1.05 |
| **Total** | | **£52.50** |
| Units drawn from the allowance | 500 + 425 + 150 = 1,075 | > the Growth allowance of 1,000 |

The campaign uses the whole Growth WhatsApp allowance and costs about £52.50. That is 26% of the £199 price.

*Since 2026-09-27 no plan includes WhatsApp.* The same campaign is paid in WhatsApp tokens (§5.4): 925 marketing templates × 5 + 150 service replies × 2 = **4,925 tokens, about £98.50** at 2p a token, against a cost of about £52.50 plus Stripe.

### 5.3 Model: a follow-up sequence (one new lead on WhatsApp)

Five templates, *r* = 30%, 2.04 turns per responder:

| | Utility templates | Marketing templates |
|---|---|---|
| Non-responder (5 templates) | £0.102 | £0.259 |
| Responder (1.5 templates + 2.04 × (service + inbound)) | 1.5×0.0204 + 2.04×(0.0204+0.0038) = **£0.080** | 1.5×0.0517 + 0.049 = **£0.127** |
| Blended per lead | 0.7×0.102 + 0.3×0.080 = **£0.095** | 0.7×0.259 + 0.3×0.127 = **£0.219** |

A lead-form follow-up is plausibly **utility** (a response to the person's own request), but **Meta decides the category at template approval**, and promotional wording is reclassified as marketing. Utility templates make WhatsApp cheaper per lead than SMS (£0.095 vs £0.283). Marketing templates make it about the same (£0.219).

### 5.4 WhatsApp tokens: prices, margins and the specialist comparison (2026-09-27)

**Owner decisions.** "We must be competitive with WhatsApp specialists." The 75% rule stays for every plan (which include no WhatsApp), SMS credit and AI token packs. WhatsApp is allowed a lower margin, targeting about 50% by category. It is sold as **WhatsApp tokens**, non-monetary units like AI tokens, never as a £ balance: tokens have no cash value, cannot be exchanged or transferred, never expire, and a pack is non-refundable once any are used.

**The pricing rule (owner, todo.md §4).** About 50% margin: about **10p a marketing message** and about **4p a utility message or conversation reply**. Never below the floor: what ClientTurn keeps after Stripe is at least **cost × 1.25** (`WHATSAPP_MIN_MARKUP_ON_COST`, kept as the hard floor; the prices sit at ×1.70–1.78, and the test pins ≥ ×1.7).

**Why 2p a token.** It hits the owner's target exactly (5 tokens = 10p, 2 tokens = 4p), and it keeps ClientTurn's **total** WhatsApp cost below the specialists' at SMB volumes, because **ClientTurn charges no WhatsApp platform fee**: the plan price already covers the inbox, agent, qualification and booking. Specialists are cheaper per message but charge £19–£251 a month before the first message (§10.4). The earlier floor-level draft (1.5p a token, 3p / 7.5p) was withdrawn: it gave ~20–24% margin for a per-message saving that only matters above about 1,000 messages a month.

**Cost per message** (Twilio route, the dearer one: Meta + Twilio $0.005 each way + 50% inbound share; `unit-costs.ts` `whatsappAllInCost`): marketing **5.36p**; utility, authentication and service (from 1 Oct 2026) **2.23p**.

| Category | Tokens | Price at 2p a token | Cost | Margin after Stripe (£20 / £40 / £100 pack) | Kept after Stripe ÷ cost |
|---|---|---|---|---|---|
| Service (free-form reply in the 24h window) | 2 | **4p** | 2.23p | **39.1% / 39.6% / 39.9%** | ×1.70 / ×1.71 / ×1.72 |
| Utility template | 2 | **4p** | 2.23p | 39.1% / 39.6% / 39.9% | ×1.70 / ×1.71 / ×1.72 |
| Authentication template (unused) | 2 | 4p | 2.23p | as utility | as utility |
| Marketing template, **or any unrecognised category** | 5 | **10p** | 5.36p | **41.2% / 41.7% / 42.0%** | ×1.77 / ×1.78 / ×1.78 |

- **Packs:** 1,000 tokens £20, 2,000 £40, 5,000 £100. The rate per token is the same in every pack, so nobody has to buy big to get a fair price. 1,000 tokens covers about 500 conversation replies or 200 marketing messages. Stripe (3.5% of the VAT-inclusive charge plus 20p) takes 5.2% / 4.7% / 4.4% of the three packs.
- **About 50%, not exactly.** At 10p / 4p the Twilio route makes 39–42% after Stripe. A workspace on its own Meta Cloud API number pays no Twilio fee and makes **46.9–47.7% on marketing and 53.3–54.1% on replies**. Until 30 Sep 2026 Meta does not charge for service messages, so a reply on the Twilio route makes about 81%.
- **We charge no platform fee.** Monthly totals for one number, WhatsApp only. ClientTurn's plan is not counted, since it is bought for the rest of the product. Specialists are at their cheapest verified plan and UK rates from §10.4, with service charged from 1 Oct 2026:

| A month of… | ClientTurn | 360dialog (€49 + Meta at cost) | Gallabox Basic (£21.35 + rate card) |
|---|---|---|---|
| 100 replies | **£4.00** | £42.82 | £23.26 |
| 300 replies | **£12.00** | £46.14 | £27.08 |
| 1,000 replies | **£40.00** | £57.77 | £40.45 |
| 50 marketing messages | **£5.00** | £43.56 | £24.11 |
| 200 marketing messages | **£20.00** | £50.75 | £32.37 |
| 300 replies + 200 marketing | **£32.00** | £55.73 | £38.10 |

- **Break-even** (the volume above which the specialist is cheaper), per number per month:
  - **360dialog**: about **791 marketing messages or 1,760 replies**.
  - **Gallabox Basic** (annual): about **476 marketing messages or 1,022 replies**.
  - Twilio direct has no platform fee and is always cheaper per message (5.17p / 2.04p), but it is a raw API with no inbox, agent, qualification or booking.
- **Metering.** The send gate prices a queued message by its template's category, or as a service reply when it has none. The meter charges what actually went out: a template at its category, or a free-form reply as service. A template whose category is missing or unrecognised is charged as **marketing**. The usage ledger still counts WhatsApp **messages** (the admin cost view reads that); tokens spent are in the credit ledger and the usage metadata.
- **Conversion of existing credit** (migration 0148, not yet applied): each old 27p message credit became **14 tokens** (27p ÷ 2p = 13.5, rounded up; worth 28p). That is 7 replies or 2.8 marketing messages where the credit was one message of either, so no customer loses value. 14 rather than a goodwill 18: 14 already leaves every holder better off in messages, and 18 would give away 33% more than was paid for. Balances, purchases (credits and credits_reversed) and the ledger are converted together, once, so FIFO refundability and the refund reversal (0142, unit-agnostic, unchanged) work in tokens.
- **Code:** `src/lib/billing/whatsapp-tokens.ts` (the rates, packs, category rule and conversion), `unit-costs.ts` `whatsappMessageEconomics` and `WHATSAPP_MIN_MARKUP_ON_COST`, `admin/economics-model.ts` `whatsappPricing` (the admin table uses the same numbers), `tests/whatsapp-tokens.test.ts`.

---

## 6. Break-even, sensitivity and guardrails

### 6.1 What drives margin risk

| Driver | Share of max variable cost (Growth / Pro) | Unit-price sensitivity |
|---|---|---|
| WhatsApp | 52% / 57% | Pro annual reaches £0 gross profit if Meta's UK marketing rate rises from $0.0635 to **$0.0809** (+27%): 39.37 ÷ (3,000 × 0.7549) = $0.0174 headroom. Pro monthly: to $0.106 |
| SMS | 35% / 29% | Pro annual reaches £0 if UK SMS rises from $0.056 to **$0.085** (+52%) |
| AI | 5% / 5% | Even at the absolute all-output bound (£3.40/1M), Pro max AI = 13.2M × £3.40/1M = £44.88: +£30 vs the table. Not a margin risk |
| Google Places | 6% / 8% | Enterprise SKU $35/1,000. The website field is what triggers Enterprise over Pro ($32) |
| FX | all USD lines | At £0.80/$ (the code's rate), Pro annual max gross falls from £39.37 to about £22 |

**Plans are SMS- and WhatsApp-heavy, not AI-heavy.** The AI token allowance, not the £ ceiling, binds first. A full Pro allowance costs about £15, against a £150 plan ceiling.

### 6.2 What top-up credit recovered at baseline prices (per unit, before Stripe)

Baseline only. Overage was removed on 2026-09-27, so the baseline overage rows (SMS, WhatsApp, verified prospects, email) are gone, and the bundles were re-priced (§10.3).

| Unit | Our cost | Baseline credit price | Margin |
|---|---|---|---|
| SMS credit bundles | £0.0423 | 9p / 8p / 7.5p | +53% / +47% / +44% |
| **WhatsApp 1,000-credit bundle** | £0.0517 marketing | **5p** | **−3% on marketing** |
| AI tokens (top-up) | £1.13/1M (£3.40 absolute) | £21.50–£30/1M | +84% to +96% |
| Verified prospect (current free-source waterfall) | ≈ £0.012 (9 companies ÷ 20 × £0.0264) | not sold past the allowance | — |
| **Verified prospect, if paid enrichment is switched on** | **≈ 47p** (sum of `FALLBACK_UNIT_COST_MINOR` × `FUNNEL_MULTIPLIER`: 9×1 + 6×2 + 2.5×4 + 1.8×6 + 1.6×1 + 1.2×3) | not sold past the allowance | cost sits inside the plan (6.3 item 3) |

Stripe takes a further 2.2–3.5% of each charge.

### 6.3 Where a plan goes negative

1. **Enterprise at the seeded allowances.** Any price below about **£10,130/month** loses money at max. Floor price for a target margin *m*: **P = (Σ allowanceᵢ × unit costᵢ + infra) ÷ (1 − m − stripe%)**.
2. ~~**WhatsApp marketing overage on Pro and Enterprise**, and the 1,000-credit bundle.~~ **Resolved**: overage no longer exists, and the bundles were re-priced to ≥ 75% at the marketing rate (§10.3).
3. **Paid contact enrichment**, the moment a Hunter/Apollo/Clearbit key is added: the Pro allowance of 2,000 prospects × 47p = **£940** against a £399 price. Today it is latent (no key set).
4. **Pro annual at max**: +11.6%. Any one of these puts it at or below zero: a Meta rate rise, the FX move to 0.80 plus a premium card, or per-workspace numbers plus Supabase compute growth.
5. **SMS to non-UK mobiles.** The allowance says "UK SMS segments", and cost is modelled at the UK rate only. Whether non-UK destinations are blocked or priced was **not verified**.

### 6.4 Guardrails that exist in code

| Guardrail | Where |
|---|---|
| Hard monthly allowances for SMS and WhatsApp; refused at the limit | `billing/limits.ts` `splitConsumption`, `limits-service.ts` |
| **(2026-09-27)** No overage: allowance, then prepaid credit, then refused; prospects, runs and outreach email stop at the allowance | `limits.ts` `splitConsumption` |
| Daily per-channel send caps | `limits.ts` `dailyCapAllows` |
| AI token allowance + 10% overdraw ceiling, atomic reservation | `ai/tokens.ts`, migration 0116 |
| AI £ budgets: pre-reply 20p, lead £2, opportunity £10, plan £3/£15/£50/£150, emergency £500 | `ai/budget.ts` `decideSpend`, `ai_budgets` |
| Zero-token NBA actions (37–43% of golden turns) | `NBA_ACTION_NEEDS_MODEL` |
| Find Leads: allowance, per-run ceiling £500, workspace ceiling, cost reservation | `find-leads/server/budget.ts`, `cost-model.ts` `PLATFORM_RUN_COST_CEILING_MINOR` |
| Trial: no WhatsApp, no sourcing, card first, £3 AI ceiling | `plans.ts` `TRIAL`, `allowancesFor` |
| Unknown WhatsApp category priced as MARKETING (5 tokens, 2026-09-27) | `whatsapp-templates.ts` `normaliseCategory`, `whatsapp-tokens.ts` `whatsappBillingCategory` |
| SMS length lint (≤ 4 segments) on agent replies | `agent/policy.ts` `evaluateLength` |
| **(2026-09-27)** Every SMS normalised to GSM-7 just before the carrier; the gate counts the normalised body; every default template is one segment | `send-core.ts`, `limits-service.ts` `unitsFor`, `tests/sms-normalisation.test.ts` |
| **(2026-09-27)** Per-lead SMS: 3 follow-up segments per unengaged lead per run; agent replies only meet an abuse ceiling of 40 per 24 h; a conversation reserve | `limits-service.ts` `perLeadSmsGate`, `followUpSmsAffordable`; `channel-strategy.ts` |
| **(2026-09-27)** Cost-aware channel strategy: SMS first, email after (unengaged leads only) | `automation-advance.ts`, `channel-strategy.ts` |
| **(2026-09-27)** Daily system-email (Resend) cap per workspace: trial 10, Starter 30, Growth 60, Pro 120, Enterprise 500 | `plans.ts` `SYSTEM_EMAIL_DAILY_CAP`, `email/system-email-budget.ts`, `notification-send.ts` |
| **(2026-09-27)** ≥ 75% margin rule asserted in CI; trial ≤ 50p asserted in CI | `tests/plan-margins.test.ts` |

### 6.5 Gaps (findings only; no code was changed)

1. ~~WhatsApp credit counts **messages, not category**.~~ **Resolved (2026-09-27)**: WhatsApp is metered in tokens by category (2 per reply or utility template, 5 per marketing or unknown template), §5.4.
2. ~~SMS bodies from sequences and campaigns are not normalised before sending.~~ **Fixed**: normalised in `send-core.ts`, and the em dashes are gone from `NEW_LEAD_SEQUENCE`.
3. ~~`provider_price_book` has no Meta category rows.~~ **Fixed in 0138** (not yet applied). Nothing in code prices WhatsApp from the price book yet; the admin cost view will pick the rows up.
4. `loadUnitCosts()` matches **no** price-book row (product vs capability naming) and reads USD as pence. Find Leads always runs on hard-coded fallbacks.
5. ~~Verified-prospect overage is **uncapped by count** once overage is on.~~ **Resolved**: there is no overage, so sourcing stops at the allowance. There is still **no per-workspace monthly provider-spend ceiling** beyond the allowance and the £500 per-run ceiling.
6. Enterprise seeded allowances (100k SMS, 100k WhatsApp) are not tied to any price. Enterprise has **no `lead_processed` row** in `plan_entitlements`.
7. **Vercel Hobby forbids commercial use** (A16), and `docs/CRON.md` says the deployment is on Hobby. Add Vercel Pro (£15.10/seat) before charging customers. It is already inside the £2 infrastructure allocation.
8. **VAT.** The pricing page says "VAT is added at checkout", but `checkout.ts` sets no `automatic_tax` or tax rates. It may be set on the Stripe Price objects; **not verified**. If VAT is not collected, the prices above are VAT-inclusive, and revenue falls by a sixth (£99 → £82.50 net).
9. 1 October 2026: WhatsApp service and in-window utility messages become chargeable. The token prices assume it (a service reply is 2 tokens either side of the date), and the admin cost view prices service messages from that date; the price book rows are in 0138.

---

## 7. Competitors

Prices were checked 2026-09-27 on each vendor's own pricing page. USD is converted at £0.7549. They are ex-VAT/sales tax as displayed.

| Tool | Positioning | List price (USD/mo) | ≈ £/mo | What is included | Source |
|---|---|---|---|---|---|
| **GoHighLevel** | Agency CRM + automation + SMS + AI | Starter **$97**; Unlimited **$297**; Agency Pro **$497**; Enterprise custom | 73 / 224 / 375 | Unlimited contacts and users. **SMS, phone, email beyond the allocation, and Conversation/Voice AI are usage-billed on top** (rebillable to clients). 14-day trial | A18 |
| **HubSpot Sales Hub** | CRM + sequences + AI agents | Starter $20 monthly ($7 annual, **as displayed; lower than historical, re-check before quoting**); Professional $100 monthly / $90 annual **per seat** + $1,500 onboarding; Enterprise $150/seat + $3,500 onboarding | Pro ≈ £75/seat | HubSpot Credits (500 / 3,000 / 5,000) power prospecting and customer agents. No SMS allowance stated | A19 |
| **Instantly** | Cold email at volume | Growth **$47**; Hypergrowth **$97** ($77.60 annual); Light Speed **$358** ($286.30 annual). Lead credits from $47 | 35 / 73 / 270 | 5k / 125k / 500k emails; 1k / 25k / 100k contacts; unlimited mailboxes and warm-up | A20 |
| **Smartlead** | Cold email at volume | Base **$39**; Pro **$94**; Unlimited Smart **$174**; Unlimited Prime **$379** (17% off annual) | 29 / 71 / 131 / 286 | 6k–500k sends; unlimited mailboxes | A22 |
| **Lindy** | General AI agents (incl. SDR-style) | Plus **$29.99**; Pro **$99.99**; Max **$199.99** per user; Enterprise custom | 23 / 75 / 151 | 3k / 15k / 35k credits per user. SMS/phone not listed | A23 |
| **Artisan (Ava)** | AI SDR | **No public price.** "Credit-based pricing", demo only | — | — | A24 |
| **11x** | AI SDR | **No public price found.** `/pricing` returned HTTP 404 on 2026-09-27 | — | — | A25 |
| **Podium** | SMS-first lead conversion (local business) | **No public price.** "Talk to our sales team". AI Employee is an add-on | — | "AI lead conversion" on all plans | A26 |
| Leadsie | Agency client-onboarding (access requests) | not comparable | — | — | A27 |
| SalesRabbit | Door-to-door field sales | not comparable | — | — | A28 |

**Reading the table (facts only).**

- The price-visible tools split into two groups:
  - **cold-email engines** (Instantly, Smartlead), cheaper than ClientTurn but with no SMS/WhatsApp, no qualification engine and no booking;
  - **CRM suites** (HubSpot, GoHighLevel), which charge per seat, add onboarding fees or usage-bill messaging on top.
- ClientTurn **includes** SMS, WhatsApp and AI inside the price, which none of the price-visible tools does.
- The AI SDR products (Artisan, 11x) publish no prices. **No claim can be made about them.**

---

## 8. Acquisition cost

The brief's §100 rule applies: only benchmarks with source, period and geography. **None was found that is UK, B2B SaaS, at this price point and current.** Report 11 §100 cites one external benchmark only, and it is not about CAC. This section is therefore an **owner-fill-in model**. The illustrative inputs are labelled **ILLUSTRATIVE** and are not benchmarks.

### 8.1 CAC by channel

| Channel | Formula | Inputs you supply |
|---|---|---|
| Paid social (Meta, LinkedIn) | CAC = spend ÷ customers = CPC ÷ (click→trial × trial→paid) | CPC, click→trial %, trial→paid % |
| Google Ads | same, with CPC from Keyword Planner for your terms | same |
| Outbound (ClientTurn's own Find Leads + email) | CAC = (tooling + sourcing + people hours × rate) ÷ customers. Sourcing ≈ 1.2p per verified prospect (6.2); email £0 | prospects/customer, hours/customer, hourly cost |
| **Partners / affiliates** | **Fact:** 20% recurring for 12 months, 90-day attribution, 90-day cookie, 30-day hold, £100 minimum payout (live `affiliate_commission_plans` "Standard 20% recurring"; `affiliates/programme.ts` `FALLBACK_POLICY`). **CAC = 0.20 × price × Σ survival(m), m = 1..12** | churn |
| Content / SEO | CAC = (writing + tools) ÷ attributed customers over 12 months | cost, attributed customers |
| Trial cost (all channels) | + £4.37 ÷ trial→paid (Part 2) | trial→paid |

**Affiliate CAC (fact-based, churn as input):** max (no churn) = 0.2 × 12 × price = **£237.60 / £477.60 / £957.60** (Starter / Growth / Pro). With monthly churn *k*: 0.2 × price × (1 − (1−k)¹²) ÷ k.

### 8.2 LTV, LTV:CAC and payback

- **LTV** = monthly gross profit ÷ monthly churn *k* (ASSUMPTION: typical usage; no expansion).
- **Payback (months)** = CAC ÷ monthly gross profit.
- **Maximum CAC at 3:1** = LTV ÷ 3.

ILLUSTRATIVE churn only (3% / 5% / 8% per month). These are **placeholders, not benchmarks**.

| | Starter (GP £87.45) | Growth (GP £152.83) | Pro (GP £280.86) |
|---|---|---|---|
| LTV at 3% | £2,915 | £5,094 | £9,362 |
| LTV at 5% | £1,749 | £3,057 | £5,617 |
| LTV at 8% | £1,093 | £1,910 | £3,511 |
| Max CAC for 3:1 at 5% | £583 | £1,019 | £1,872 |
| Payback on an affiliate CAC at 5% churn (0.2 × price × 9.19) | £182 → **2.1 months** | £366 → 2.4 months | £733 → 2.6 months |

Affiliate payback is short because the commission is paid only while the customer pays.

---

## 9. Recommendations

These are **judgements** drawn from Parts 1–8, not facts. Each one names the figure it rests on.

> **Status 2026-09-27.** Items 1, 3 and 10 are done. Items 2, 4 and 5 are superseded by Part 10: WhatsApp is priced at the marketing rate as an add-on; SMS is sized to a first text per lead with email after; Pro annual is at 75.4%. Item 6 is partly done (the Enterprise `lead_processed` row is seeded in 0138). Item 9's copy is corrected (the yardstick is 2,750). Items 7 and 8 are open.

1. **Normalise SMS before sending, and remove the em dashes from `NEW_LEAD_SEQUENCE`.**
   - Evidence: 7 → 5 segments per non-responder (4.2).
   - Effect: the same allowance covers 29% more leads, and the per-lead cost falls from £0.283 to £0.218 (3.2).
   - This is the cheapest change with the largest effect.
2. ~~**Make WhatsApp pricing category-aware.**~~ **Done (2026-09-27)**: WhatsApp tokens, 2 per reply or utility template and 5 per marketing template, at 2p a token (§5.4).
   - Evidence: the baseline 1,000-credit bundle (5p) sold marketing templates at a loss (6.2). Superseded: credit is now 26.5–27.2p and overage is gone.
3. **Add the Meta category costs (U6–U9) to `provider_price_book`**, including the 1 October 2026 service charge.
   - Evidence: cost reporting is under-stated about 13× for marketing templates (0.2 note 1).
4. **Reconcile the SMS allowance with the lead cap.** Three options:
   - (a) make email the default first channel for B2B leads (email costs £0);
   - (b) raise SMS allowances. Covering Starter's full lead cap at 5.02 segments per lead needs 502 segments, **+£10.65/month in cost**;
   - (c) say plainly that the SMS allowance covers about 40–50 leads on Starter.
   - Evidence: 3.4.
5. **Protect Pro annual.** For example, cut the included WhatsApp to 2,000 or count marketing templates as 3 units.
   - Evidence: 11.6% at max (1.3), and it breaks even at a 27% Meta rise (6.1).
6. **Never price Enterprise from the seeded allowances.** Contract the allowances and use the floor formula in 6.3. Also add an Enterprise `lead_processed` row.
7. **Before enabling any paid enrichment provider:**
   - fix `loadUnitCosts` (0.2 note 3);
   - add a per-workspace monthly provider-spend ceiling;
   - check the plan margin with paid enrichment inside the allowance (≈ 47p per prospect at the fallback, 6.2). There is no overage to re-price.
8. **Move Vercel to Pro before the first paying customer** (6.5 item 7). **Confirm that VAT is collected at checkout** (6.5 item 8).
9. **AI is not a margin risk; it is a selling point.**
   - Evidence: it is under 8% of cost at max on every plan, and top-ups earn 84–96% (6.2).
   - Correct the "about 590 assistant replies per 1M" copy once live tokens per turn are measured. The yardstick is 1,700 tokens against a modelled 2,750 (0.3).
10. ~~The trial is cheap enough to keep as-is.~~ **Superseded** by the owner's 50p rule. The new worst case is £0.486 (§2.1).

---

## 10. Margin-safe catalogue (2026-09-27)

**The rule.** Every plan and billing interval must make ≥ 75% gross margin at **maximum** use of every included allowance. SMS credit bundles and AI token packs must also clear 75%. **WhatsApp tokens are the one exception** (owner, 2026-09-27): priced to compete with WhatsApp specialists, with a floor of cost + 25% after Stripe (§5.4). The method is §1.1: variable cost plus Stripe (premium card 2.8% + Billing 0.7% on the VAT-inclusive charge, + 20p) plus the £2 infrastructure allocation.

**The proof is code.**
- `src/lib/billing/unit-costs.ts` holds the unit costs, with a source note on each line, and the model.
- `tests/plan-margins.test.ts` recomputes every figure below from `plans.ts` and asserts ≥ 75%. An allowance or price change that breaks the rule fails CI.

**Prices are unchanged**: £99 / £199 / £399, and annual at −15%.

### 10.1 The catalogue: before → after

| | Starter | Growth | Pro | Enterprise |
|---|---|---|---|---|
| Price / month | £99 | £199 | £399 | contact sales |
| New leads | 100 | 400 | 1,000 | 100,000 (**now seeded** as `lead_processed`) |
| Included SMS segments | 250 → **200** | 800 → **400** | 1,800 → **1,000** | 100,000 (contract) |
| Follow-up email from own mailbox | — → **unlimited, the default after the first text** | same | same | same |
| Included WhatsApp | 0 | 1,000 → **0 (paid add-on)** | 3,000 → **0 (paid add-on)** | 100,000 → **0 (add-on)** |
| AI tokens | 1M | 4M | 12M → **6M** | 40M |
| Verified prospects (hard / shown) | 100 / 90 | 500 / 450 | 2,000 / 1,800 → **1,000 / 900** | 10,000 / 9,000 |
| Overage (SMS / WhatsApp / prospect / email) | 9p / – / 30p / 0.4p → **none** | 8p / 6p / 26p / 0.35p → **none** | 7.5p / 5p / 22p / 0.3p → **none** | 7p / 4p / 18p / 0.25p → **none** |

| Bundle | Before | **After** |
|---|---|---|
| SMS 100 / 500 / 1,000 segments | £9 / £40 / £75 | **£24 / £115 / £220** |
| WhatsApp 250 / 1,000 messages | £15 / £50 | £68 / £265 (27p a message) → **WhatsApp token packs 1,000 / 2,000 / 5,000 tokens at £20 / £40 / £100** (2 tokens a reply or utility template, 5 a marketing template; §5.4) |
| AI tokens 0.5M / 2M / 6M | £15 / £49 / £129 | unchanged |

- **Why SMS can shrink without hurting the product.** Follow-up after the first text now goes by email through the customer's mailbox (§3.6), so SMS per lead falls from 5.02 segments to 2.08. Every plan still covers **an instant first text for every lead at its lead cap** (200 ≥ 100, 400 ≥ 400, 1,000 ≥ 1,000). It also covers more leads end to end than before (96 / 192 / 481, against 50 / 159 / 359).
- **WhatsApp as a paid add-on.**
  - The plan gate is unchanged: Growth and above may use it; Starter and the trial may not.
  - Nothing is included. Each message is paid only from prepaid WhatsApp tokens.
  - ~~Every message is priced at the Meta marketing rate (27p).~~ **Superseded the same day** (owner: "we must be competitive with WhatsApp specialists"): tokens by category, 2 for a reply or utility template and 5 for a marketing or unrecognised template, at 2p a token (4p / 10p, ~40% after Stripe; §5.4).
- **Price book.** Migration 0138 adds Meta's UK category rates: marketing $0.0635, utility $0.022, authentication $0.022, and service $0 until 30 Sep 2026 then $0.022. Twilio's $0.005 fee is kept alongside.

### 10.2 Every plan and interval, max and typical

Rounded to the penny. `planCost()` in `unit-costs.ts` computes them.

| £ / month | Starter M max | Starter A max | Growth M max | Growth A max | Pro M max | Pro A max |
|---|---|---|---|---|---|---|
| Revenue | 99.00 | 84.17 | 199.00 | 169.17 | 399.00 | 339.17 |
| AI (allowance × 1.1 × £1.13/1M) | 1.25 | 1.25 | 4.98 | 4.98 | 7.47 | 7.47 |
| SMS out | 8.45 | 8.45 | 16.91 | 16.91 | 42.27 | 42.27 |
| SMS in (50%) | 0.57 | 0.57 | 1.13 | 1.13 | 2.83 | 2.83 |
| Number | 1.89 | 1.89 | 1.89 | 1.89 | 1.89 | 1.89 |
| WhatsApp (0 included) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| Resend | 0.12 | 0.12 | 0.39 | 0.39 | 0.94 | 0.94 |
| Google Places | 1.19 | 1.19 | 5.94 | 5.94 | 11.89 | 11.89 |
| **Variable** | **13.46** | **13.46** | **31.25** | **31.25** | **67.29** | **67.29** |
| Stripe | 4.36 | 3.55 | 8.56 | 7.12 | 16.96 | 14.26 |
| Infrastructure | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 | 2.00 |
| **Total cost** | **19.82** | **19.02** | **41.81** | **40.37** | **86.25** | **83.55** |
| **Gross profit** | 79.18 | 65.15 | 157.19 | 128.80 | 312.75 | 255.61 |
| **Margin at MAX** | **80.0%** | **77.4%** | **79.0%** | **76.1%** | **78.4%** | **75.4%** |
| Margin at TYPICAL (50%) | 89.6% | 88.5% | 89.4% | 88.1% | 89.1% | 87.7% |
| *Before (max)* | *77.7%* | *74.7%* | *43.0%* | *33.8%* | *24.2%* | *11.6%* |

- The annual column is binding everywhere.
- **Pro annual at 75.4% is the thinnest.** At the code's FX of £0.80/$ it would be about 74%. A Meta or Twilio rise hits credit prices, not the included allowance, because WhatsApp is no longer included.
- **Overage removed (2026-09-27): these figures are unchanged.** `planCost()` was re-run after the change and returns exactly the table above, because the max-usage model counts only included allowances. With no overage, anything above the allowance is prepaid credit at ≥ 75% (§10.3) or is refused, so no plan margin can fall below these figures.

### 10.3 Bundles and WhatsApp categories

Unit costs include the inbound share, as in §1.1.
- SMS = £0.0423 + 50% × £0.0057 = **£0.0451**.
- WhatsApp = Meta fee + Twilio $0.005 + 50% inbound × $0.005. That gives **marketing £0.0536**, and **utility and service (from 1 Oct 2026) £0.0223**.

There is no overage. A bundle is its own Checkout, so Stripe takes 4.2% (3.5% × 1.2 VAT) plus 20p.

| Unit | Price | Unit cost | Margin after Stripe |
|---|---|---|---|
| SMS bundle 100 / 500 / 1,000 | £24 / £115 / £220 | £0.0451 each | 76.2% / 76.0% / 75.2% |
| WhatsApp token pack 1,000 / 2,000 / 5,000, **marketing** (5 tokens = 10p) | £20 / £40 / £100 | £0.0536 each | **41.2% / 41.7% / 42.0%** (below 75% by owner decision; ×1.77–1.78 on cost) |
| WhatsApp token pack 1,000 / 2,000 / 5,000, utility / service (2 tokens = 4p) | £20 / £40 / £100 | £0.0223 each | **39.1% / 39.6% / 39.9%** (×1.70–1.72 on cost) |
| *Before: WhatsApp bundle 250 / 1,000 at 27p, marketing* | *£68 / £265* | *£0.0536 each* | *75.8% / 75.5%* |
| AI top-up 0.5M / 2M / 6M, at the blended £1.13/1M | £15 / £49 / £129 | — | 90.7% / 90.8% / 90.4% |
| AI top-up, at the absolute bound £3.40/1M | same | — | 83.1% / 81.5% / 79.8% |

**Stripe objects.** No Stripe object needs creating for these changes.
- Credit bundles use inline `price_data` (`checkout.ts` `createCreditCheckout`), so the new amounts take effect with the deploy.
- Plan prices are unchanged, so the existing subscription Price IDs stand.

### 10.4 Competitive position

Competitor prices are from §7, checked on each vendor's own page on **2026-09-27**, at £0.7549 per $. ClientTurn's included SMS and AI are part of the price. Most competitors bill messaging and AI on top.

| ClientTurn plan | Price | Leads | SMS | AI | Most comparable competitors (price; what is included for SMS, AI and leads) |
|---|---|---|---|---|---|
| **Starter** | £99/mo (£84 annual) | 100/mo | 200 segments, then email free | 1M tokens (~360 replies) | **GoHighLevel Starter** $97 ≈ £73: unlimited contacts; SMS and Conversation AI usage-billed on top (A18). **Instantly Growth** $47 ≈ £35: 5k emails and 1k contacts; no SMS; no qualification or booking (A20). **Smartlead Base** $39 ≈ £29: 6k sends; no SMS (A22). **Lindy Plus** $29.99 ≈ £23 per user: 3k credits; SMS not listed (A23) |
| **Growth** | £199/mo (£169 annual) | 400/mo | 400 segments, then email free; WhatsApp add-on | 4M tokens (~1,450 replies) | **GoHighLevel Unlimited** $297 ≈ £224: SMS, WhatsApp and AI usage-billed on top (A18). **HubSpot Sales Hub Pro** $100 ≈ £75 per seat, + $1,500 onboarding; no SMS allowance stated; 3,000 credits (A19). **Instantly Hypergrowth** $97 ≈ £73: 125k emails; no SMS (A20). **Lindy Pro** $99.99 ≈ £75 per user (A23) |
| **Pro** | £399/mo (£339 annual) | 1,000/mo | 1,000 segments, then email free; WhatsApp add-on | 6M tokens (~2,180 replies) | **GoHighLevel Agency Pro** $497 ≈ £375: messaging and AI usage-billed (A18). **HubSpot Sales Hub Pro** × 3 seats ≈ £226/mo + onboarding, before SMS (A19). **Instantly Light Speed** $358 ≈ £270: 500k emails; no SMS (A20). **Lindy Max** $199.99 ≈ £151 per user (A23) |

- The **headline prices did not move**, and every plan still covers a first text per lead up to its cap.
- ClientTurn is the only tool in the table that **includes** SMS and AI in its price, with qualification and booking. GoHighLevel usage-bills both on top. The cold-email tools include no SMS at all.
- Artisan, 11x and Podium publish no prices (A24–A26), so no claim is made about them.
- **Where competitiveness is weaker:**
  - **SMS bundles** now cost 22–24p a segment, against a Twilio UK retail rate of ~4.2p. A customer comparing that with buying Twilio directly will see a 5× markup.
  - ~~**WhatsApp** at 27p a message is about 4× Meta's marketing fee.~~ **Repriced (2026-09-27)**: 10p a marketing template and 4p a reply, with no platform fee, against the specialists below.
  - The SMS markup is the direct result of the 75% rule on credit. Email-first follow-up means most customers never need to top up.

**WhatsApp specialists** (checked on each vendor's own page on **2026-09-27**; £0.7549 per $, £0.84 per €, £0.0089 per ₹). Only what the page showed is quoted; everything else says "not verified".

| Vendor | Monthly platform fee | How messages are charged | UK marketing / utility / service per message | Source |
|---|---|---|---|---|
| **ClientTurn** | none on top of the plan (Growth £199 and above) | Prepaid tokens by category | **10p / 4p / 4p** | §5.4 |
| Twilio | none shown | Meta's fee plus **$0.005 per message, in and out** | 5.17p / 2.04p / 0.38p to 30 Sep, 2.04p from 1 Oct (Meta rates from A4/A5) | A2 |
| 360dialog | **€49 per number** (≈ £41.16); Premium €99 | Meta's fees passed through, "no markup on Meta fees" | 4.79p / 1.66p / 0p, then 1.66p from 1 Oct (Meta rates from A4/A5) | A29 |
| Gallabox | **₹2,399/mo annual** (≈ £21.35) or ₹2,999 quarterly (≈ £26.69) | Usage billed separately, own rate card (≈ Meta + 15%) | **5.51p / 1.91p / 1.91p** (rate card effective 1 Oct 2026) | A30, A31 |
| AiSensy | base plan price **not verified** (add-ons $50–$80/mo) | Prepaid conversation credits, own rate sheet (undated) | 4.79p / 1.99p / service "n/a" | A32 |
| respond.io | **$79/mo** Starter (≈ £59.64) | Meta fees charged by usage via a WhatsApp credit top-up; markup **not stated** | not published | A33 |
| Interakt | **$55/mo** Growth (≈ £41.52) | Per template type | UK rates **not verified** (behind a region link) | A34 |
| WATI | Growth "starting ~$25/mo" billed annually (≈ £19) | Per message on WATI's rate card | UK rates in-app only, **not verified**; the "~20% markup" figure appears only in third-party blogs | A35 |
| Trengo | **€299/mo** annual (≈ £251), €349 monthly, 10 users | "All WhatsApp service conversations: Free"; templates not stated | **not verified** | A36 |

- **Per message, the specialists are cheaper** (by about 4.5–5p on marketing and 2–2.3p on a reply), partly because on the shared number ClientTurn pays Twilio's fee both ways, which 360dialog and Meta-direct platforms do not.
- **Per month, ClientTurn is cheaper at SMB volumes**, because **we charge no WhatsApp platform fee**. Against 360dialog it stays cheaper up to about 791 marketing messages or 1,760 replies a month; against Gallabox Basic, about 476 or 1,022. At 300 replies and 200 marketing messages a month: ClientTurn £32.00, Gallabox £38.10, 360dialog £55.73 (§5.4).
- **Meta's own UK rates were not re-verified on Meta's page** (the rate card is an interactive widget). Gallabox's UK rate card (A31) is exactly Meta's $0.0635 marketing and $0.022 utility and service × 1.15, effective 1 Oct 2026, which is consistent with A3b, A4 and A5.

### 10.5 Where the margin rule and competitiveness pull apart: options (owner decides)

**Pro** is the only plan where meeting 75% at max meant cutting value rather than just moving follow-up to email. A first text per lead needs 1,000 segments, and the other allowances had to make room for them.

| Option | Pro allowances | Pro price | Margin max (monthly / annual) | Competitive position |
|---|---|---|---|---|
| **A: implemented** | 1,000 SMS, **6M** AI tokens, **1,000** prospects | £399 | 78.4% / **75.4%** | Price unchanged. 6M tokens is ~2,180 replies against ~612 needed for 1,000 leads at a 30% reply rate, so there is no practical loss. Prospects halve (still 2× Growth) |
| A′ | 1,000 SMS, 8M AI, 800 prospects | £399 | 78.4% / 75.3% | As A, with more AI and fewer prospects |
| B | 1,000 SMS, keep 12M AI and 2,000 prospects | **≥ £505** (£499 gives 74.9% annual) | 78.0% / 74.9% at £499 | Above GoHighLevel Agency Pro (£375) for Pro-scale; weaker |
| C | as B, at £399, but no annual discount on Pro | £399 | 73.5% / — | **Fails** 75% even monthly |

**Recommendation: A** (implemented). It keeps the £399 headline and the per-lead promise, and the AI cut is invisible at the lead cap.

**SMS credit.**
- **Option 1, implemented:** bundles at 22–24p a segment, ≥ 75%. There is no overage alternative (removed 2026-09-27).
- **Option 2:** 12p, about 58% margin. More competitive against raw Twilio, but it **breaks the rule**. Not implemented.
- **Recommendation: 1.** Email-first means the allowance is rarely exhausted, and the first text per lead is included.

### 10.6 Conversion impact of each cost change

| Change | Could it cost a sale? | Why not |
|---|---|---|
| Later nudges by email (default strategy) | Only for unengaged leads | The first touch is still instant SMS. It applies only to leads who have not replied and whose intent is below MEDIUM. An engaged lead stays on their channel, and the "SMS for every step" option restores the old behaviour |
| Follow-up SMS cap (3 per unengaged lead) | No | Engaged leads are exempt. Past the cap, nudges go by email, not nowhere |
| Agent SMS | No | There is no per-lead budget, only an abuse ceiling of 40 segments per 24 h (a golden conversation uses about 4). If the ceiling or the allowance refuses a reply, a person takes over |
| Conversation reserve | Protects conversions | First texts yield SMS to live conversations when the allowance runs low |
| GSM-7 normalisation | No | Same words; punctuation only |
| Token de-duplication | No | Lossless: the current message goes once and the notice once. `golden-conversations`, `question-grader`, `agent-evals` and `qi-manual-inspection` are green with no expectation changes |
| Per-lead token ceiling (250k) | No | Abuse ceiling of about 90 turns; hands the lead to a person |
| Tier routing | No change | Composition stays on mini; classify and extract were already nano |
| Smaller included SMS / Pro AI and prospects | No | Every plan covers a first text per lead at its cap; the Pro AI allowance is about 3.5× what 1,000 leads need |
| WhatsApp as a paid add-on | Possibly, for WhatsApp-first customers | The gate is unchanged, and prepaid credit is available. A customer relying on included WhatsApp now pays per message. **Tell existing Growth and Pro customers before 0138 is applied** |
| Trial at 8 SMS | Somewhat | It shows the instant SMS and a short SMS conversation, plus email conversations. A trial with full SMS conversations for 3 leads costs £1.06 (§2.1). Owner decision |
| System email daily cap | No | Only the email copy of an owner alert is skipped at the cap; the in-app notification stands |

---

## 11. Live economics dashboard (2026-09-27)

Everything above is **modelled** from allowances. **Admin → Economics** (`/admin/economics`, placed with Overview in the admin rail) shows what each workspace **actually** cost, from recorded usage, priced with the same `unit-costs.ts` constants. It is platform-only, behind `requirePlatformAdmin` (a non-operator is sent to `/admin/login`), and it never calls Stripe.

**What it shows**

- **Per workspace, month to date and the last full month:** plan, revenue, cost by line, gross profit, margin, and (month to date) the projected month-end margin. Rows below 75% are flagged red. The table sorts by any column, and "Below 75% only" filters to flagged rows (month to date **or** projected). Each row opens to its cost lines.
- **Totals:** platform revenue, cost, gross profit and margin; workspaces below 75%; **cost per trial** (usage cost of trials started in the period ÷ trials, as §2 defines it: no number share, no allocation); **cost per lead** and **per qualified lead** (usage cost ÷ leads created / leads qualified in the period); and the split by cost driver.
- **Pricing simulator:** pick Starter, Growth or Pro, edit the price, leads, SMS segments, AI tokens and verified prospects, and see monthly and annual margin at max and typical usage with a pass/fail for the ≥ 75% rule. It calls `planCost()`, the function `tests/plan-margins.test.ts` asserts, so an unedited plan shows exactly the §10.2 figures. It is read-only: there is no action behind it.
- **Data sources:** every cost line's source, and every unit cost with its provider source and the date it was checked (`UNIT_COST_SOURCES`, `UNIT_COSTS_CHECKED_ON` in `unit-costs.ts`).

**How each line is measured**

| Line | Recorded quantity | Price |
|---|---|---|
| SMS out | `usage_events` `sms_outbound_segment` (the send meter) | U1 per segment |
| SMS in | `usage_events` `sms_inbound_segment`. **Nothing writes it yet, so it shows "not measured"**, not £0 | U2 |
| WhatsApp | `messages` sent/delivered by `template_category` (none = service, free before 2026-10-01), plus inbound; ledger sends with no category are priced at marketing | U5–U9 |
| AI | `usage_events` `ai_{mini,nano}_{input,cached,output}_token` | U10 / U11 per model and kind (`AI_TOKEN_RATE_GBP_PER_MILLION`) |
| System email (Resend) | `cost_events` provider `resend`. **System email is capped per day but not metered, so it shows "not measured"** | U12 |
| Google Places | `cost_events` `google_places` records → ⌈records ÷ 20⌉ requests per batch (a lower bound) | U14 |
| Other providers | any other `cost_events` spend, as booked (USD × 0.7549) | as booked |
| Number rental share | **allocation:** one shared number (U3) split across workspaces that sent SMS | U3 |
| Stripe fees | **estimate:** `planCost()`'s premium-card fee on the subscription, plus 3.5% × 1.2 + 20p per top-up | U17, U18 |
| Infrastructure | **allocation:** £2 per paying workspace (§1.1) | assumption |

**Revenue** is the subscription mirror's plan list price for its interval (annual ÷ 12), plus top-ups with status PAID in the period. No invoice amounts are stored locally, so a discount or proration is not reflected, and an Enterprise contract price is "not recorded" (that workspace is left out of revenue **and** margin rather than counted as cost against £0). A past month uses the subscription's current plan.

**Month to date** counts the whole month's subscription revenue, Stripe fee and allocations against usage so far. The **projection** runs usage on at its daily rate to month end; fixed lines stay whole and top-ups are not assumed to recur.

**Alerts.** The daily cron enqueues `economics.margin_check`. It writes an `economics_alerts` row (`MARGIN_BELOW_THRESHOLD`; CRITICAL below 55%, else WARNING) when a workspace's month-to-date **or** projected month-end margin is below 75%, **once per workspace per month**. The check reads what it already raised this month, and a unique index settles overlapping runs. Open alerts appear on the page and in the admin bell count.

**Read model.** Migration `0145_live_economics.sql` (**not yet applied**) adds the service-role RPC `admin_economics_usage(from, to, whatsapp_service_charged_from, usd_to_gbp)`, which counts usage in SQL (a truncated read would under-report cost), and the once-a-month alert index. No table is added. Until it is applied, the page says the read model is not installed, rather than showing zero cost.

**Code.** `src/lib/admin/economics-model.ts` (pure: pricing, totals, projection, alert rule, simulator), `economics-live.ts` (the read), `economics-alerts.ts` (the daily check), `src/components/admin/economics/*`. Tests: `tests/admin-economics.test.ts`. It replaces the earlier "Usage & Margins" page, which read `business_margin_monthly`. That rollup prices WhatsApp from the price book, which holds only Twilio's fee (§0.2 note 1), and it counts list price as revenue.

---

## Appendix — sources

All web sources were accessed **2026-09-27**.

| # | Source | URL / location |
|---|---|---|
| A1 | Twilio UK SMS pricing | https://www.twilio.com/en-us/sms/pricing/gb |
| A2 | Twilio WhatsApp pricing | https://www.twilio.com/en-us/whatsapp/pricing |
| A3 | Meta, WhatsApp Business Platform pricing | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing |
| A3b | Meta, upcoming pricing updates for service and utility messages (charged from 2026-10-01) | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages |
| A4 | Drag, WhatsApp Business API pricing 2026 (UK rates citing Meta's rate card of 2026-07-01). Secondary | https://www.dragapp.com/blog/whatsapp-business-api-pricing/ |
| A5 | SleekFlow, WhatsApp Business API pricing UK. Secondary | https://sleekflow.io/en-gb/blog/whatsapp-business-price |
| A6 | OpenAI API pricing (gpt-5.4-mini / nano; data-residency uplift note) | https://developers.openai.com/api/docs/pricing |
| A7 | Microsoft Q&A, "Pricing for gpt 5.4, 5.4 mini, 5.4 nano" (table as image, unreadable) | https://learn.microsoft.com/en-us/answers/questions/5841927/pricing-for-gpt-5-4-5-4-mini-5-4-nano |
| A7b | Future AGI Azure calculator (secondary) | https://futureagi.com/llm-cost-calculator/azure-openai/gpt-5-4-mini/ |
| A8 | Resend pricing | https://resend.com/pricing |
| A9 | Google Maps Platform pricing (Text Search SKUs) | https://developers.google.com/maps/billing-and-pricing/pricing |
| A10 | Places Text Search (New), field → SKU | https://developers.google.com/maps/documentation/places/web-service/text-search |
| A11 | Companies House API rate limiting | https://developer-specs.company-information.service.gov.uk/guides/rateLimiting |
| A12 | Stripe UK pricing | https://stripe.com/gb/pricing |
| A13 | Stripe, card verification (no published fee found; search) | https://stripe.com/pricing |
| A14 | Supabase pricing | https://supabase.com/pricing |
| A15 | Vercel pricing | https://vercel.com/pricing |
| A16 | Vercel fair-use guidelines (Hobby non-commercial) | https://vercel.com/docs/limits/fair-use-guidelines |
| A17 | Cloudflare R2 pricing | https://developers.cloudflare.com/r2/pricing/ |
| A18 | GoHighLevel pricing | https://www.gohighlevel.com/pricing |
| A19 | HubSpot Sales Hub pricing | https://www.hubspot.com/pricing/sales |
| A20 | Instantly pricing | https://instantly.ai/pricing |
| A21 | GBP/USD 1.3246 (mid-market, 2026-09-27) | https://www.exchangerates.org.uk/GBP-USD-spot-exchange-rates-history-2026.html |
| A22 | Smartlead pricing | https://www.smartlead.ai/pricing |
| A23 | Lindy pricing | https://www.lindy.ai/pricing |
| A24 | Artisan pricing | https://www.artisan.co/pricing |
| A25 | 11x pricing (HTTP 404) | https://www.11x.ai/pricing |
| A26 | Podium pricing | https://www.podium.com/pricing |
| A27 | Leadsie | https://www.leadsie.com/ |
| A28 | SalesRabbit | https://salesrabbit.com/ |
| A29 | 360dialog pricing | https://360dialog.com/pricing |
| A30 | Gallabox pricing | https://gallabox.com/pricing |
| A31 | Gallabox WhatsApp rate card (UK, effective 2026-10-01) | https://docs.gallabox.com/pricing-and-billing/whatsapp-pricing/rate-card |
| A32 | AiSensy pricing (USD) and its linked per-country rate sheet (undated) | https://aisensy.com/pricing/usd |
| A33 | respond.io pricing | https://respond.io/pricing |
| A34 | Interakt pricing (US) | https://interakt.shop/pricing-us/ |
| A35 | WATI pricing; WATI help, message pricing | https://www.wati.io/pricing/ ; https://support.wati.io/en/articles/11561662 |
| A36 | Trengo pricing | https://trengo.com/pricing |

**Repo and database sources:**
- `src/lib/billing/plans.ts`, `limits.ts`, `limits-service.ts`, `tokens.ts`, `sourcing-allowances.ts`, `checkout.ts`
- `src/lib/ai/tiers.ts`, `budget.ts`, `tokens.ts`
- `tests/fixtures/prompt-token-snapshot.json`, `tests/golden-conversations.test.ts` (run 2026-09-27)
- `src/lib/messaging/sms-segments.ts`, `sms-compliance.ts`, `whatsapp-templates.ts`, `registry.ts`
- `src/lib/automation/defaults.ts`, `src/lib/jobs/handlers/automation-advance.ts`, `send-store.ts`, `shared.ts`, `campaign-send.ts`
- `src/lib/find-leads/cost-model.ts`, `server/budget.ts`, `server/providers/*.ts`
- `src/lib/affiliates/programme.ts`
- `supabase/migrations/0018_ai_usage_billing.sql`, `0122_ai_economics.sql`
- live tables, read-only, 2026-09-27: `provider_price_book`, `ai_model_tiers`, `ai_budgets`, `plan_entitlements`, `affiliate_commission_plans`
- `docs/CRON.md`, `docs/revenue-engine/10-qualification-engine-report.md` §13–14, `11-final-report.md` Parts K, P and §100
