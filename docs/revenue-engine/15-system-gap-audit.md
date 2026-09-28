# 15 — Whole-system gap audit (read-only)

_2026-09-28. Read-only audit of the whole product. No code, config or database was changed, and no paid provider was called.
Method: code and migration reading, grep, `npm audit --omit=dev`, `package.json` script parsing. No tests were run, because other agents were mid-edit._

**Scope rule.** This lists gaps that are **not already in `todo.md`**. Items already there are left out on purpose:

- the Twilio token; Stripe TEST prices; `automatic_tax` / VAT (O7); Vercel Pro;
- the accessibility audit; performance/concurrency QA; help screenshots;
- the recording/transcript retention job and data-rights for quote/invoice tables (automations batch);
- voice P3 items.

Where one of this audit's findings extends a `todo.md` item, it says so.

Severity:

- **P0**: launch blocker.
- **P1**: fix before paying customers.
- **P2**: soon after launch.

"Verified" means read in code. "Reported" means a sub-audit found it and it was spot-checked, not re-read line by line.

---

## Executive summary: top 10

| # | Sev | Gap | Evidence | Impact | Fix |
|---|---|---|---|---|---|
| 1 | **P0** | **The privacy policy and terms say nothing about AI voice calls.** Nothing covers call audio, transcripts, recordings, Retell's processing, or retention (code default 90 days, settable 1–365). Retell is listed with location/transfer "To be confirmed" and "not yet confirmed against a signed DPA". Its onward sub-processors (LLM, TTS) are unlisted. | `src/app/(marketing)/privacy/page.tsx` scope 216-224, lead data 422-444, retention table 40-87 (no call row); `src/lib/marketing/subprocessors.ts:99-116`; `src/lib/voice/runtime-core.ts:1153` | The first live call processes recordings with no published notice, basis or retention. This is a UK GDPR Art 13/14 and Art 28(2) problem. | Add voice to privacy (scope, data types, Art 28 annex, retention row), terms cl. 4 and cl. 12 (PECR reg 19 and AI disclosure). Get Retell's DPA and region, then fill the sub-processor row. |
| 2 | **P0** | **The legal pack is dated 5 Sept 2026 and was not re-versioned for the 27 Sept features.** A sub-processor (Retell) was added the same day it was announced. Privacy promises 30 days' notice of material changes. | `src/lib/marketing/company.ts:57-59` (`LEGAL_LAST_UPDATED`); `subprocessors.ts:208-212` change log | Anyone signed up before 27 Sept has not been given the promised notice for voice, quotes or invoicing. | Bump the version and date. Email existing workspaces the change, with 30 days' notice for the new sub-processor. Add a legal changelog. |
| 3 | **P0 (conditional)** | **Enrichment and lead-finding providers are missing from the sub-processor register.** These are Apollo, Hunter, Clearbit, Google Places, Companies House, LinkedIn SN, Meta/TikTok ad libraries, website scraping and Gravatar (lead email hashes). Privacy says "we do not enrich from external data brokers". | `src/lib/find-leads/server/providers/{apollo,hunter,clearbit,google-places,…}.ts`; `src/lib/env.ts:305-316`; `src/lib/leads/avatar.ts`; privacy 450-451 | If any key is set in production, the privacy policy is false. Art 14 source notices are also missing. | The owner confirms which providers are live. Then either list them, add Art 14 wording and remove the "no brokers" line, or disable them with a server-side check. At minimum, drop Gravatar or list it. |
| 4 | **P0** | **Quote e-signature, invoices and customer payment links are not in the terms or privacy policy.** Terms 7.9 says "We do not provide payment services". Nothing states the merchant of record or ClientTurn's role for signer data (name, email, IP, user agent). | `terms/page.tsx` 7.5 (330-337), 7.9 (362-368); `src/lib/quotes/public-sign.ts:214-296`; `src/lib/esign/notice.ts:26-30` | Quote-to-cash ships with no contractual footing, and the signer data has no published controller or retention. | Terms need four points. (a) The customer is merchant of record through their own provider. (b) E-signature is a "simple electronic signature with audit trail" (not eIDAS-qualified), with excluded document types. (c) ClientTurn processes signer and invoice data as processor. (d) Retention rows for quotes, signatures and invoices. |
| 5 | **P0** | **There is no error tracking and no push alerting.** No Sentry or equivalent is installed. There is no `instrumentation.ts` and no root `global-error.tsx` / `not-found.tsx`. Dead jobs, webhook failures, cron misses and economics alerts are pull-only in Admin. `cron_job_health` is never read. The `voice.*`, `quote.*` and `payment.*` observability events are declared but never emitted. | `package.json` (no SDK); `src/lib/admin/health.ts`; `src/lib/admin/economics-alerts.ts:39`; `docs/OBSERVABILITY.md` "Where it is used" | A failing voice dial, payment confirmation or stalled worker goes unnoticed until a customer complains. That is unacceptable once money and calls are live. | Add `@sentry/nextjs` (instrumentation, global-error, source maps), or a Vercel log drain with alerts. Add a daily/15-minute "ops alert" email to the owner when there are dead jobs > 0, `cron_job_health` misses, webhook failures, or new economics alerts. |
| 6 | **P1** | **The queue is slower than documented and can loop forever.** (a) The worker stops claiming 10 s after start, and `startedAt` is set before the reaper and 7 scheduler enqueues run. Real throughput is about 6–16 jobs/min, not the "~50/min" in `docs/CRON.md:161-164`. (b) Voice/quote/invoice jobs run at default priority 100 in the same FIFO as agent and sourcing jobs. (c) `reap_stalled_jobs` resets `running` to `pending` without checking `attempts >= max_attempts`. A job that always hits the 60 s kill is never marked dead and re-runs every 5 minutes. | `src/app/api/cron/worker/route.ts` (claim loop, `BATCH_SIZE=25`, `maxDuration=60`); `supabase/migrations/0012_job_claim.sql:50-53` (verified); `0137_job_claim_pause_and_retry_index.sql:29-66` | Voice webhook ingest and dials wait behind sourcing bursts. A poison job burns function time forever and never alerts. | Start the claim budget after the scheduler step, or run the schedulers in the daily route. Give `voice.webhook_ingest`, `voice.dial` and `payment.confirm` priority 10. New migration: the reaper marks `dead` when `attempts >= max_attempts`. Correct `docs/CRON.md`. |
| 7 | **P1** | **Billing edge cases leave workspaces stuck or over-granted.** (a) A failed **one-off** invoice sets PAST_DUE before the subscription check and opens no dunning row, so nothing clears it and voice stays blocked. (b) Disputes reverse only affiliate commission, not tokens, minutes or credit. (c) There is no `checkout.session.async_payment_*` or `invoice.payment_action_required` handling. (d) The Twilio number is not released on cancel or non-payment, so ClientTurn keeps paying rent. | `src/lib/billing/dunning.ts:170-190`; `src/app/api/webhooks/stripe/route.ts:30-49, 218-220, 484`; `src/lib/voice/entitlement.ts:105-130` | A paying customer is locked out by a failed £49 pack payment. A chargeback keeps the minutes. There is unbounded number rental after churn. | Only open PAST_DUE for subscription invoices. On `charge.dispute.created`, queue the same `billing.refund_reverse`. Handle SCA/async events with a customer notice. Add a `voice.number_release` job N days after cancel. Confirm Stripe Smart Retries are off, since there is an in-house 30-day retry. |
| 8 | **P1** | **Bounce handling mis-suppresses.** A synchronous SMTP 550 is never suppressed. Every send result runs through `recordEmailHealth`, which flips the **whole mailbox** to ACTION_REQUIRED for one bad address, and `550` also catches 5.7.x policy blocks. The NDR parser falls back to the `from` address, so it can suppress mailer-daemon instead of the recipient. | `src/lib/email/account.ts:327-337`; `src/lib/email/store.ts:222-252`; `src/lib/jobs/handlers/email-poll.ts:29-37, 80-85, 136-153` | One typo'd lead email shows "connection issue" for the customer's mailbox, and the bad address is retried. | Split recipient-level 5.1.x (suppress the recipient, mailbox stays healthy) from 5.7.x and auth failures (mailbox health). If the recipient can't be extracted, don't suppress. |
| 9 | **P1** | **Integration health is mostly fake.** The health job only really checks Twilio; for others, "HEALTHY" means "a token row exists". A failed OAuth refresh throws but never sets ACTION_REQUIRED, and there is no `invalid_grant` handling. Zoho connections made before the UPDATE-scope fix now throw on every re-sync with no reconnect prompt. | `src/lib/jobs/handlers/integration-health.ts:41-52`; `src/lib/integrations/oauth.ts:319-340`; `src/lib/integrations/providers/zoho-crm.ts:75-76, 337-343` | HubSpot, Zoho and Google revocations stay green until leads silently stop syncing. | In `getValidAccessToken`, catch `invalid_grant` and 401 `OAUTH_SCOPE_MISMATCH` and set `integrations.status = ACTION_REQUIRED` (the Reconnect card already exists). Add a cheap authenticated ping per provider to the health job. |
| 10 | **P1** | **Entitlement holes.** `/app/analytics` is hidden from trial only in the nav; the page doesn't check the entitlement. `saved_search` (priced at 2/10/30) is never counted. `assertLeadCapacity` has one caller (`lead-process.ts:395`), so import/API/MCP paths are unverified. There is no over-limit handling on downgrade (seats, numbers). | `src/app/(app)/layout.tsx:97` vs `src/app/(app)/app/analytics/page.tsx:75`; `src/lib/billing/v4-entitlements.ts:23,63`; `src/lib/find-leads/actions.ts:639-722`; `src/lib/billing/entitlements.ts:158-164`; `src/lib/billing/plan-change.ts:154-186` | Breaks the CLAUDE.md rule "Entitlements are enforced server-side". It gives paid features away and lets customers exceed priced limits. | Add `assertEntitlement` to the analytics page. Count `recurring_searches` against `saved_search`. Confirm or route every lead insert through `assertLeadCapacity`. Show a downgrade pre-check listing what is over the new plan's limits, and apply the limits at period end. |

