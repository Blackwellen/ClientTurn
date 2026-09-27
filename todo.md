# ClientTurn — pre-launch to-do

Tick each box when it is done. Sections are in the order they unblock each other.
Details and evidence live in `docs/revenue-engine/06-coverage-tracker.md` (owner actions O1–O10),
`docs/revenue-engine/11-final-report.md` and `docs/economics.md`.

_Last updated: 2026-09-27._

---

## 1. Urgent — the live app is broken without these (owner)

- [ ] **Fix the Twilio auth token.** Twilio Console → the account that owns the ClientTurn number → Account → API keys & tokens → copy the current **Auth Token** → set `TWILIO_AUTH_TOKEN` in Vercel (Production) and in local `.env`. Today every inbound SMS and delivery update gets **403**, so customer replies and **STOP** never reach the app.
- [ ] **Redeploy** after the token change (and to ship all of today's code: platform-SMS fix, GSM-7 normalisation, AI-first hand-over, no-overage billing, trial pop-up, payment loop).
- [ ] **Re-run the owner SMS test** once deployed: reply to the test text → AI answers → text **STOP** → confirm the app records the opt-out and sends nothing more → text **START** to lift Twilio's block. Then ask Claude to delete the test workspace `ZZ-OWNER-SMS-TEST 2026-09-27` with the zero-rows proof.

## 2. Accounts, keys and settings (owner)

- [ ] **Stripe TEST prices.** Create TEST-mode prices for Starter / Growth / Pro (monthly + annual) and set every `STRIPE_PRICE_*` in `.env.local` and Vercel to them (current values are not TEST prices: "No such price").
- [ ] **Stripe Terms of Service URL** on the Stripe account (needed for the top-up terms tick-box at checkout).
- [ ] **VAT.** Either register for Stripe Tax and switch on `automatic_tax` (Claude will add it once the account is set up), or make prices VAT-inclusive and change the pricing copy. The site currently says VAT is added at checkout and it isn't. (O7)
- [ ] **Companies House API key** (free: developer.company-information.service.gov.uk) → `COMPANIES_HOUSE_API_KEY` in `.env.local` and Vercel. Funding / leadership-change / incorporation signals and the LinkedIn import's registry check need it. (O1)
- [ ] **Google sign-in**: register the redirect URIs (`http://localhost:3000/api/auth/google/callback`, `https://clientturn.com/…`, `https://www.clientturn.com/…`, `https://clientturn.vercel.app/…`) and set `NEXT_PUBLIC_SITE_URL`, `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET` in Vercel. (O2)
- [ ] **Authorise the Stripe and Cloudflare MCP connectors** (claude.ai connector settings or `/mcp`) so live Stripe/R2 checks can run. (O4)
- [ ] `META_WHATSAPP_CONFIG_ID` if WhatsApp (direct) Embedded Signup will be offered. (O6)
- [ ] **Vercel plan.** Hobby is fine technically (cron runs in Supabase), but Vercel's terms limit Hobby to non-commercial use — move to Pro before taking paying customers. (O8)

## 3. Decisions / permissions Claude is waiting on

- [x] **`tests/plan-margins.test.ts`** — updated 2026-09-27 (no overage, WhatsApp tokens); passes.
- [ ] **Agent replies during quiet hours** — you approved "reply straight away when the lead texted in the last hour"; the change was blocked as weakening a safeguard. Add a permission rule or apply the patch yourself.
- [ ] **Existing customers** — tell any existing Growth/Pro customers about the new limits (included SMS reduced, WhatsApp now a paid add-on, Pro AI tokens 6M) — migration 0138 is already live.

## 4. Build work in progress (Claude — agents running)

- [x] AI-first hand-over follow-ups: price pushback handled by the AI (two-step discount rule), honest "are you a bot?" answer, help articles updated.
- [x] Direct-sale loop: tracked checkout links, Stripe (customer's own account) + generic "order paid" webhooks, auto-Won with amount, thank-you + next steps, abandoned-checkout follow-up, unmatched-payment linking. Migration 0143 applied and verified live 2026-09-27 (RLS on; secrets table server-only).
  - [ ] Re-run live story P (P1–P6) now 0143 is applied — after the sales-craft strategy fix lands.
  - [ ] **Owner:** make sure `CREDENTIAL_ENCRYPTION_KEY` is set in Vercel (seals payment webhook secrets).
- [x] Trial upgrade pop-up built (dashboard, inbox, lead page, banner, billing settings) + free-trial help; 28 tests; verified on Stripe TEST (one charge on double-click, decline stays in trial, bank confirmation handled). _Final reconciliation + full checks still running._
- [x] Re-engagement: intent triggers (not-now dates, deadlines, no-shows, win-back by loss reason), cross-loop frequency cap (1/day, 3/week, 6/30 days; new leads' first 72 h exempt so speed-to-lead isn't slowed), dead-lead stop after 4 unanswered, cheapest channel first, best send time, reactivation A/B tests, outcome metrics. Migration 0146 applied and verified live 2026-09-27.
  - [ ] Fix: "not now" check-in composed nothing (qualification engine "NBA must agree with the assessment" error) — sent to the multi-interest and sales-craft agents; then re-run live story R1.
  - [ ] Tell the agent *why* it's checking in ("they asked to be contacted around now") — needs a small `agent/strategy.ts` change after sales craft finishes.
- [x] Admin economics dashboard (`/admin/economics`): real per-workspace margin, cost per trial / lead, below-75% alerts (daily, once a month per workspace), pricing simulator; migration 0145 applied. Known gaps: inbound SMS and Resend costs "not measured" until metered; revenue uses list price (Stripe invoice amounts not stored).
- [x] Leads with two interests (e.g. a subscription and a one-off service) worked towards both goals: one deal per interest with its own goal and next step, shared facts asked once, the closest-to-close interest goes first, each closed with its own link or meeting type; Interests card on the lead page; each interest pushed as its own HubSpot/Salesforce deal. Migration 0144 applied and verified live 2026-09-27.
- [x] **Stabilisation:** live stories **66/66 pass** (run 7ef2a8d4, 2026-09-27, zero rows left, nothing spent). Fixed: booking not offering times, harness question reader, "not now" read as a refusal, due check-ins waiting again, agent told why it checks in, buying signals move to the close, "tied in until March" reconnects 6 weeks before, 12 new intent signals in lead context (0155 applied), a two-interest checkout leaving its deal open, "not ready to go ahead" read as ready to buy.
- [x] `tests/plan-margins.test.ts` updated to no overage + WhatsApp tokens (34/34) — `npm run build` typecheck unblocked.

- [x] **Sales craft:** human writing style enforced (no emojis, no dashes, no AI phrases; SMS backstop strips them), objection library with 2–3 responses each + your own objections and reassurance in Settings → AI & selling (with an offline "Try it"), closes per goal (two slots / checkout + one line of value / trial / enterprise brief), "can you call me?" now books a phone slot instead of handing over, a once-only "best way to reach you?" ask. Migration 0147 applied and verified live 2026-09-27.
  - [ ] Engine gaps left for `nba.ts`: act on clear buying signals; plan a reconnect when a lead is "tied in until March".
  - [ ] Re-run the live stories that the instruction leak broke (A6–A10, C4, H3, H4, Q1, S1, S3, I3b) plus P and R.
- [x] **Intent signal catalogue:** ~40 buying signals (funding rounds, grants, acquisitions, senior hires and departures, hiring by role, expansion, launches, rebrands, tech changes, website issues, tenders, filing deadlines, accounts growth…), each with its lawful free source (company website, careers page, Companies House) or marked unavailable with the reason; AND/OR combination segments in Find Leads; the Search Agent can use them. Also fixed: custom category keywords never reached a sourcing run.
  - [ ] Follow-ups: connect Contracts Finder (free public tenders API); map CRM/list import columns for contract-renewal and headcount signals; carry the new signal types into lead qualification context (`CONTEXT_SIGNAL_TYPES`).
- [x] **UK compliance page + outreach guides:** public `/compliance` page ("How we keep you compliant"; not legal advice; no certifications claimed; honest data-location note); help: cold email that gets replies (catch-all, bounces, cadence), reaching the decision maker (Places → website → LinkedIn, polite info@ gatekeeper email), which channels are automated vs assisted (TikTok messaging not integrated); in-product tips. **Owner check:** read the page before launch.
- [x] **Upsells + welcome email:** offers only at real moments (AI tokens run out/80%, a lead wants WhatsApp but it can't send, lead cap 80/95%/hit twice, seats or prospects full, usage trending over the cap, booked-meeting milestones); owner/admin only, never in a trial or mid-task, one at a time, pop-ups only for blockers (max 1 a week), "Not now" snoozes 30 days, owner can switch them off; conversions tracked. One-time welcome email on subscribing (AI token packs, WhatsApp tokens, no overage, non-refundable once used). No voice "coming soon" anywhere. Migration 0149 applied and verified live 2026-09-27.
- [ ] **Queued — offer catalogue & commercial rules:** products/services catalogue, best-fit recommendation across options, bundles, discount policy (allowed? max? restraint: never / only after objections / proactive), SLAs, guarantees, cancellation and payment terms, approved claims and competitor positioning; agents targeting one product or the whole catalogue. Starts after the payment-loop and two-interest agents finish (same files).
- [ ] **Queued — channels:** LinkedIn InMail → connection → chat (assisted: AI drafts, you click send, per LinkedIn's terms), Instagram and Facebook Messenger conversations (automated within Meta's 24h window), TikTok messaging (check what TikTok's API allows), multi-channel combination routes and channel preference. Starts after the re-engagement agent finishes (same files).

### Full Revenue Engine Upgrade (brief §0–76, received 2026-09-27) — Voice + Quote-to-Cash

Release standard: one lead goes from ad → voice call → qualify → objections → quote → sign → pay → CRM → attribution, with cost measured and margin healthy. Pages rendering is not "done" (§75).

- [x] §0 Audit + gap map (`docs/revenue-engine/12-voice-quote-to-cash-gap-map.md`), with owner decisions OD-1 (call opener) and OD-2 (voice packaging). Phases P0–P6, six build lanes.
- [x] P1 quote-to-cash foundations: catalogue (tiers, bundles, VAT codes), one fixed price calculator (VAT per line rounded half up, deposits/instalments that always add up to the penny), discount policy (margin floor first, then restraint mode, two-step rule, approvals), quote lifecycle, secure public links (only a hash stored), simple e-signature with tamper detection (never claimed as "advanced"/"qualified"), invoices/credit notes/numbering/reminders/VAT-invoice fields. 508 tests, registered. Schema drafted in `docs/revenue-engine/13-quote-schema-draft.sql`.
- [ ] P2 quote-to-cash: migrations from the draft, service operations, agent tools (AI gets figures only from the calculator), public quote page `/q/[token]` + signing + PDF, automation events, jobs (expiry, nudges, invoice reminders). Starts after stabilisation.
- [x] P1 voice foundations: who can be called (asked for a call / consented on a form; "gave a number" alone never gets an AI call; a call request goes stale after 30 days; enrichment/imported numbers refused), number blocks (070/076/084/087/09/118/premium/non-UK/unknown ranges; per-call rate cap), calling hours in the lead's time zone with UK bank holidays for all regions, the locked opener, paid-only entitlement (15 reasons), call stages, 5-minute governor, pacing, loop detection, voicemail only with consent, minute reservation in seconds (included first, then packs, never overage), automatic number setup (sub-account → Twilio check → buy UK mobile → wire SMS + voice; never buys twice; 90-day quarantine). 124 tests, registered. Schema drafted in `docs/revenue-engine/13-voice-schema-draft.sql`.
  - Twilio's UK mobile check needs from the customer: business name, Companies House number, website, business address, and an authorised person (name, phone, work email). Settings → Voice must collect these.
  - Unverified until the Retell/Twilio accounts exist: several API field names (listed in the adapters). There's no Retell "end call" REST endpoint; calls end from the agent or a Twilio hang-up.
- [x] Voice + quote database (0150–0154) applied live 2026-09-27: 39 new tables. Security proof run against live: **85/85 pass** (no tenant sees another's calls/recordings/quotes/invoices; public quote link returns only customer fields; signing can't touch another tenant's quote; signed quotes and issued invoices can't change; credit notes ≤ paid; ledgers append-only; anonymise clears personal data). Proof script: `supabase/tests/0150-0154-rls-proof.sql`.
  - [ ] Follow-up: data-rights coverage for quote/invoice tables (needs a migration replacing the "kept after deletion" list in `data_rights_delete`); DB functions for voice call transitions and minute reserve/settle/release; retention job for recordings/transcripts.
- [ ] P2 voice: (tables done) `voice` agent channel, webhook routes (Retell + Twilio voice + bundle status), jobs (dial, post-call, provisioning, release, recordings), Settings → Voice, SMS from the dedicated number, Retell in sub-processors. Needs the Twilio auth token fixed first.
- [ ] Remove "Unlimited follow-up email" from plan features (`plans.ts`, 3 places) — breaks the no-"unlimited" rule. Retell to be added to the sub-processors list.
- [x] §1/§51 Provider pricing + competitor research, dated (`docs/revenue-engine/12-voice-provider-research.md`). Draft: 100 min £49, 250 £115, 500 £225, 1,000 £449, number £11.99/mo, premium voice +20p/min — all ≥75% GM even with FX +10% and provider +10%. To merge into economics.md.
- [ ] Voice foundations: `VoiceProvider` (Retell) / `TelephonyProvider` + `NumberProvider` (Twilio), dedicated business number per workspace (no rotation), Settings → Voice. **Paid only** — no real calls on trial, demo or free, enforced server-side on every path (§2–5, §60).
- [ ] Call eligibility + `canCallLead()` (asked-for-a-call vs just gave a number, PECR reg 19), calling hours in the recipient's time zone, voicemail/retry, inbound call-back (§25–28).
- [ ] Call engine: state machine, five routes (Qualification, Booking Close, Direct Close, Nurture, Reactivation), 5-minute time governor, "is now good?", pacing, natural speech, accents, anti-loop, objection taxonomy, human transfer (§6, §15–24).
- [ ] Recording/transcripts with retention + signed access; post-call extraction into the lead (§29–30).
- [ ] Minute budget, route allocations, concurrency queue, capacity forecast; immutable usage/cost ledger reconciled with the provider (§31–33, §39).
- [ ] Voice packaging (owner, 2026-09-27): add-on on every paid tier; **Pro comes with voice at £499** (200 min/mo + dedicated number, a separate Stripe item) and Pro customers can **remove voice → £399**. Pricing page shows both.
- [ ] **Automatic dedicated number** (owner, 2026-09-27): no manual work per customer. The customer confirms business details once → ClientTurn creates their own Twilio sub-account, submits the UK regulatory check, and on approval buys a UK **mobile (07)** number and wires it up → one number for **calls and texts**; call-backs reach the AI. Status + email while Twilio reviews (usually hours, up to a day or two — the only wait). Released at period end on cancel, then quarantined before reuse.
- [ ] Fix `subscription-sync.ts` reading the first Stripe line item as the plan (breaks as soon as Pro has a voice item). Must land before voice billing.
- [ ] **Owner, Stripe TEST:** create the voice prices: Pro voice add-on £100/mo, number £11.99/mo, packs £49/£115/£225/£449 (one-off).
- [ ] Voice pricing: packages 100/250/500/1,000 min, included minutes on higher tiers, number £9.99–12.99, prepaid + auto-recharge, 77–80% GM (§34–38).
- [ ] Quote-to-cash: catalogue/bundles/tiers/VAT, deterministic `calculateQuote`, lifecycle, approvals, discount control + margin floor, branded quote page + PDF (immutable revisions), first-party e-signature, invoices (deposit/partial/Stripe/reminders/credit notes), quote follow-up (§7–14, §72). _Absorbs the queued offer-catalogue item above._
- [ ] One revenue journey across channels: attribution (first/last/multi-touch), quote analytics, voice analytics, ROI view that never invents revenue (§40–42, §70).
- [ ] Measured experiments: control vs variant, minimum sample sizes, promotion and rollback history (§43).
- [ ] Settings: Voice / Sales Agent / Quotes & Invoices with sensible defaults and progressive disclosure; AI permissions (§44, §74).
- [ ] Automation triggers + actions for voice and quotes; pipeline stage mapping; call card in inbox; voice + quote panel on lead page (§45–48).
- [ ] Voice in the next-best-action engine (consent, preference, urgency, cost, time of day); locks against duplicate quotes/invoices/links/calls (§71, §73).
- [ ] Admin: live calls, minutes, spend, margin by workspace/package/provider/route/month, alerts, kill switches (disable voice, suspend number, pause outbound) (§58–59).
- [ ] Marketing site + pricing page: Voice Sales Agent as a paid capability, quote-to-cash story, clear minutes/number pricing, no "unlimited" (§49–52) — **in progress** (owner 2026-09-27: show as full paid features now, no early-access gate, since the site isn't launched).
- [ ] **Launch gate:** before the site goes public, voice and quotes must actually work end to end (Retell + Twilio live, Stripe voice prices created, quote page + signing + payment live) — otherwise the pricing page sells something that can't be bought.
- [ ] `docs/economics.md` rebuilt as a real unit-economics model (tiers, voice cost/retail, scenarios, route mix, sensitivity, capacity, competitors, working capital) (§68–69).
- [ ] QA: 20 simulated call scenarios, quote QA, billing QA, economic QA, RLS/security (public quote token, signature endpoint, webhooks), accessibility/responsive (§55, §62–66).
- [ ] Final delivery report with a release-readiness score backed by evidence (§76).
- [ ] Call opener (decided 2026-09-27): "This is an AI assistant calling from {calling-as name} about the enquiry you sent us on {day}. Is now an OK time…?" + recording notice. AI disclosure, business name and reason are locked; legal name and contact details given on request. ClientTurn is not named in the call (only if asked who built it); "Powered by ClientTurn" on quote, signing and booking pages instead.
- [ ] **Owner, for voice:** Retell account + API key; Twilio voice-enabled UK numbers (and a working auth token — see section 1); have a lawyer check the fixed opener and recording notice once before launch.
- [x] **WhatsApp tokens built:** 1 token = 2p; reply/utility 2 tokens (4p), marketing 5 tokens (10p); packs 1,000/2,000/5,000 = £20/£40/£100; old 27p credit → 14 tokens. ~40% margin on the shared Twilio number (Twilio charges both directions), ~47–54% on a workspace's own Meta number; no platform fee, so cheaper in total than 360dialog below ~790 marketing / 1,760 replies a month. Migration 0148 must ship with the code (not applied yet). Original brief:
  _Brief was:_ per category at ~50% margin (≈10p marketing, ≈4p utility and conversation replies), sold as **WhatsApp tokens** (non-monetary units, no cash value — not a £ balance, to avoid any e-money/FCA impression), each message type costs a whole number of tokens, existing credit converted to tokens at no loss; plans stay ≥75%. Needs `tests/plan-margins.test.ts` updated (owner-held).

## 5. Verify before launch (Claude, after section 4)

- [ ] Apply every pending migration from section 4 and regenerate the database types.
- [ ] Full `npm test` (all three groups), `npx tsc --noEmit`, `npm run lint` and `npm run build` — all green.
- [ ] Live business stories (08:02–19:30 UK): all pass, `deployedWorkerTouched: []`, zero rows left.
- [ ] After deploy: confirm `intent.sweep` runs every 6 h (one-line check in `docs/CRON.md`), and every new job type completes with no dead jobs.
- [ ] Accessibility audit (keyboard, contrast, screen reader) on the main app screens and marketing site.
- [ ] Cross-tenant RLS tests on the new tables (needs a local Supabase stack).
- [ ] Performance and concurrency QA (report §95–97).
- [ ] Retake the screenshots flagged in `content/help/SCREENSHOTS.md` (billing changes) and capture the 55 skipped ones once a sandbox with test provider credentials exists.
- [ ] Update `docs/revenue-engine/11-final-report.md` (scores, §109 table, sign-off) with the final evidence.

## 6. After launch (needs real traffic)

- [ ] Review the qualification engine's shadow-vs-legacy decisions on at least one real workspace, then set `QI_RELEASE_GATES_PASSED = true` (with a comment citing the evidence) to make the engine live by default.
- [ ] Build the `EVAL_LIVE` runner and evaluate the live model's wording on the golden conversations.
- [ ] Harness for the full Find Leads sourcing run (story F3).
- [ ] Before switching on paid enrichment: make Find Leads use `provider_price_book` and cap prospect spend. (O10)

## 7. Release

- [ ] Commit (Claude has not committed anything — waiting for your go-ahead) and deploy.
- [ ] Final sign-off in the final report (currently 🟡 conditional release).
