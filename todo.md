# ClientTurn — pre-launch to-do

Tick each box when it is done. Sections are in the order they unblock each other.
Evidence: `docs/revenue-engine/06-coverage-tracker.md`, `docs/revenue-engine/11-final-report.md`,
`docs/revenue-engine/12-voice-quote-to-cash-gap-map.md`, `docs/economics.md`, `docs/VOICE.md`, `docs/MAINTENANCE.md`.

_Last updated: 2026-09-28._

---

## 1. Urgent — owner (the live app needs these)

- [ ] **Fix the Twilio auth token.** Twilio Console → the account that owns the ClientTurn number → Account → API keys & tokens → copy the **Auth Token** → set `TWILIO_AUTH_TOKEN` in Vercel (Production) and `.env`. Today every inbound SMS, delivery update and STOP gets **403**. Voice webhooks use the same signature, so voice is blocked on this too. `TWILIO_ACCOUNT_SID` must be the `AC…` account SID.
- [ ] **Redeploy** once the token is fixed (ships everything below). Migration **0148 (WhatsApp tokens)** must be applied in the same deploy — Claude does this on your go-ahead.
- [ ] **Re-run the owner SMS test** after deploy: reply → AI answers → text **STOP** → confirm the opt-out → text **START**. Then ask Claude to delete the test workspace `ZZ-OWNER-SMS-TEST 2026-09-27` (zero-rows proof).

## 2. Accounts, keys and settings — owner

- [ ] **Stripe TEST prices** for Starter / Growth / Pro (monthly + annual) → every `STRIPE_PRICE_*` in `.env.local` and Vercel (current ids are not TEST prices).
- [ ] **Stripe TEST voice prices:** Pro voice add-on £100/mo, number £11.99/mo, packs £49 / £115 / £225 / £449 (one-off) → `STRIPE_PRICE_VOICE_*` (names in `.env.example`).
- [ ] **Stripe Terms of Service URL** on the Stripe account (top-up terms tick-box).
- [ ] **VAT:** register for Stripe Tax (Claude then switches on `automatic_tax`) or make prices VAT-inclusive. The site says VAT is added at checkout and it isn't yet. (O7)
- [x] **Companies House API key** — verified live 2026-09-28. **Add `COMPANIES_HOUSE_API_KEY` to Vercel.**
- [x] **Retell key** — `RETELL_SECRET_KEY` verified live 2026-09-28. **Add it to Vercel.**
- [ ] **Retell setup:** run `scripts/retell-setup.mjs` (or ask Claude to run it — free, places no calls) → set `RETELL_AGENT_ID`, `RETELL_SIP_DOMAIN`; set `VOICE_WEBHOOK_BASE_URL` (public https origin) and `VOICE_BUNDLE_NOTIFICATION_EMAIL`.
- [ ] `CREDENTIAL_ENCRYPTION_KEY` set in Vercel (seals payment-webhook and Twilio sub-account secrets).
- [ ] **Google sign-in:** register the redirect URIs (`http://localhost:3000/api/auth/google/callback`, `https://clientturn.com/…`, `https://www.clientturn.com/…`, `https://clientturn.vercel.app/…`) and set `NEXT_PUBLIC_SITE_URL`, `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET` in Vercel. (O2)
- [ ] **Authorise the Stripe and Cloudflare MCP connectors** (claude.ai connector settings or `/mcp`) so Claude can check Stripe/R2 live. (O4)
- [ ] `META_WHATSAPP_CONFIG_ID` if WhatsApp (direct) Embedded Signup will be offered. (O6)
- [ ] **Vercel Pro** before taking paying customers (Hobby is non-commercial only). (O8)

## 3. Decisions / checks — owner

- [x] **Call opener approved by owner** (2026-09-28, no lawyer check): AI disclosure + who + why + "is now OK" + recording notice. ClientTurn named at the **end** of every call ("…you've been speaking with {business}'s AI assistant, powered by ClientTurn"), removable only with white-label.
- [ ] **Read `/compliance`** before launch.
- [ ] **Agent replies during quiet hours** — approved by you but blocked by the permission classifier as weakening a safeguard. Add a permission rule or apply the patch yourself.
- [ ] **Existing customers** — tell any existing Growth/Pro customers about the new limits (0138 is live).
- [ ] _Optional:_ voice prices under premium cards + 21% cost stress sit at 73.7–74.9% for the 250/500/1,000 packs and the £100 Pro item. Prices that clear it: £116 / £231 / £460 / £107. Kept as-is (standard cards clear 75%).