Next in line, all P1: missing RLS proofs for 0143–0149 and 0155–0162; the test-group chaining; no root error boundary on onboarding and start-trial; the rate limiter fails open for auth; backups/PITR unverified; the Art 22 contradiction on `/privacy-request`; `loadUnitCosts` reading USD as pence.

---

## Full table by area

### 1. Customer journey and route states

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | There is no root `global-error.tsx`, `error.tsx` or `not-found.tsx`. An error thrown in `src/app/(app)/layout.tsx` (entitlements, health or notification fetch) has no boundary, because `(app)/error.tsx` sits inside that layout. Unknown URLs get the default Next 404. | `src/app/` listing | Add a branded root `global-error.tsx` and `not-found.tsx`. |
| P1 | The first-run pages have no `loading.tsx` or `error.tsx` at any level: `/onboarding` (302 lines), `/start-trial`, `/admin/login`. Nor do `/q/[token]`, `/unsubscribe/[token]`, `/status` or `affiliates/*`. | `src/app/onboarding/page.tsx`, `src/app/start-trial/page.tsx` | Add a boundary to each. Onboarding and start-trial matter most: a throw there is a dead end at signup. |
| P1 | Permission-denied is rendered only in Settings (`PermissionDenied`: 2 uses). No `/app` page outside Settings has a permission state. There is no shared `IntegrationRequired` component; it is handled ad hoc in 5 places. | `src/components/settings/notices.tsx:24`; `src/components/ui/feedback.tsx` | Add `IntegrationRequiredState` next to `PlanLimitState` in `feedback.tsx`. Use it and `PermissionDenied` on leads/inbox/agents/analytics where role or connection matters. |
| P1 | `/app/analytics` has no entitlement gate (top-10 #10). | see above | `assertEntitlement`. |
| P2 | **The IA has drifted from CLAUDE.md.** CLAUDE.md says `/app/analytics` was "deleted outright" and names 5 destinations. The nav has Analytics, Agents, Inbox and Find Leads (cited as "V4 §21"). | `src/lib/app/nav.ts:41,83`; CLAUDE.md Resolved conflict 0 | Owner decision. Update CLAUDE.md to the V4 IA, or remove the routes. Today the spec and the code disagree. |
| P2 | Dead booking leftovers: `bookingsHref()` builds `/app/bookings` and has no callers; `revalidatePath("/app/bookings")` targets a route that doesn't exist. | `src/lib/bookings/types.ts:145-148`; `src/lib/bookings/actions.ts:110` | Delete. |
| P2 | `agents/[id]` and `help/[category]/*` call `notFound()` with no local or root not-found. | — | Covered by the root not-found fix. |
| OK | Every static `/app/...` link resolves. The `?section=payments/account/tax` links are affiliate-portal links, and `settings-view.tsx:152-159` handles them. | — | — |
| Not audited | Settings that are written but never read; a step-by-step trace of signup → won. | — | Include in the browser pass already listed in todo §6. |

### 2. Legal and policy pages vs features

These are all P0/P1 because todo.md only has "Read `/compliance`". Top-10 #1–#4 cover the voice, enrichment, payments/e-sign and versioning gaps.

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | **There is no downloadable customer DPA.** The Art 28 terms sit inside the privacy policy (463-547, incorporated by terms 16.2); a signed DPA is "on request". B2B buyers (agencies, SaaS) will ask for one. | `privacy/page.tsx:470` | Publish `/dpa`: Art 28 clauses, IDTA/UK Addendum, a sub-processor annex, a security annex, and e-sign or click-accept. |
| P1 | Transfers name the IDTA / UK Addendum only. There is no mention of the UK Extension to the EU-US DPF, which covers Vercel, Resend, Twilio and Retell (US). | `privacy/page.tsx:598-627`; `subprocessors.ts:162-165` | Name the actual mechanism per US provider. |
| P1 | **Art 22 contradiction.** `/privacy-request` offers "object to … being scored, ask a person to review an automated decision". Privacy 812-814 and terms 4.4 say there is no solely automated decision-making. Terms 4.3 also describes AI as only "classify intent, extract values", which is out of date with the voice agent and AI quote tools. | `src/app/(marketing)/privacy-request/page.tsx:31-34` | Pick one position (scoring assists, it does not decide) and align all three pages. Update terms 4.3 to describe the voice agent and the AI permission model. |
| P1 | The data-deletion page uses `privacy@clientturn.co.uk`. Only `support@` and `legal@clientturn.com` are monitored. | `data-deletion/page.tsx:69,87,135,154`; `company.ts:39-45` | Switch to the monitored address. **Quick win.** |
| P1 | Voice-minute packs are not in refund clause 9.9, although `src/lib/voice/pack-refund.ts` exists. | `terms/page.tsx:466-483` | Add them. |
| P1 | Terms 7.5 says SMS and WhatsApp are billed by the customer's own provider. That conflicts with the prepaid SMS credit and WhatsApp tokens ClientTurn sells. | `terms/page.tsx:330-337` | Reword. |
| P1 | The ICO registration number and VAT number are empty. | `company.ts:52-53` | Owner supplies them. **Quick win** once known. |
| P1 | WhatsApp: the Meta WhatsApp Business terms and Meta as processor (Cloud API direct via graph.facebook.com) are not covered; only Twilio is listed. | `subprocessors.ts` | Add Meta (WhatsApp Cloud) as a customer-enabled sub-processor. |
| P1 | **Needs a check.** The compliance page says "ClientTurn is not named on the call unless someone asks". The owner decision of 2026-09-28 is that ClientTurn is named at the **end** of every call. | `compliance/page.tsx:410`; `todo.md` §3 | Align with `src/lib/voice/opener.ts`. The marketing agent may be editing this page. |
| P2 | The customer-enabled register is missing Pipedrive, Zapier, the Shopify/WooCommerce/GoCardless/Paddle order-paid sources and the customer's own SMTP/IMAP. Affiliates' data sent to Stripe Connect is not in privacy. | `src/lib/payments/facts.ts:29`; `src/lib/affiliates/stripe-connect.ts` | Add them. |
| P2 | The cookie policy doesn't cover `/q/*` pages. The claim that analytics loads only after consent is unverified against `cookie-consent.tsx` and `track.ts`. No third-party analytics libraries are present (good). | `cookies/page.tsx` | Verify, then add a `/q` line. |
| OK | The controller/processor split is stated (privacy 164-177, terms 16). There is a retention table for account data. PECR reg 22/23 and TPS are covered for the customer's own duty. The compliance page states PECR reg 19. | — | — |

### 3. Security

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | The rate limiter **fails open** (by design). A Supabase or RPC blip removes brute-force protection on `auth:signin` and `admin:signin`. | `src/lib/security/rate-limit.ts:128-136` | Fail closed for the `auth:*` and `admin:*` buckets only. |
| P2 | There is no `script-src` CSP (a documented choice). Only `frame-ancestors 'none'` is set. | `next.config.ts:28-38` | At minimum add `object-src 'none'; base-uri 'self'; form-action 'self'` (**quick win**). Nonce CSP later. |
| P2 | The cron secret is compared with `!==` (not constant-time) and accepted as `?secret=` in the query string, where it can end up in logs. | `src/app/api/cron/worker/route.ts:63-68`; `cron/daily` 18-24 | Header only, `timingSafeEqual`. `docs/CRON.md` pg_cron uses a header, so check before removing the query form. |
| P2 | There are no per-user limits on `/api/search`, `/api/exports/*` or `/api/find-leads/runs/[runId]`. `updatePassword` and `confirmUnsubscribe` are not limited (they need a session or token). | route list | Add per-user buckets to search and exports. |
| P2 | Banner dismiss accepts requests with **no** `Origin` header. | `src/app/api/platform/banners/dismiss/route.ts:24-27` | Require `Origin`/`Sec-Fetch-Site`. Low impact. |
| P2 | Logo uploads allow `image/svg+xml`. It renders in `<img>`, where scripts can't run, but a directly opened signed URL would execute script on the R2 origin. | `src/lib/storage/r2.ts:14` | Drop SVG or sanitise it, and serve with `Content-Disposition: attachment` / a strict CSP. |
| P2 | SSRF: the DNS-rebinding window is documented as open (it needs a pinned-IP agent). | `src/lib/security/safe-fetch.ts` header | Accept for launch. Pin later. |
| OK | Headers include HSTS preload, XFO DENY, nosniff, Referrer-Policy and Permissions-Policy. **`npm audit --omit=dev`: 0 vulnerabilities.** No secret-looking `NEXT_PUBLIC_*` var. No client file imports `supabase/admin` or `env`. `.env*` are gitignored. Every website, webhook-dispatch and onboarding fetch goes through `safe-fetch` (private-IP, resolved-IP and per-hop redirect checks). Upload type and size allow-lists exist. **Every admin action file** routes through `guarded()`, which calls `requireStepUp` (30-minute window). Public quote, PDF, sign, v1, MCP, unsubscribe and all webhooks except Stripe are rate limited; Stripe relies on signature verification. `/api/dev/seed` returns 404 in production. | — | — |
| Not audited | Session and cookie lifetime, admin MFA (step-up is password-based). | — | Worth a look before Enterprise sales. |

### 4. RLS (migrations 0143–0162)

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | **Impersonation proofs are missing** for every table outside 0150–0154. The tables most in need are the member-read ones: `checkout_attempts`, `checkout_payments` (0143), `experiment_promotions` (0158), `voice_tool_calls` (0162), plus `platform_banner_dismissals` (own-user) (0161). The service-only tables (`payment_endpoints`, `billing_unit_conversions`, `upsell_events`, `subscription_welcome_emails`, `lead_commercial_leases`, `commercial_action_claims`, `platform_maintenance_windows`, `platform_banners`) need a "no authenticated read" assertion. The one existing proof is `supabase/tests/0150-0154-rls-proof.sql`. | `supabase/tests/` | Add `supabase/tests/0143-0162-rls-proof.sql`, copying the 0150–0154 pattern. Add an anon test of `quote_public_view()` (0153:587) returning NULL for revoked or expired tokens. |
| P2 | The three 0143 tables `enable` but do not `force` RLS, unlike every later migration. `0144` definer functions use `search_path = public` without `pg_temp` (service-role only). | `0143_direct_sale_loop.sql:42,94,157`; `0144_lead_interests.sql:105,189,264` | Tidy in the next migration. |
| OK | Every new table has RLS on. No `using (true)`, no anon table grants, no views. Every SECURITY DEFINER function has `search_path` set. Anon can only execute `quote_public_view`, `platform_maintenance_public` and `platform_marketing_banners` (deliberate). There are no writes from `authenticated`; all writes go through service role. Migration numbers are unique; the highest is 0162. | — | — |

### 5. Reliability and ops

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P0 | No error tracking and no push alerts (top-10 #5). | — | — |
| P1 | Queue throughput, priority and the reaper infinite loop (top-10 #6). | — | — |
| P1 | `health.ts` stall detection has a hard-coded QUEUES list that omits every `voice.*`, `quote.*`, `invoice.*`, `payment.confirm`, `checkout.nudge`, `event.dispatch`, `reengage.*`, `outreach.*` and `social.*` job. | `src/lib/admin/health.ts` ~10-67 | Derive the list from `lib/jobs/registry.ts`. |
| P1 | **Backups and restore are unverified.** PITR being enabled is an assumption, and no restore drill has been done. | `docs/PRODUCTION_PROGRAMME_TRACKER.md:488-490` | Confirm the Supabase plan has PITR (Pro plus the add-on). Run one restore to a branch and write `docs/RESTORE.md`. |
| P2 | The Stripe webhook does its work inline: subscription mirror, dunning, voice-item sync, and `stripe.charges.retrieve` in the dispute path. This breaks the CLAUDE.md "ack fast, queue a job" rule; it is idempotent, so the risk is timeouts. A swallowed "mark processed" failure can strand an event in `processing`, and a Stripe retry then returns "duplicate". | `src/app/api/webhooks/stripe/route.ts:102-165, 423` | Move handling into a `billing.stripe_event` job. Make the processed-mark failure retryable. |
| P2 | SMTP has no provider-side dedupe for invoice reminders (only a deterministic Message-ID). | `src/lib/email/smtp.ts:145` | Record the send before the SMTP call. |
| OK | The `voice.dial`, `voice.text_back`, `quote.expire`/`nudge` and `invoice.issue`/`remind` handlers re-read state, use expected-status transitions and carry idempotency keys. The queue has backoff and dead-letter. pg_cron runs every 30 s, with a DB-side reaper every 5 minutes. | `src/lib/voice/runtime-core.ts:672`; `src/lib/jobs/handlers/quote-jobs.ts`, `invoice-jobs.ts` | — |

### 6. Billing

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | One-off invoice → stuck PAST_DUE; disputes don't reverse grants; no SCA/async handling; number not released (top-10 #7). | — | — |
| P1 | **B2B tax details are not collected.** No `tax_id_collection`, `billing_address_collection` or `customer_update` on any Checkout. This extends todo O7 (automatic_tax): UK B2B buyers need their VAT number on invoices. | `src/lib/billing/checkout.ts:123-159`; `voice-purchase.ts` | Add all three when turning on Stripe Tax. |
| P1 | Downgrade over limits is unhandled (top-10 #10). A subscription refund changes no access. | `plan-change.ts:154-186`; `subscription-sync.ts:81` | Pre-check and warn. |
| P1 | **Admin MRR uses list prices.** `monthlyPriceFor(plan, interval)` reads `plans.ts`, not Stripe amounts, so discounts, coupons and grandfathered prices are ignored. | `src/lib/admin/billing.ts:52-59, 94, 200, 230, 554`; `src/lib/admin/customers.ts:56` | Store `unit_amount` and discounts from the subscription on sync. Compute MRR from that. |
| P1 | Cancellation happens only through the Stripe portal. No in-app cancel or reason capture was found; cancel-at-period-end depends on dashboard settings. (Retention after cancel is in the todo automations batch.) | `checkout.ts:562-577` | Check the portal config (period-end, reason capture). Optional in-app cancel with a reason. |
| P2 | No `allow_promotion_codes`. A draft invoice's Stripe receipts depend on dashboard email settings. Top-up receipts only work when a Stripe customer already exists. | `checkout.ts:515`; `voice-purchase.ts:159` | Configure. Always create the customer first. |
| OK | Dunning for the base plan (30 days of retries, pause from day 3, read-only at the end). Refund reversal of unused credit for AI tokens, message credit and voice packs. Proration: upgrade `create_prorations`, downgrade scheduled at period end. The webhook is idempotent on `webhook_events`. | `dunning.ts`; `route.ts:545-590` | — |

### 7. Deliverability

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | Bounce mis-suppression and whole-mailbox health flip (top-10 #8). | — | — |
| P2 | Missing SPF/DMARC only **warns** for cold sending. DKIM is UNKNOWN (so it only warns) when no selector is configured. | `src/lib/outreach/campaigns/sender.ts:114-123`; `src/lib/email/dns-health.ts` | Block cold sending when DMARC or SPF is missing (Gmail/Yahoo bulk-sender rules). Prompt for the DKIM selector. |
| P2 | `Auto-Submitted: auto-generated` is set on cold and marketing mail. That is wrong for 1:1-style mail and may hurt placement. | `src/lib/email/smtp.ts:209` | Remove it for COLD. **Quick win.** |
| P2 | Complaint (ARF) handling only works where the mailbox receives FBL reports. Gmail sends none. | `src/lib/email/feedback-report.ts` | Document the limit. Gmail Postmaster is out of reach for customer domains. |
| OK | `List-Unsubscribe` plus `List-Unsubscribe-Post` one-click, and a body link on marketing and cold mail. The postal footer is required for cold. Daily caps are atomic in SQL with a warm-up ramp and provider-safe limits. The complaint-rate pause is at 0.3%. | `smtp.ts:199-208`; `sender-slots.ts`; `sender-health.ts:91,156-177` | — |

### 8. Integrations

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | Health is token-exists-only; refresh failures don't flip status; pre-fix Zoho tokens (top-10 #9). | — | — |
| P2 | The connector company is now attached (fixed: `src/lib/integrations/connector-company.ts`, `app-ingest.ts:38-80`), but only when the prospect has none, only to prospects (not leads), and as a non-atomic second step. | — | Accept for now. |
| OK | The **Zoho UPDATE scope is fixed** (`zoho-crm.ts:75-76`), and a 401 on update now throws instead of duplicating. The connection card has Last sync, error, Reconnect and Test. | — | — |
| Not audited | Retell, Calendly, Google Calendar and Stripe Connect refresh paths. | — | — |

### 9. Economics

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | `loadUnitCosts()` matches **no** `provider_price_book` row (product vs capability naming) and reads USD as pence. Find Leads always costs itself on hard-coded fallbacks. | `src/lib/find-leads/server/budget.ts:93`; `docs/economics.md` §6.5 item 4 | Fix the key mapping and FX conversion. Add a test with a USD row. |
| P1 | `saved_search` is unenforced; `sender_identity` (1/3/10) is capped only by connected mailboxes. | `v4-entitlements.ts:23,63`; `outreach/actions.ts:118-135` | Enforce both. |
| P2 | Enterprise's seeded 100k SMS / 100k WhatsApp allowances are tied to no price, and Enterprise has no `lead_processed` row. | `docs/economics.md` §6.5 item 6 | Seed per-contract values from admin, or zero plus an admin grant. |
| P2 | Unmetered costs: inbound SMS, Resend (capped per day, not costed), R2 storage including voice recordings up to 60 MB each, and Retell storage. They are not in `cost_events` or the voice cost ledger. | `src/lib/email/system-email-budget.ts`; `r2.ts:39` | Add daily cost rows from provider usage APIs, or a flat per-workspace allocation in the economics dashboard. |
| P2 | Admin MRR from list price (see §6). | — | — |

### 10. Accessibility, i18n and timezones

These were not deep-audited; the accessibility audit is already a todo §6 item. Spot checks:

- Number formatting uses `en-GB` explicitly. `src/lib/dates.ts` has timezone-aware helpers.
- 280 `toLocale*String(` calls without an explicit `timeZone` exist under `src/app` and `src/components`. Most are numbers, but any date among them renders in UTC on Vercel, not in the workspace or user's timezone. **P2**: grep for `toLocale(Date|Time)String` in server components and route them through `lib/dates.ts`.

### 11. Data quality

| Sev | Finding | Evidence |
|---|---|---|
| OK | Phone numbers are normalised to E.164 on ingest (`src/lib/ingest/normalise.ts:41,162`). Reversible merges exist (`src/lib/identity/merge.ts`), plus admin merge-candidate actions. Leads have bulk actions (`src/lib/leads/bulk-actions.ts`). Prospect dedupe is `src/lib/prospects/dedupe.ts`. There is one ingest path (final report Part D). | — |
| Not audited | Per-row CSV import error reporting and download; the customer-facing merge UI. | `src/lib/imports/*` |

### 12. Admin and support tooling

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P2 | **There is no impersonation or view-as.** Support must reason from admin screens. | grep: none | Add a read-only view-as with an audit row and a banner. A deliberate omission is acceptable at launch. |
| P2 | There is no dedicated audit-log viewer route. Audit shows per surface only (Site history, job drawer, support). | `src/app/admin/(ops)/*` | Add Admin → System → Audit, with filters on actor, workspace and action. |
| P2 | There is no admin refund button; refunds are done in the Stripe dashboard (the webhook then reverses credit correctly). | `src/lib/admin/billing-actions.ts` | Acceptable. Document it in the support runbook. |
| OK | Present: `applyAccountCredit` / `reverseCredit`, `grantEntitlement`, `extendTrial`, `changePlan`, `cancelAtPeriodEnd`, feature flags (`updateFeatureFlag`), AI kill switch, ticket internal notes, and job retry/cancel/dead-letter. All go through step-up. | — | — |

### 13. Docs and help

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P2 | There are no articles for experiments (A/B promote and rollback) or for what the maintenance banners mean for customers. | `content/help/` | Write them. |
| P2 | `connecting-pipedrive.md` and `connecting-pipedrive-and-other-crms.md` duplicate each other. `managing-bookings.md` is linked from 3 articles and needs checking against the current IA (bookings live on Dashboard). | `content/help/integrations/`, `booking-and-sales/` | Merge, and re-check the wording. |
| P2 | `docs/CRON.md` overstates throughput; CLAUDE.md is out of date on the IA. | — | Correct both. |
| OK | The help overage and "unlimited" wording is consistent with no-overage. "Unlimited" appears only for follow-up email from the customer's own mailbox and a LinkedIn Premium row. Voice prices in help match the todo (£100, £11.99, £49/£115/£225/£449). The stale `content.generated.ts` is already known (final report Part C). | — | — |

### 14. Tests

| Sev | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | **Group chaining.** `test` is three `node --test` groups joined with `&&` (203, 9 and 7 files). A failure in group 1 silently skips groups 2 and 3, which hold the SSRF, MCP, imports, voice-adapter, email, token-budget and maintenance-runtime suites. | `package.json` `scripts.test` | Add `scripts/run-tests.mjs`: `spawnSync` each group with `stdio: inherit`, collect the exit codes, print a per-group summary, and `process.exit(1)` if any failed. Make `test` call it, and keep the file lists in a JSON manifest so nobody hand-edits the quoted list again. (`npm-run-all --continue-on-error test:g1 test:g2 test:g3` also works but adds a dependency.) |
| OK | Registration is clean. All 219 unit files on disk are registered, each as its own quoted argument, and every path exists. The 8 unregistered files are env-gated (`test:rls*`, `test:e2e:*`). | parsed | — |
| P2 | `tests/stories/revenue-stories.test.ts` is in no script. | — | Add a `test:stories` script. |
| P1 | These paths have no dedicated test (by filename): the Stripe billing webhook route and dunning transitions (including the one-off invoice case above), the Retell and Twilio voice webhook routes, API v1 scope enforcement, the Meta data-deletion webhook, and the reaper `max_attempts` behaviour. RLS proofs for the new tables run only via the env-gated `test:rls:new`. | `tests/` listing | Add unit tests alongside each fix batch below. |

---

## Quick wins (< 1 hour each)

1. `scripts/run-tests.mjs` group runner, with `package.json` `test` pointing at it.
2. Data-deletion page: `privacy@clientturn.co.uk` → the monitored address.
3. Remove `Auto-Submitted: auto-generated` from COLD email (`smtp.ts:209`).
4. Add `object-src 'none'; base-uri 'self'; form-action 'self'` to the CSP in `next.config.ts`.
5. `assertEntitlement` on `/app/analytics/page.tsx`.
6. Derive the `health.ts` QUEUES list from the job registry.
7. Correct the `docs/CRON.md` throughput figure. Move `startedAt` after the scheduler enqueues in the worker.
8. New migration: `reap_stalled_jobs` marks `dead` when `attempts >= max_attempts`.
9. `dunning.ts`: only set PAST_DUE for subscription invoices.
10. Root `global-error.tsx` and `not-found.tsx`, plus `error.tsx` for `/onboarding` and `/start-trial`.
11. Delete the dead `/app/bookings` helpers.
12. Add a `test:stories` script.
13. Cron secret: `timingSafeEqual`.
14. Drop `image/svg+xml` from the logo allow-list (or sanitise it).
15. Fail closed for the `auth:*` and `admin:*` rate-limit buckets.

---

## Proposed batches (disjoint files)

Three agents are editing now:

- **Voice P3** owns `src/lib/voice/*`, `src/lib/agent/*`, `src/lib/jobs/handlers/voice.ts` and hot registry files.
- **Marketing design pass** owns `src/components/marketing/*` and the `(marketing)` pages, **including the legal pages**.
- **Automations/pipeline/retention** owns the automation, data-rights and retention code.

The batches below avoid them. Where a hot file is unavoidable (`package.json`, `jobs/registry.ts`), the batch says so and the coordinator merges it.

### Batch 1 — Ops, reliability and tests (one agent, starts now)

- **Files:**
  - `src/app/api/cron/worker/route.ts`, `src/app/api/cron/daily/route.ts` (already modified in the working tree, so re-read first)
  - new migration `0163_reaper_max_attempts_and_priorities.sql`
  - `src/lib/jobs/queue.ts` (priority defaults for `voice.webhook_ingest`, `voice.dial` and `payment.confirm`: coordinate with voice P3)
  - `src/lib/admin/health.ts`
  - new `src/lib/ops/alerts.ts`
  - `instrumentation.ts`, `src/app/global-error.tsx`, `src/app/not-found.tsx`, `src/app/onboarding/error.tsx`, `src/app/start-trial/error.tsx`
  - `next.config.ts`
  - `scripts/run-tests.mjs`, `package.json` (test script only; coordinator merges)
  - `docs/CRON.md`, `docs/OBSERVABILITY.md`, new `docs/RESTORE.md`
- **Delivers:**
  - top-10 #5 and #6
  - quick wins 1, 4, 6, 7, 8, 10, 12, 13
  - a reaper test and a group-runner test
- **Owner input:** Sentry DSN (or log drain choice); alert email address; PITR confirmation.

### Batch 2 — Billing and entitlements (one agent, starts now)

- **Files:**
  - `src/lib/billing/dunning.ts`, `src/lib/billing/plan-change.ts`, `src/lib/billing/checkout.ts`, `src/lib/billing/subscription-sync.ts`, `src/lib/billing/v4-entitlements.ts`, `src/lib/billing/entitlements.ts`
  - `src/app/api/webhooks/stripe/route.ts` (modified in the working tree, so re-read)
  - `src/lib/admin/billing.ts`, `src/lib/admin/customers.ts`
  - `src/lib/find-leads/server/budget.ts`, `src/lib/find-leads/actions.ts` (the saved_search count only)
  - `src/lib/outreach/actions.ts` (sender cap)
  - `src/app/(app)/app/analytics/page.tsx` (modified in the working tree, so re-read)
  - new `tests/stripe-webhook-dunning.test.ts`, `tests/entitlement-holes.test.ts`
- **Delivers:**
  - top-10 #7 and #10
  - §6 tax ID and billing address (with the O7 switch)
  - MRR from Stripe amounts
  - the `loadUnitCosts` fix
  - quick wins 5 and 9
- **Not included:** the Twilio number release job (it touches `src/lib/voice/*`). Hand it to voice P3 or run it after P3 lands.

### Batch 3 — Messaging, integrations, security and RLS proofs (one agent, starts now)

- **Files:**
  - `src/lib/email/account.ts`, `src/lib/email/store.ts`, `src/lib/email/smtp.ts`, `src/lib/jobs/handlers/email-poll.ts`, `src/lib/outreach/campaigns/sender.ts`
  - `src/lib/integrations/oauth.ts`, `src/lib/jobs/handlers/integration-health.ts`, `src/lib/integrations/providers/zoho-crm.ts`
  - `src/lib/security/rate-limit.ts`, `src/lib/storage/r2.ts`, `src/app/api/platform/banners/dismiss/route.ts`, `src/app/api/search/route.ts`, `src/app/api/exports/*`
  - new `supabase/tests/0143-0162-rls-proof.sql`
  - `src/lib/bookings/types.ts`, `src/lib/bookings/actions.ts` (dead code)
  - new tests for bounce classification and OAuth `invalid_grant`
- **Delivers:**
  - top-10 #8 and #9
  - §4 RLS proofs, run against a branch database (not production)
  - quick wins 3, 11, 14, 15
  - §3 per-user limits

#### Batch 3 status (done 2026-09-28)

- **Bounces** (`email/bounce.ts`, `email/send-outcome.ts`):
  - A recipient-level refusal (5.1.x, 5.2.1, RCPT refusal) suppresses that address, and mailbox health is not touched. Only a mailbox-level failure changes mailbox health: auth, TLS, host, or 5.7.x policy (DEGRADED).
  - Cold sends no longer mark prospects BOUNCED for a mailbox fault.
  - The NDR parser reads `message/delivery-status` and `X-Failed-Recipients`. It never falls back to the report's sender, never names mailer-daemon, postmaster or the mailbox's own address, and suppresses nothing when it is ambiguous or the bounce is soft.
  - ARF complaints and RFC 8058 one-click were already present. `Auto-Submitted` was removed (quick win 3).
- **OAuth** (`integrations/oauth-health.ts`):
  - `invalid_grant` and other dead-grant refusals set ACTION_REQUIRED `reconnect_required`, with one notification and an app-wide Reconnect banner.
  - Zoho's HTTP 200 error body is treated as a failure.
  - The health job makes real authenticated GETs for Google Calendar, Calendly, HubSpot, Zoho, Salesforce and Meta.
  - Zoho connections without the UPDATE scope, or getting a 401/403 on update, are prompted to reconnect (`scope_outdated`).
- **Security:**
  - The limiter fails closed for `auth:*` and `admin:signin/stepup`.
  - SVG logos are refused, and old SVG keys download as attachments.
  - Banner dismiss requires Origin or Referer.
  - `app:search` is limited to 60/min per user and `app:export` to 10 per 10 min per user. The attribution export is capped at 5,000 rows.
  - The dead `/app/bookings` helpers are deleted.
- **RLS:** `supabase/tests/0143-0167-rls-proof.sql` was run live and rolled back. It found write grants for `authenticated` on `affiliate_tiers` and `affiliate_tier_history`, fixed by `0168` (not applied). It also found that **0148 is not applied** on production.

### Batch 4 — Legal, policy and help (after the marketing design pass lands; needs owner and lawyer input)

- **Files:**
  - `src/app/(marketing)/{privacy,terms,cookies,sub-processors,compliance,data-deletion,privacy-request}/page.tsx`
  - `src/lib/marketing/company.ts`, `src/lib/marketing/subprocessors.ts`
  - new `src/app/(marketing)/dpa/page.tsx`
  - `content/help/**` (experiments and maintenance articles, the Pipedrive merge, bookings wording)
  - CLAUDE.md IA note (owner decision)
- **Delivers:** top-10 #1–#4, all of §2, quick win 2, §13.
- **Owner inputs, in order:**
  1. The Retell DPA and region.
  2. Which enrichment providers are live in production.
  3. The merchant-of-record model for customer payments.
  4. ICO and VAT numbers.
  5. Whether ClientTurn is named on the call (it should match OD-1 as amended 2026-09-28).
  6. Legal sign-off on the new text, and the 30-day change notice to existing workspaces.

**Order:** batches 1, 2 and 3 can start in parallel now; their file sets are disjoint. Batch 4 starts when the marketing pass is merged, and **must finish before the first live voice call or live quote** (the launch gate in todo §6).
