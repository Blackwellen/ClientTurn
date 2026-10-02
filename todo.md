# ClientTurn — pre-launch to-do

Tick each box when it is done. Sections are in the order they unblock each other.
Evidence: `docs/revenue-engine/06-coverage-tracker.md`, `docs/revenue-engine/11-final-report.md`,
`docs/revenue-engine/12-voice-quote-to-cash-gap-map.md`, `docs/economics.md`, `docs/VOICE.md`, `docs/MAINTENANCE.md`.

_Last updated: 2026-10-02._

---

## 1. Urgent — owner (the live app needs these)

- [x] **Twilio auth token** — the working token from `.env.local` pushed to Vercel production (2026-09-28). `.env` still holds the dead one (harmless, `.env.local` wins).
- [x] **Redeployed** 2026-09-28 (commits 2d7eea8…9f123c0 on `main`, commit author blackwellen1996@gmail.com); migrations 0143–0170 incl. 0148 applied and verified live.
- [ ] **Re-run the owner SMS test** after deploy: reply → AI answers → text **STOP** → confirm the opt-out → text **START**. Then ask Claude to delete the test workspace `ZZ-OWNER-SMS-TEST 2026-09-27` (zero-rows proof).

- [ ] **Push the surface-QA work** (commit e730c23 and later, 2026-09-30/10-02). Production SMS and WhatsApp template sync fail (Twilio 70051 / 401) until it is deployed; the voice answer/booking/call-back fixes only run in calls after it.
- [ ] **Reconnect** in your workspace (Settings → Connections): **Meta** (token invalidated by a Facebook password change/security reset, though the card showed Healthy), **Google Calendar** and **Google Ads** (both refused by Google: `invalid_grant`). Salesforce, Zoho and Calendly were recovered by the new refresh code on 2026-10-02.
- [ ] **Google Cloud OAuth consent screen → "In production".** Google Ads died ~7 days after connecting, which is what "Testing" mode does to refresh tokens; until it's published, every Google reconnect lasts a week.
- [ ] **Real AI test call** after the push: say "add the voice grant" (24 h grant via `scripts/owner-voice-test-call.mjs`), answer on +447591079608 within calling hours (Mon–Fri 09:00–20:00, Sat 10:00–16:00), play the lead, pick a time, ask for a 6pm call-back. Claude checks the result and removes the grant.

## 2. Accounts, keys and settings — owner

- [x] **Stripe TEST prices** for Starter / Growth / Pro (monthly + annual) set in `.env.local` and Vercel (2026-09-28). **LIVE prices still needed at launch.**
- [x] **Stripe TEST voice prices** (add-on £100/mo, number £11.99/mo, packs £49 / £115 / £225 / £449) created with lookup keys and set (2026-09-28).
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
- [ ] **R2 storage:** `R2_ENDPOINT`, `R2_BUCKET=clientturn`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` for the `clientturn` bucket (an Object Read & Write token) in `.env.local` and Vercel. The local keys can't see `clientturn` or `leadrecover`, so logo uploads, CSV imports and support attachments fail. Check Admin → System → Readiness → File storage after deploy. Also add CORS for the app origins.
- [ ] **Calendly developer console:** add scopes `users:read`, `event_types:read`, `scheduled_events:read`, `webhooks:write` to the ClientTurn OAuth app, then reconnect Calendly. Until then the AI can't read event types or availability ("Insufficient scope"). Then pick the meeting type and switch booking from human handover to Calendly.
- [ ] **Stripe LIVE webhook** (ClientTurn's own endpoint, at launch) must subscribe to: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created/updated/deleted/trial_will_end`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`. TEST endpoint done 2026-10-02.
- [ ] **Stripe TEST account branding** shows "Propvora" at checkout and on Connect onboarding; live checkout must use ClientTurn's own Stripe account.
- [ ] `NEXT_PUBLIC_SITE_URL` in `.env.local` is `http://localhost:3000`; dev servers on other ports get Stripe and Supabase links back to :3000.