## 4. Built (2026-09-27/28) — all migrations applied and verified live except 0148

- [x] AI-first hand-over, honest "are you a bot?", two-step discount rule.
- [x] Trial upgrade pop-up (instant trial → paid), no overage, top-ups prepaid and non-refundable once used, no top-ups in trial.
- [x] Direct-sale loop: tracked checkout links, payment webhooks, auto-Won with amount, thank-you, abandoned-checkout nudges (0143).
- [x] Leads with several interests, one deal each (0144).
- [x] Admin economics dashboard with below-75% alerts (0145).
- [x] Re-engagement: triggers, frequency caps, dead-lead stop, cheapest channel, best send time, A/B tests (0146).
- [x] Sales craft: human style, objection library + your own objections, closes per goal, call requests booked (0147).
- [x] WhatsApp tokens: 2p/token, packs £20/£40/£100 (0148 — **applies with the deploy**).
- [x] Upsells + subscriber welcome email (0149).
- [x] ~40 buying-intent signals with lawful free sources + AND/OR segments; 12 new signals in lead context (0155).
- [x] UK compliance page + outreach guides.
- [x] Stabilisation: live stories 66/66 (run 7ef2a8d4).
- [x] Voice + quote database, 39 tables, security proof 85/85 on live (0150–0154).
- [x] Quote-to-cash: catalogue, calculator, discount policy, lifecycle, approvals, public quote page + signing + PDF, invoices, capabilities (quotes/e-sign/invoices on every paid plan) (0156).
- [x] AI quote tools, "What the AI may do" permissions (all off except qualify + book), quote follow-up, one-actor-per-lead locks (0160).
- [x] Voice P1 + P2: eligibility, number blocks, calling hours + bank holidays, locked opener, paid-only, dial job with locks/concurrency/minutes, webhooks, post-call into qualification, recordings, automatic numbers, Settings → Voice, Call with AI, call cards, return calls, admin pause/limit/suspend, billing (Pro voice item, packs, number) (0157, 0159).
- [x] Insight + ops: revenue journey attribution, quote + voice analytics, ROI card (real data only), experiments promote/rollback, admin Voice ops + GM monitoring, redacting logger (0158).
- [x] Admin: maintenance mode (read-only / app offline / site offline, scheduled + auto-end) and banners (0161).
- [x] Marketing: voice, quote-to-cash and revenue journey sections; pricing (Pro £499 with voice / £399 without, packs, number); compliance voice section; "Unlimited" and "Most popular" removed; Retell in sub-processors.
- [x] "Booking agent" → **Closing agent** (2026-09-28): chases each qualified lead to its own goal (meeting booked, product/service bought, subscription or trial started; per interest), skips leads a checkout link or quote is already chasing; labels, tour and help updated; stale help about agents finding phone numbers removed. Stored type stays `BOOKING`.
- [x] `tests/plan-margins.test.ts` updated (no overage, WhatsApp tokens, voice margins) — 43/43.

## 5. Build — Claude (in progress / queued)