## 3. Decisions / checks — owner

- [x] **Call opener approved by owner** (2026-09-28, no lawyer check): AI disclosure + who + why + "is now OK" + recording notice. ClientTurn named at the **end** of every call ("…you've been speaking with {business}'s AI assistant, powered by ClientTurn"), removable only with white-label.
- [ ] **Read `/compliance`** before launch.
- [ ] **Automatic AI calling (no approval step):** your decision 2026-09-30, refused by the permission classifier as removing a safeguard. Either set it yourself (Settings → AI & selling → Phone leads on; each agent → Settings → approval "Run automatically" + "Phone leads with AI" on) or add a permission rule so Claude can.
- [ ] **Demo workspace cleanup:** 243 orphan dispatch jobs, 22 orphan events and the "Qa Tester" lead. The delete was blocked by the classifier; the SQL is in the 2026-10-02 chat (Supabase SQL editor). The 36 voice-minute rows stay (append-only ledger).
- [ ] _Optional:_ rename the enterprise "Multi-location" nav link/copy; tighten the `worker-src blob:` CSP now Three.js is gone.
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

- [x] **Voice P3 (built, tests green 2026-09-28):** the call's sales brain (Retell-hosted model + tools into ClientTurn), time limits in-call, voicemail, voice in next-best-action, AI "call"/"transfer" permissions, calls paused in maintenance, Pro checkout adds the voice item, 20 simulated call scenarios, voice section of `economics.md`, `scripts/retell-setup.mjs`.
- [x] **Voice QA + objection matrix (2026-09-28):** 18 spoken trigger types (90 noisy UK test phrases) mapped to actions; "take me off your list" now opts out everywhere; wrong numbers never re-rung; new "send me something" tool (0167 applied); tool failure → apology + text follow-up; no dead air after tools; 46 call scenarios all 100; objection matrix 54/120 → **120/120 cells ≥90** (mean 99.6) by fixing the library (goal-matched next steps, new angle on repeats, honest bot answer). Provisional voice: Cartesia "Willa" (British female), "Anthony" as male alternative. **Owner:** listen to both on the test call. ElevenLabs as the standard voice would need packs ~+18% (1,000 min £449 → £528); kept as the +20p/min premium option instead.
- [ ] ~~Objection matrix~~ (done above): ~120 key cells (objection type × channel SMS/email/WhatsApp/voice × goal meeting/sale/trial/quote × first/repeat). Claude generates and grades (no Azure cost, uses Claude plan), improves the library/closes/voice scripts until every cell grades ≥90. Then **optional** final Azure confirmation run (~120 replies, <£1) only with your OK.
- [ ] **Voice QA + conversion pass — second, adversarial round running (2026-09-28):** first round done (46 scenarios, above); now 70+ adversarial scenarios (UK colloquial opt-outs, call screening, ASR errors, hostile/vulnerable callers, price asks). Real-call checks (latency, barge-in, voice choice) need the test call. Scope: trigger phrase detection on speech (opt-out, wrong number, "is this a robot?", call me later, human please, voicemail/IVR), accents and speech-to-text errors, every route and flow, objection and closing libraries adapted for voice, human-sounding British voice chosen against cost, latency/interruption/backchannel settings, 40+ simulated scenarios scored, enterprise checks (audit, compliance, locks, failure recovery).
- [x] **Public site design pass (done 2026-09-28):** voice visual as a real call (compact, waveform, live captions), ~30–40% less text in every section, card padding fix on every public page.
- [x] **Automations + pipeline + data retention (0162/0163 applied 2026-09-28):** Follow-Up → Automations tab (voice/quote/payment/usage triggers; call, message, booking link, quote, approval, signature, invoice, payment link, hand-over, stage, tag, rescore, nurture, notify team — each checked against permissions, plan, maintenance and the enabling admin's role; skipped steps say why), pipeline stage mapping (Settings → AI & selling), quote/invoice data-rights coverage, daily recording/transcript retention with R2 clean-up, Contracts Finder tenders, renewal/headcount/tech columns in imports. Note: a rule that sends a message never sends after the lead replied, booked or was taken over (the AI handles replies).
- [ ] ~~Automations + pipeline + data retention~~ (done above): voice/quote automation triggers and actions (§45), pipeline stage mapping (§46), data-rights coverage for quote/invoice tables, recording/transcript retention job, Contracts Finder tenders, CRM/list import columns for renewal + headcount signals.
- [ ] **Channels (building 2026-09-28):** "LinkedIn Assist" (decided 2026-09-28: no automation, no extension, no scraping — a daily task list of AI-written connection notes / follow-ups / InMails, one tap to open the profile + copy + mark sent, mobile-friendly, account-safe pacing well under LinkedIn's limits, "Log reply" paste → AI drafts the answer, follow-ups scheduled as tasks, move the conversation to email/SMS/call when the lead allows; marketed as "assisted by design, your account stays safe"; Lead Gen Forms stay fully automated), Instagram + Messenger (automated in Meta's 24h window), TikTok messaging (check API), multi-channel routes.
- [x] **Commercial rules (done 2026-09-28, 0174 applied):** approved claims/SLAs/guarantees (offer card), quote terms (Settings → Quotes & invoices), agents target a product set or the whole catalogue, deterministic best-fit card on the lead page, approved-only competitor positioning with a validator, Instagram replies gated until Meta approves. **Owner:** confirm the best-fit point weights (`src/lib/commercial/best-fit.ts`).
- [x] **Invoice pay links + automatic settlement (done 2026-09-28, 0173 applied):** per-invoice tracked pay link on the customer's own Stripe; token-matched payments settle the invoice and move the quote to DEPOSIT_PAID/PAID; anything uncertain goes to review.
- [x] **LinkedIn Assist + Messenger/Instagram fixes (done 2026-09-28, 0171 applied).**
- [x] **Enterprise pack (done 2026-09-28, 0172 applied):** audit log export, per-person permissions, `/dpa`, security questionnaire, data flow, uptime, pen-test scope, internal review (IR-01..05 fixed; IR-06 key part fixed).
- [x] **`docs/economics.md`** (2026-09-28: §12–13 voice model; new §14 one-off affiliate commission, annual-referral profitability, blended customer, quote-to-cash cost) rebuilt as the full unit-economics model (tiers, voice, WhatsApp, scenarios, sensitivity, capacity, competitors, working capital) (§68–69).

### System gap audit (2026-09-28) — `docs/revenue-engine/15-system-gap-audit.md`

- [x] **Batch 1 — ops/reliability/tests (done, see below):** Sentry error tracking, pushed alerts (dead jobs, webhook failures, cron misses, provider outages, voice margin), queue priorities + reaper that dead-letters, faster worker, test runner that always runs all 3 groups, security headers, restore runbook + PITR check.
- [x] **Batch 2 — billing/entitlements (done, see below):** failed one-off payment stuck in past-due, disputes claw back tokens/minutes, 3-D Secure / delayed payments, release the number after cancel, downgrade while over limits, saved-search limit, lead cap on every create path, analytics page gated server-side for trials, admin MRR from real Stripe amounts, Find Leads `loadUnitCosts` (USD read as pence), Enterprise allowances priced.
- [x] **Batch 3 — messaging/integrations/security (done 2026-09-28, 0168 RLS grant hardening applied; `tests/security-batch3.test.ts`):** bounces suppressed per recipient (not the whole mailbox), mailer-daemon parser fix, OAuth failures → "Reconnect", real provider health checks, Zoho reconnect prompt, sign-in rate limit fails closed, no SVG logos, banner-dismiss origin check, search/export limits, RLS proof tests for 0143–0149 and 0155–0162.
- Decided 2026-09-28: **no paid enrichment** (Apollo/Hunter/Clearbit off in production); **customer payments via the customer's own Stripe** (they are merchant of record); **keep the current app menu** (CLAUDE.md updated).
- [ ] **Owner for batch 4:** accept Retell's DPA in the Retell dashboard and tell Claude the data region; your ICO registration number and VAT number (if registered).
- [ ] **Batch 4 — legal/help (before the first live call or quote):** privacy policy + terms for AI calls, recordings/transcripts + retention, e-signature, quotes/invoicing and taking payment for customers, sub-processors (Retell + any enrichment providers actually live), new legal version + 30-day sub-processor notice, `/dpa` page, help updates.

### Owner requests 2026-09-28

- [x] Batch 1 ops (0164 applied; live worker verified processing after the change): Sentry (needs `SENTRY_DSN`), pushed alerts (needs `OPS_ALERT_EMAIL`), heartbeat `/api/cron/heartbeat` for an external uptime monitor, job lanes + reaper dead-letter, worker ~4× faster, test runner always runs all groups, security headers, `docs/RESTORE.md`. **Owner: PITR is OFF (daily backups only, up to 24 h loss) — enabling it is $100/mo; check R2 versioning in Cloudflare.**
- [x] **SDR cost-savings calculator** — `/sdr-cost-calculator` (Resources menu + footer): 2026/27 NI and pension from gov.uk, ONS sick days, holiday, recruitment, ramp-up, tools, management; voice packs on any plan with "Match my SDR's calls" (cheapest pack mix); same conversion rates both sides; shareable URL, copy results; checked at desktop, tablet, phone portrait/landscape and 200% zoom. Original brief: ClientTurn plans vs a fully-loaded UK SDR (salary, employer NI, pension, holiday, sick days, recruitment, ramp, tools, management), 60 calls/day, conversion inputs, monthly/yearly savings, shareable link.
- [x] **Billing batch 2 (0165 applied 2026-09-28):** one-off payment failures never block the account; add-ons follow subscription grace; 3-D Secure + delayed payments handled; disputes claw back only unused tokens/minutes and restore on a win; cancellation = 90 days read-only then deletion, number released after 14 days; downgrades allowed but adding over-limit items refused (with a "what to reduce" list); lead cap on every creation path (API answers 403 PLAN_LIMIT); saved searches, senders, intent monitors and trial analytics enforced; Find Leads cost bug fixed; admin MRR from real Stripe amounts; Apollo/Hunter/Clearbit off unless `ENABLE_PAID_ENRICHMENT`; `STRIPE_AUTOMATIC_TAX` flag ready. See `docs/BILLING.md`.
  - [x] Day-90 workspace deletion job after cancellation (0170 applied; `tests/workspace-deletion.test.ts`). **Owner:** set `WORKSPACE_DELETION_ENABLED` when ready.
  - [ ] **Owner:** in the Stripe dashboard turn Smart Retries off (ClientTurn retries itself for 30 days).
- [x] **Affiliate / partner audit + fixes (0166 applied 2026-09-28)** — 8 money bugs fixed (commission was paid on VAT; annual customers earned for 12 years; partial refunds wrong; refunds/disputes never reversed on current Stripe; won disputes now restore; flagged referrals no longer paid; retry could double-pay; payouts now need admin approval), IP hashing + purge, click limits, bot filtering, self-referral screening + fraud queue, tiers (daily recalculation, history, admin lock), admin export, partner tier panel, new `/affiliates/terms` (draft). Full table: `docs/revenue-engine/17-affiliate-audit.md`.
  - Decided (Claude, 2026-09-28): referral cookie set **only after cookie consent** and listed in the Cookie Policy (ICO: affiliate tracking needs consent); without consent, attribution by promo code or the signup link in the same visit. Negative balance at the end of a partnership is **written off**. No self-billing at launch: VAT-registered partners send us an invoice. Promo codes: **off** (owner decision). **Built and pinned by `tests/affiliate-owner-decisions.test.ts`:** consent-only cookie, URL-carried referral without consent, one-off write-off of a negative balance, statements as remittance advice (no self-billing), promo actions refuse.
  - Owner decision 2026-09-28: **commission paid ONCE per referred customer** — tier rate × the referred customer's first paid invoice — for annual plans the FULL annual payment (owner correction) — held for the refund window; renewals/add-ons earn nothing. Marketing, terms, portal, admin and help updated to match (done; 0169 applied; `docs/economics.md` §14).
  - Owner decision 2026-09-28: no annual cap. Affiliate commission is treated as a marketing (acquisition) cost, not part of gross margin: annual year-one margin is 78–82% at typical use, 65–71% at max use at 6–10% (paid once, cash-positive because annual is paid upfront).
  - Owner decision 2026-09-28: rates **6–10%**: Partner 6% → Pro Partner 8% (5 paid referrals in 12 months) → Elite Partner 10% (15 paid referrals). Public, legal, portal, admin and help updated to match (done).
  - [x] **Affiliate terms approved by the owner (2026-09-28)**, strengthened for UK status (independent business, not employee/worker/agent; Commercial Agents Regs excluded); draft banner and noindex removed; in the sitemap.
- [x] **Owner — disk space:** freed 2026-09-28, 17 GB free. Was: C: had 30 MB free (builds crashing). Claude cleared 12.6 GB of ClientTurn build cache; only 3.4 GB free now. Empty the Recycle Bin, clear other projects' `.next` folders (e.g. Gigvora), run Disk Cleanup.
- [x] **Full UI sweep + fixes (done 2026-09-28; `docs/revenue-engine/16-ui-sweep-audit.md`, `tests/ui-sweep.test.ts`; disconnect dialog behind drawer fixed and verified live):** every app section and component — back buttons, dead/unwired buttons, duplicates, phone sizes portrait + landscape, zoom 200%, warping, friendly error states instead of raw red errors (still logged to Sentry), customer-satisfaction polish.
- [x] **Affiliate / partner audit + fixes** (done, see above; one-off 6–10% commission live via 0169).
- [x] **Deployed for the owner to try** (2026-09-28, build + tsc + all 3 test groups green on the release commit).

### Enterprise readiness (owner 2026-09-28: do it all; Enterprise stays "Contact sales")

- [x] Audit log export (Settings → Data Controls; CSV/JSON, streamed, owner/admin, rate limited, audited) and per-person permissions (Settings → Team: outbound / integrations / billing). **Apply `0172_enterprise_roles_audit_export.sql`** (not applied) to switch overrides on.
- [x] Security pack: `docs/security/` (questionnaire, data flow, uptime 99.5% target, pen-test scope), `/dpa` published, sub-processor list updated (Google Places added). **Owner to supply:** ICO number, Retell AI data region + DPA, cyber insurance, staff count, staging URL for the pen test.
- [ ] Backups: confirm Supabase PITR, run a real restore drill into a scratch project, record the result (runbook from batch 1).
- [x] Internal security review: `docs/security/INTERNAL_REVIEW_2026-09-28.md` (open redirect fixed, upload size bound, 3 owner decisions open: admin MFA, audit-log retention, CI scanning).
- [ ] **External penetration test = owner to commission** (`docs/security/PENTEST_SCOPE.md`).
- [ ] Help screenshots: capture the 55+ skipped/flagged ones.

### Real-world proof (owner 2026-09-28)

- [x] Env: `TWILIO_AUTH_TOKEN` (working one from `.env.local`), `COMPANIES_HOUSE_API_KEY`, `RETELL_SECRET_KEY` pushed to Vercel production. Stripe TEST prices set everywhere: plans (£99/£199/£399, annual 15% off) + voice (add-on £100, number £11.99, packs £49/£115/£225/£449) — `.env.local` and Vercel. (Only sensitive values that differ can't be compared automatically; nothing else was overwritten. `.env` still holds the old dead Twilio token — harmless, `.env.local` wins.)
- [x] Committed (branch `release/revenue-engine-2026-09-28`, 5 commits) → build/tsc/tests green → fast-forwarded `main`, pushed, deployed.
- [ ] Real test call to the owner's phone **07591079608** (approved 2026-09-28): run `scripts/retell-setup.mjs --apply`, import the number into Retell, then ≤3 calls / ≤10 minutes total (~£1). **Blocked by the permission classifier** (sending the agent config to Retell) — owner to allow it or run the script.
- [ ] Real quote → sign → pay on Stripe TEST end to end (test card), then refund/cleanup. **Gap found 2026-09-28:** invoices from a quote carry no pay link, and a payment reported by the customer's own Stripe (payments webhook) wins the lead but does not settle the invoice or move the quote to PAID (manual "record payment" only). Build: per-invoice pay link (customer's own Stripe Payment Link / Checkout, tagged with the invoice token) + automatic settlement from the payment fact → then run the TEST journey.
- [ ] Qualification engine live review: needs real traffic (after launch).
- [ ] Live AI wording: Claude-graded objection matrix (running) + optional small Azure confirmation run with your OK.
- [ ] Owner: an unconfirmed Supabase auth user for jamahl1996@gmail.com was created by a login-link test (2026-09-28 01:02 UTC). Keep or delete?

## 6. Verify before launch — Claude

- [ ] Full `npm test` (all three groups), `npx tsc --noEmit`, `npm run lint`, `npm run build` — all green.
- [ ] Live business stories (08:02–19:30 UK) including the quote journey: all pass, zero rows left.
- [x] Accessibility audit (WCAG 2.2 AA, 2026-09-28): 34 fixed, 0 critical/serious open; axe on 21 public routes; signed-in screens static only (`docs/ACCESSIBILITY_AUDIT_2026-09-28.md`). Open design calls: input border contrast, heading skips, badge tooltips by keyboard.
- [ ] Performance and concurrency QA.
- [x] **Integration token refresh audit (2026-10-02):** all 7 refreshable providers (Calendly, Google Calendar, Google Ads, Salesforce, Zoho, Slack, LinkedIn Ads) renew on use and 30 min ahead, rotation stored, race-safe, 6-hourly recovery of flagged connections; Meta/WhatsApp get a daily validity check, extension and a 10-day warning. Open: LinkedIn 365-day refresh-token warning.
- [ ] Retake help screenshots flagged in `content/help/SCREENSHOTS.md`.
- [ ] After deploy: `intent.sweep` every 6 h and every new job type completes with no dead jobs (`docs/CRON.md`).
- [x] Final delivery report with a release-readiness score (`docs/revenue-engine/11-final-report.md`, "Update 2026-09-28"): **80/100, conditional release → green after the voice test call, one TEST checkout + quote-pay run, and Vercel Pro.**
- [ ] **Launch gate:** voice and quotes work end to end on real accounts (Retell + Twilio live, Stripe prices, one capped test call to your phone with your OK) before the site goes public.

## 7. After launch (needs real traffic)

- [ ] Review the qualification engine's shadow decisions on a real workspace, then set `QI_RELEASE_GATES_PASSED = true`.
- [ ] Build the `EVAL_LIVE` runner (costs AI tokens — only with your OK).
- [ ] Harness for the full Find Leads sourcing run (story F3).
- [ ] Before paid enrichment: `provider_price_book` + prospect spend cap. (O10)

## 8. Release

- [x] Commit and deploy (2026-09-28, see §5 Real-world proof).
- [ ] Final sign-off in the final report.