- [ ] **Voice P3 (running):** the call's sales brain (Retell-hosted model + tools into ClientTurn), time limits in-call, voicemail, voice in next-best-action, AI "call"/"transfer" permissions, calls paused in maintenance, Pro checkout adds the voice item, 20 simulated call scenarios, voice section of `economics.md`, `scripts/retell-setup.mjs`.
- [x] **Voice QA + objection matrix (2026-09-28):** 18 spoken trigger types (90 noisy UK test phrases) mapped to actions; "take me off your list" now opts out everywhere; wrong numbers never re-rung; new "send me something" tool (0167 applied); tool failure → apology + text follow-up; no dead air after tools; 46 call scenarios all 100; objection matrix 54/120 → **120/120 cells ≥90** (mean 99.6) by fixing the library (goal-matched next steps, new angle on repeats, honest bot answer). Provisional voice: Cartesia "Willa" (British female), "Anthony" as male alternative. **Owner:** listen to both on the test call. ElevenLabs as the standard voice would need packs ~+18% (1,000 min £449 → £528); kept as the +20p/min premium option instead.
- [ ] ~~Objection matrix~~ (done above): ~120 key cells (objection type × channel SMS/email/WhatsApp/voice × goal meeting/sale/trial/quote × first/repeat). Claude generates and grades (no Azure cost, uses Claude plan), improves the library/closes/voice scripts until every cell grades ≥90. Then **optional** final Azure confirmation run (~120 replies, <£1) only with your OK.
- [ ] **Voice QA + conversion pass (after P3, owner 2026-09-28):** trigger phrase detection on speech (opt-out, wrong number, "is this a robot?", call me later, human please, voicemail/IVR), accents and speech-to-text errors, every route and flow, objection and closing libraries adapted for voice, human-sounding British voice chosen against cost, latency/interruption/backchannel settings, 40+ simulated scenarios scored, enterprise checks (audit, compliance, locks, failure recovery).
- [ ] **Public site design pass (running):** voice visual as a real call (compact, waveform, live captions), ~30–40% less text in every section, card padding fix on every public page.
- [x] **Automations + pipeline + data retention (0162/0163 applied 2026-09-28):** Follow-Up → Automations tab (voice/quote/payment/usage triggers; call, message, booking link, quote, approval, signature, invoice, payment link, hand-over, stage, tag, rescore, nurture, notify team — each checked against permissions, plan, maintenance and the enabling admin's role; skipped steps say why), pipeline stage mapping (Settings → AI & selling), quote/invoice data-rights coverage, daily recording/transcript retention with R2 clean-up, Contracts Finder tenders, renewal/headcount/tech columns in imports. Note: a rule that sends a message never sends after the lead replied, booked or was taken over (the AI handles replies).
- [ ] ~~Automations + pipeline + data retention~~ (done above): voice/quote automation triggers and actions (§45), pipeline stage mapping (§46), data-rights coverage for quote/invoice tables, recording/transcript retention job, Contracts Finder tenders, CRM/list import columns for renewal + headcount signals.
- [ ] **Channels:** "LinkedIn Assist" (decided 2026-09-28: no automation, no extension, no scraping — a daily task list of AI-written connection notes / follow-ups / InMails, one tap to open the profile + copy + mark sent, mobile-friendly, account-safe pacing well under LinkedIn's limits, "Log reply" paste → AI drafts the answer, follow-ups scheduled as tasks, move the conversation to email/SMS/call when the lead allows; marketed as "assisted by design, your account stays safe"; Lead Gen Forms stay fully automated), Instagram + Messenger (automated in Meta's 24h window), TikTok messaging (check API), multi-channel routes.
- [ ] **Commercial rules:** SLAs, guarantees, cancellation/payment terms, approved claims, competitor positioning, best-fit recommendation across the catalogue, agents targeting one product or the whole catalogue.
- [ ] **`docs/economics.md`** rebuilt as the full unit-economics model (tiers, voice, WhatsApp, scenarios, sensitivity, capacity, competitors, working capital) (§68–69).

### System gap audit (2026-09-28) — `docs/revenue-engine/15-system-gap-audit.md`

- [ ] **Batch 1 — ops/reliability/tests (running):** Sentry error tracking, pushed alerts (dead jobs, webhook failures, cron misses, provider outages, voice margin), queue priorities + reaper that dead-letters, faster worker, test runner that always runs all 3 groups, security headers, restore runbook + PITR check.
- [ ] **Batch 2 — billing/entitlements (next):** failed one-off payment stuck in past-due, disputes claw back tokens/minutes, 3-D Secure / delayed payments, release the number after cancel, downgrade while over limits, saved-search limit, lead cap on every create path, analytics page gated server-side for trials, admin MRR from real Stripe amounts, Find Leads `loadUnitCosts` (USD read as pence), Enterprise allowances priced.
- [ ] **Batch 3 — messaging/integrations/security (next):** bounces suppressed per recipient (not the whole mailbox), mailer-daemon parser fix, OAuth failures → "Reconnect", real provider health checks, Zoho reconnect prompt, sign-in rate limit fails closed, no SVG logos, banner-dismiss origin check, search/export limits, RLS proof tests for 0143–0149 and 0155–0162.
- Decided 2026-09-28: **no paid enrichment** (Apollo/Hunter/Clearbit off in production); **customer payments via the customer's own Stripe** (they are merchant of record); **keep the current app menu** (CLAUDE.md updated).
- [ ] **Owner for batch 4:** accept Retell's DPA in the Retell dashboard and tell Claude the data region; your ICO registration number and VAT number (if registered).
- [ ] **Batch 4 — legal/help (before the first live call or quote):** privacy policy + terms for AI calls, recordings/transcripts + retention, e-signature, quotes/invoicing and taking payment for customers, sub-processors (Retell + any enrichment providers actually live), new legal version + 30-day sub-processor notice, `/dpa` page, help updates.

### Owner requests 2026-09-28

- [x] Batch 1 ops (0164 applied; live worker verified processing after the change): Sentry (needs `SENTRY_DSN`), pushed alerts (needs `OPS_ALERT_EMAIL`), heartbeat `/api/cron/heartbeat` for an external uptime monitor, job lanes + reaper dead-letter, worker ~4× faster, test runner always runs all groups, security headers, `docs/RESTORE.md`. **Owner: PITR is OFF (daily backups only, up to 24 h loss) — enabling it is $100/mo; check R2 versioning in Cloudflare.**
- [x] **SDR cost-savings calculator** — `/sdr-cost-calculator` (Resources menu + footer): 2026/27 NI and pension from gov.uk, ONS sick days, holiday, recruitment, ramp-up, tools, management; voice packs on any plan with "Match my SDR's calls" (cheapest pack mix); same conversion rates both sides; shareable URL, copy results; checked at desktop, tablet, phone portrait/landscape and 200% zoom. Original brief: ClientTurn plans vs a fully-loaded UK SDR (salary, employer NI, pension, holiday, sick days, recruitment, ramp, tools, management), 60 calls/day, conversion inputs, monthly/yearly savings, shareable link.
- [x] **Billing batch 2 (0165 applied 2026-09-28):** one-off payment failures never block the account; add-ons follow subscription grace; 3-D Secure + delayed payments handled; disputes claw back only unused tokens/minutes and restore on a win; cancellation = 90 days read-only then deletion, number released after 14 days; downgrades allowed but adding over-limit items refused (with a "what to reduce" list); lead cap on every creation path (API answers 403 PLAN_LIMIT); saved searches, senders, intent monitors and trial analytics enforced; Find Leads cost bug fixed; admin MRR from real Stripe amounts; Apollo/Hunter/Clearbit off unless `ENABLE_PAID_ENRICHMENT`; `STRIPE_AUTOMATIC_TAX` flag ready. See `docs/BILLING.md`.
  - [ ] Build the day-90 workspace deletion job after cancellation.
  - [ ] **Owner:** in the Stripe dashboard turn Smart Retries off (ClientTurn retries itself for 30 days).
- [x] **Affiliate / partner audit + fixes (0166 applied 2026-09-28)** — 8 money bugs fixed (commission was paid on VAT; annual customers earned for 12 years; partial refunds wrong; refunds/disputes never reversed on current Stripe; won disputes now restore; flagged referrals no longer paid; retry could double-pay; payouts now need admin approval), IP hashing + purge, click limits, bot filtering, self-referral screening + fraud queue, tiers (daily recalculation, history, admin lock), admin export, partner tier panel, new `/affiliates/terms` (draft). Full table: `docs/revenue-engine/17-affiliate-audit.md`.
  - Decided (Claude, 2026-09-28): referral cookie set **only after cookie consent** and listed in the Cookie Policy (ICO: affiliate tracking needs consent); without consent, attribution by promo code or the signup link in the same visit. Negative balance at the end of a partnership is **written off**. No self-billing at launch: VAT-registered partners send us an invoice. Promo codes become real Stripe promotion codes. → to build next.
  - Owner decision 2026-09-28: **commission paid ONCE per referred customer** — tier rate × the referred customer's first paid invoice — for annual plans the FULL annual payment (owner correction) — held for the refund window; renewals/add-ons earn nothing. Marketing, terms, portal, admin and help updated to match (in progress).
  - Owner decision 2026-09-28: no annual cap. Affiliate commission is treated as a marketing (acquisition) cost, not part of gross margin: annual year-one margin is 78–82% at typical use, 65–71% at max use at 6–10% (paid once, cash-positive because annual is paid upfront).
  - Owner decision 2026-09-28: rates **6–10%**: Partner 6% → Pro Partner 8% (5 paid referrals in 12 months) → Elite Partner 10% (15 paid referrals). Public, legal, portal, admin and help updated to match (in progress).
  - [ ] **Owner:** approve the affiliate terms wording (then remove the draft banner + noindex).
- [x] **Owner — disk space:** freed 2026-09-28, 17 GB free. Was: C: had 30 MB free (builds crashing). Claude cleared 12.6 GB of ClientTurn build cache; only 3.4 GB free now. Empty the Recycle Bin, clear other projects' `.next` folders (e.g. Gigvora), run Disk Cleanup.
- [ ] **Full UI sweep + fixes (running):** every app section and component — back buttons, dead/unwired buttons, duplicates, phone sizes portrait + landscape, zoom 200%, warping, friendly error states instead of raw red errors (still logged to Sentry), customer-satisfaction polish.
- [ ] **Affiliate / partner audit + fixes (next):** dashboards, Stripe Connect payouts, click/IP fraud checks, click → signup → sale attribution, tier tracking and tier changes, any other gaps.
- [ ] **Deploy for the owner to try** once the running agents finish and all checks are green.

### Enterprise readiness (owner 2026-09-28: do it all; Enterprise stays "Contact sales")

- [ ] Audit log export (CSV/JSON, date range, admin/owner only) and finer role permissions for large teams.
- [ ] Security pack: security questionnaire answers, data-flow diagram, customer DPA (`/dpa`), uptime commitment (status page + stated target), sub-processor list current.
- [ ] Backups: confirm Supabase PITR, run a real restore drill into a scratch project, record the result (runbook from batch 1).
- [ ] Internal security review (OWASP pass, auth, RLS, webhooks, uploads). **External penetration test = owner to commission** (Claude can prepare the scope document).
- [ ] Help screenshots: capture the 55+ skipped/flagged ones.

### Real-world proof (owner 2026-09-28)

- [x] Env: `TWILIO_AUTH_TOKEN` (working one from `.env.local`), `COMPANIES_HOUSE_API_KEY`, `RETELL_SECRET_KEY` pushed to Vercel production. Stripe TEST prices set everywhere: plans (£99/£199/£399, annual 15% off) + voice (add-on £100, number £11.99, packs £49/£115/£225/£449) — `.env.local` and Vercel. (Only sensitive values that differ can't be compared automatically; nothing else was overwritten. `.env` still holds the old dead Twilio token — harmless, `.env.local` wins.)
- [ ] Commit (branch, logical chunks) → all checks green → merge + deploy → apply 0148 in the same deploy.
- [ ] Real test call to the owner's phone **07591079608** (approved 2026-09-28): after deploy, run `scripts/retell-setup.mjs --apply`, import the number into Retell, then ≤3 calls / ≤10 minutes total (~£1).
- [ ] Real quote → sign → pay on Stripe TEST end to end (test card), then refund/cleanup.
- [ ] Qualification engine live review: needs real traffic (after launch).
- [ ] Live AI wording: Claude-graded objection matrix (running) + optional small Azure confirmation run with your OK.
- [ ] Owner: an unconfirmed Supabase auth user for jamahl1996@gmail.com was created by a login-link test (2026-09-28 01:02 UTC). Keep or delete?

## 6. Verify before launch — Claude

- [ ] Full `npm test` (all three groups), `npx tsc --noEmit`, `npm run lint`, `npm run build` — all green.
- [ ] Live business stories (08:02–19:30 UK) including the quote journey: all pass, zero rows left.
- [ ] Accessibility audit (keyboard, contrast, screen reader) on the main app screens and marketing site.
- [ ] Performance and concurrency QA.
- [ ] Retake help screenshots flagged in `content/help/SCREENSHOTS.md`.
- [ ] After deploy: `intent.sweep` every 6 h and every new job type completes with no dead jobs (`docs/CRON.md`).
- [ ] Final delivery report with a release-readiness score (`docs/revenue-engine/11-final-report.md`, brief §76).
- [ ] **Launch gate:** voice and quotes work end to end on real accounts (Retell + Twilio live, Stripe prices, one capped test call to your phone with your OK) before the site goes public.

## 7. After launch (needs real traffic)

- [ ] Review the qualification engine's shadow decisions on a real workspace, then set `QI_RELEASE_GATES_PASSED = true`.
- [ ] Build the `EVAL_LIVE` runner (costs AI tokens — only with your OK).
- [ ] Harness for the full Find Leads sourcing run (story F3).
- [ ] Before paid enrichment: `provider_price_book` + prospect spend cap. (O10)

## 8. Release

- [ ] Commit (nothing committed yet — waiting for your go-ahead) and deploy.
- [ ] Final sign-off in the final report.
