# Qualification Intelligence & Intent Engine: discovery, design, build plan

**Date:** 2026-09-26 · **Branch:** `system-mesh-audit-and-p0-fixes` · **Highest migration seen:** `0133`
**Status:** discovery and design only. No code was changed to write this document.
**Brief:** owner's 25-section "Qualification Intelligence & Intent Engine" (tracker 8.28).
**Binding constraints:** CLAUDE.md resolved conflict 1 (deterministic engine is the system of
record; AI may only classify intent or extract a candidate value; low confidence or an
unmatched value records `REVIEW` and the AI keeps the conversation going with a clarifying
question, human hand-over being the last resort (owner decision 2026-09-27); AI never composes a
binding promise), [AGENT_RUNTIME.md](../AGENT_RUNTIME.md) ("the model proposes, code decides";
"Hand-over policy"), and the memory rules: the service layer is the spine, and shared
helpers go in pure `types.ts`-style modules, never in `server-only` files.

**Core rule the whole design serves:** ask the smallest, most natural question that gets the most
decision-relevant missing information for *this* buyer, offer, intent and goal. If asking nothing
and moving the sale forward is better, ask nothing.

---

## 0. Headline findings

What exists is further along than the brief assumes. The work is mostly **extension**, not new
architecture.

| # | Finding | Evidence |
|---|---|---|
| F1 | An adaptive, deterministic question selector already exists. It marks known and inferred questions, ranks by value, stops at the motion's decision threshold, and honours a depth setting. It ranks **only questions the workspace configured**. A library dimension with no configured question can never be asked. | [next-question.ts:426](../../src/lib/qualification/next-question.ts#L426), [strategy.ts:250](../../src/lib/agent/strategy.ts#L250) |
| F2 | "Known" is fed by two lead fields only (postcode and service). Memory facts are passed as `[]`. The stage is binary (NEW or QUALIFYING). | [qualify.ts:124-146](../../src/lib/jobs/handlers/qualify.ts#L124) |
| F3 | **Ad-form and web-form answers are stored in `lead_touches.answers` and never read by qualification**, so the agent can ask a question the lead already answered on the form. This is the single biggest breach of "never ask what is known". | [0123:191-192](../../supabase/migrations/0123_revenue_spine.sql#L191); no reader in `qualification/` or `jobs/handlers/qualify.ts` |
| F4 | Lead-level intent is a `MAX` over five booleans inside the lead score. There is no signal entity, no strength, no decay and no intent state. Refusals **cap** dimensions (`VETOES`), which is a sound base for contradiction handling. | [lead-score.ts:95-103, 353-358, 374](../../src/lib/scoring/lead-score.ts#L95), [scoring/service.ts:389-431](../../src/lib/scoring/service.ts#L389) |
| F5 | A prospect-level intent store with expiry (`intent_events`) exists for Find Leads, but it is keyed to ICP *categories*, and its only bridge to leads is `intent_signal_strength` for promoted prospects. | [0028](../../supabase/migrations/0028_v4_intent.sql), [scoring/service.ts:202](../../src/lib/scoring/service.ts#L202) |
| F6 | **No site tracking, pixel or click tracking exists.** The UI promises a "ClientTurn tracking snippet" that was never built. `messages.opened_at` exists but nothing writes it. | [intent/types.ts](../../src/lib/intent/types.ts) `FIRST_PARTY_WEB`, [monitor-builder.tsx:164](../../src/components/find-leads/intent/monitor-builder.tsx#L164), [0029:450](../../supabase/migrations/0029_v4_outreach_comms.sql#L450) |
| F7 | There is no offer entity. `services` (name, description, `average_value`, `pricing_visibility`, `public_price_text`) is the offer. `qualification_questions.service_id` already scopes questions per service, so per-offer qualification has a foothold. | [0002:3](../../supabase/migrations/0002_catalog.sql#L3), `00241_agent_runtime.sql:94` |
| F8 | `leads.conversion_goal_id` and `conversion_goal_type` exist (0038), but the conversation agent never reads them. The goal is inferred from the workspace motion only. | `grep conversion_goal src/lib/agent` returns nothing |
| F9 | The `workspace_sales_overrides` kinds `QUALIFICATION_QUESTION` and `DISQUALIFIER` are allowed by the CHECK constraint but have **no reader or writer**. | [0121:81](../../supabase/migrations/0121_sales_intelligence.sql#L81) |
| F10 | **Provenance defect (Q-D1):** in the non-agent path, a reply that the AI fallback matched is stored as `source:'reply'` with no confidence, so it becomes indistinguishable from a typed answer. | [message-inbound.ts:824-840](../../src/lib/jobs/handlers/message-inbound.ts#L824) |
| F11 | Governed experiments (holdout, Wilson intervals, minimum sample, never optimising for replies) and per-message `features` exist. They cover warm follow-up and reactivation only, and carry no question-level features. | [learning/experiments.ts:24](../../src/lib/learning/experiments.ts#L24), [learning/features.ts:18](../../src/lib/learning/features.ts#L18) |
| F12 | The lead score already has most of the §13 shape: 7 dimensions, motion-adjusted weights, per-dimension evidence and missing items, confidence, a version, and a "why". UNKNOWN and NEGATIVE both score 0 in the total, and completeness is not tracked. | [lead-score.ts](../../src/lib/scoring/lead-score.ts), [motions.ts:260](../../src/lib/sales-library/motions.ts#L260) |

---

## A. Existing architecture, section by section

### A.1 Module map (what the engine is today)

| Layer | Module | Role | Pure? |
|---|---|---|---|
| Library | `sales-library/types.ts`, `qualification-dimensions.ts`, `motions.ts`, `archetypes.ts` (~60), `objections.ts` (23), `method-router.ts`, `classify.ts` | Dimensions (20), motions (7) with thresholds, archetype plans, methods with evidence grades | ✅ |
| Selection | `qualification/next-question.ts` | Known/inferred, value ranking, threshold stop, depth, sticky re-ask | ✅ |
| Verdict | `qualification/engine.ts` + `jobs/handlers/qualify.ts` | Deterministic PENDING/QUALIFIED/NOT_QUALIFIED/REVIEW with a reason chain | engine ✅ |
| Answer capture | `next-question.ts` `matchAnswer`, `qualify.ts:379` `matchAnswerWithAi`, `agent/tools.ts:412` | One configured question per reply. AI candidate is re-validated | mixed |
| Scoring | `scoring/lead-score.ts`, `answer-features.ts`, `tags.ts`, `service.ts` | Score, evidence, missing items, tags. History in `lead_scores` / `lead_tags` | engine ✅ |
| Re-score | `events/types.ts:86` `RESCORE_ON`, `events/outbox.ts:168` | `domain_events` → `lead.score` job, idempotent per event | ✅ / server |
| Agent | `agent/strategy.ts`, `orchestrator.ts`, `context.ts`, `validate.ts`, `offer-card.ts`, `classification.ts`, `types.ts` | Strategy block, one model call, extraction whitelist, validator + style lint, confidence verdicts | mixed |
| Memory | `opportunities/memory.ts` | Deterministic goals, pains, objections, stakeholders, timeframe (≤600 chars) | ✅ |
| Handoff | `handoff/brief.ts` | Deterministic brief plus a validated 30-second summary | ✅ |
| Learning | `learning/features.ts`, `experiments.ts`, `experiments-service.ts` | `messages.features` v1; governed A/B for follow-up and reactivation | mixed |
| AI economics | `ai/budget.ts`, `tiers.ts`, `model-router.ts`, `tests/fixtures/prompt-token-snapshot.json` | Scope budgets, value-aware tiers, token snapshot regression | mixed |
| Settings | `settings/ai-selling.ts` (+ actions and queries), `components/settings/ai-selling/*` | Depth, methods, risk tolerance, research depth, examples, budgets, weights, voice | ✅ types |
| Surfaces | `app/(app)/app/leads/[id]/page.tsx`, `components/leads/detail/lead-page-tabs.tsx:155`, `lib/leads/detail-queries.ts:230` | Qualification tab (Known / Inferred / Missing), score history, AI cost | server |
| Service ops | `services/registry.ts`: `qualification.list_questions` (722), `lead.score_explain` (748), `lead.rescore` (812), `sales_settings.*` (850), `scoring_weights.update` (1065) | Copilot, MCP and API derive tools from here | ✅ |

### A.2 The 25 sections

Status key: **DONE** = meets the brief · **PARTIAL** = real, with the listed gap · **MISSING**.

| § | Topic | What exists (file:line) | Status | Precise gap |
|---|---|---|---|---|
| 1 | Offer understanding | `services` ([0002:3](../../supabase/migrations/0002_catalog.sql#L3)) plus `pricing_visibility` / `public_price_text` (00241:94); `qualification_questions.service_id`; `business_profiles.archetype_key`, `sales_motions` (0121); `icp_profiles` with industries, locations, roles and exclusions (0025); `conversion_goals`; `commercial_authority` ([0125:199](../../supabase/migrations/0125_channels_closing_handoff.sql#L199)); offer card ([offer-card.ts:285](../../src/lib/agent/offer-card.ts#L285)) | PARTIAL | No per-offer profile: pricing model, subscription or one-off, cycle complexity, target and excluded customer, prerequisites, disqualifiers, onboarding, availability, sales objective, handoff rules. Motion and threshold are per **workspace** (`sales_motions[0]`), not per offer. `icp_profiles` feeds sourcing only, never lead fit. B2B/B2C is implicit in the archetype. |
| 2 | Customer context | `leadFields` = LOCATION + SERVICE_NEEDED ([qualify.ts:124](../../src/lib/jobs/handlers/qualify.ts#L124)); prospect role and intent feed the **score** only ([scoring/service.ts:117-212](../../src/lib/scoring/service.ts#L117)); opportunity memory reaches the prompt | PARTIAL | `facts: []` ([qualify.ts:143](../../src/lib/jobs/handlers/qualify.ts#L143)). Form answers ignored (F3). `company_name`, `subscriber_type`, enrichment, CRM and prior conversations do not pre-answer anything. Campaign, landing URL and UTMs (on `lead_touches`) are unused for intent or context. |
| 3 | Intent signal model | Lead: boolean features `inbound_enquiry`, `positive_reply`, `booking_intent`, `pricing_requested`, `intent_signal_strength`, `not_interested` ([lead-score.ts:95-103](../../src/lib/scoring/lead-score.ts#L95)). Prospect: `intent_events` with expiry, confidence and dedupe ([0028](../../supabase/migrations/0028_v4_intent.sql)). FIT and INTENT are separate score dimensions | PARTIAL | No lead-level `intent_signal` entity (type, strength, confidence, recency, source, product, reason, decay). Conversational signals are not detected: urgency, dissatisfaction, replacement search, competitor comparison, timeframe, readiness. Behavioural signals are impossible today (F6). `NEUTRAL_QUESTION` counts as a positive reply ([service.ts:47](../../src/lib/scoring/service.ts#L47)). |
| 4 | Explainable intent score | INTENT dimension = MAX of boolean facts; a refusal caps INTENT at 0 ([lead-score.ts:353](../../src/lib/scoring/lead-score.ts#L353)); only the latest classification can veto ([service.ts:411](../../src/lib/scoring/service.ts#L411)) | MISSING | No 35/20/25/10/10 categories, no states (NO_DETECTED_INTENT … NOT_NOW), no stored contradicting evidence, no decay stored. |
| 5 | Decay + recalculation | Prospects: `intent_categories.freshness_days`, `intent_events.expires_at`. Leads: `days_since_last_inbound` (engagement only). Triggers: `RESCORE_ON` = touched, reply.classified, qualification.answered, meeting.* and contact.* ([events/types.ts:86](../../src/lib/events/types.ts#L86)) | PARTIAL | No per-signal decay for leads. Missing triggers: opportunity change (`opportunity.created/won/lost` are emitted at [opportunities/service.ts:171, 271](../../src/lib/opportunities/service.ts#L171) but are not in `RESCORE_ON`; no stage-change event), silence, and expiry of a stated timeframe. The queue supports `runAt` ([jobs/queue.ts:85](../../src/lib/jobs/queue.ts#L85)), so delayed recalculation is cheap. |
| 6 | Dimension library (~26) | 20 dimensions ([types.ts:162](../../src/lib/sales-library/types.ts#L162)), each with 5 attributes ([qualification-dimensions.ts:26](../../src/lib/sales-library/qualification-dimensions.ts#L26)) | PARTIAL | Missing: OUTCOME (≈ SUCCESS_METRICS), AVAILABILITY, DISSATISFACTION, TECHNICAL_REQUIREMENTS / INTEGRATION, PROCUREMENT (merged into DECISION_PROCESS), IMPLEMENTATION_READINESS, DELIVERY_REQUIREMENT, PURCHASE_READINESS, NEED (≈ PROBLEM). See §B.7 for the mapping. |
| 7 | Hierarchy + profiles | Archetype → motion → `qualificationPlan` ([archetypes.ts:1338](../../src/lib/sales-library/archetypes.ts#L1338)); DEEP profiles for MSP (340), B2B_SAAS (241), ACCOUNTING (514), agencies and studios; ROOFER on `LOCAL_SERVICE` with MEDDPICC impossible ([method-router.ts:179](../../src/lib/sales-library/method-router.ts#L179)) | PARTIAL | No **Offer**, **Lead context** or **Intent** level in the plan. Workspace question overrides (`QUALIFICATION_QUESTION` kind) are unread (F9). |
| 8 | Question library as intents | One wording per dimension plus per-archetype rewording; configured questions are literal scripts; the model rewords ("Ask only this, in natural wording", [strategy.ts:170](../../src/lib/agent/strategy.ts#L170)) | PARTIAL | No intent entity carrying prerequisite, industries, archetypes, offers, stages, channels, answer type, scoring rules, branches or disqualification implications. No channel-specific rendering. |
| 9 | Question value | `IG × DR × CV − friction − prematurity + threshold/required bonus` ([next-question.ts:515](../../src/lib/qualification/next-question.ts#L515)); stage-adjusted prematurity (322) | PARTIAL | Missing: sales progression, intent relevance, repetition risk, known-answer probability. "Ask nothing" happens only when nothing is left or the threshold is met. It is never *compared* against answer / inform / CTA / wait. |
| 10 | One question per turn | `maxPrimaryQuestionsPerMessage: 1` ([motions.ts:47](../../src/lib/sales-library/motions.ts#L47)); `countQuestions` + `STYLE_MULTIPLE_QUESTIONS` ([validate.ts:431, 485](../../src/lib/agent/validate.ts#L431)) | DONE | A linked-pair exception does not exist. Recommendation: keep it that way (§B.13). |
| 11 | Adaptive trees that stop | Threshold stop + depth ([next-question.ts:399](../../src/lib/qualification/next-question.ts#L399)); sticky re-ask (545) | PARTIAL | No branches (follow-up conditional on an answer), no prerequisites, no "enough to decide *negatively*" stop. Sticky re-ask has no limit, so the same question can be repeated indefinitely. |
| 12 | Goal routing A–G | Close targets per motion; direct-close gate + `READY_TO_BUY` handover ([orchestrator.ts:823-846](../../src/lib/agent/orchestrator.ts#L823)); NOT_QUALIFIED stops follow-up; NURTURE / NOT_NOW tags | PARTIAL | `leads.conversion_goal_*` is ignored (F8). No goal A (qualify-only) routing. Goal G does not suppress where required, and the reason reaches only `qualification_reason`. Goal F keeps answers but facts never go stale. |
| 13 | Transparent qualification score | Lead score v2 ([lead-score.ts](../../src/lib/scoring/lead-score.ts)), weights by archetype × motion ([motions.ts:260](../../src/lib/sales-library/motions.ts#L260)), `lead.score_explain` | PARTIAL | The dimension set differs (FIT 30 vs the brief's OFFER_FIT 20 + NEED 20 + TIMING 15). UNKNOWN vs NEGATIVE is not visible in the total. No completeness. |
| 14 | Answer interpretation | Current question only (`matchAnswer` + nano fallback); agent `extracted[]` whitelist of 5 lead fields ([types.ts:529](../../src/lib/agent/types.ts#L529), [orchestrator.ts:1004](../../src/lib/agent/orchestrator.ts#L1004)); `answerFeatures` ([answer-features.ts:55](../../src/lib/scoring/answer-features.ts#L55)); memory buckets | PARTIAL | One reply cannot fill several dimensions. There is no "answered fully / partially", no intent/stage/objection delta, and no "close instead" output. |
| 15 | Uncertainty states | `KnownQuestion.inferred`; UI Known / Inferred / Missing ([lead-page-tabs.tsx:181-214](../../src/components/leads/detail/lead-page-tabs.tsx#L181)) | PARTIAL | No CONFLICTING state and no verification step for material inferences. Q-D1 provenance defect. |
| 16 | Pre-send QA (13 points) | Claim validator + style lint: clichés, pressure, em dashes, one question, forbidden phrases ([validate.ts:450](../../src/lib/agent/validate.ts#L450)); reject → retry once → handover | PARTIAL | 2 of 13 checks exist (one question; channel length). The other 11 are missing: necessary, already known, business/offer/intent/stage fit, intrusive, generic, form-like, responds to what was said, answers their question first, should close instead. |
| 17 | Self-improvement | `messages.features` v1 (family, CTA, method, motion, archetype, score band, arm); experiments with holdout and no automatic change | PARTIAL | No question-intent / wording-family / position / intent-state features. No question metrics. Experiment kinds exclude question strategy. No strategy versioning. |
| 18 | Token control / structured NBA | Deterministic strategy block; offer card ≤600 tokens; memory ≤600 chars; `decideSpend`; token snapshot test ([token-budget.test.ts:26](../../tests/token-budget.test.ts#L26)) | PARTIAL | No structured NBA JSON computed before language generation. There is no path that skips the model when no message is needed, apart from silent modes. No tokens-per-action metric. |
| 19 | Lead Detail UI | Lead page with Qualification, Scores, AI, Attribution and Activity tabs | PARTIAL | No Intent panel, NBA card or "Why this question?". No manual overrides and no override audit history. |
| 20 | Settings | AI & selling: depth, methods, risk tolerance, research depth, examples, budgets, weights, voice, motions. Qualification editor: questions and rules per service | PARTIAL | Missing: goal, required dimensions, disqualification criteria (as dimension rules), booking / direct-sale / handoff thresholds, min/max autonomy, custom and forbidden question intents, framework override per offer, offer-specific rules, escalation conditions. |
| 21 | Copilot | `lead.score_explain`, `lead.rescore`, `qualification.list_questions`, `sales_settings.get` | PARTIAL | No why-asking, what's-missing, is-qualified, requalify-with-reason, policy edits ("don't ask budget", "require employees before MSP booking"), or an intent + completeness filter. |
| 22 | Test matrix | Unit tests per motion ([adaptive-qualification.test.ts](../../tests/adaptive-qualification.test.ts), [agent-strategy.test.ts](../../tests/agent-strategy.test.ts)) | MISSING | No generated profile × intent × information × role × behaviour × goal matrix. |
| 23 | Golden conversations | 12 deterministic eval cases ([tests/evals/cases](../../tests/evals/cases)); live hook | PARTIAL | Guardrail-only. No per-archetype multi-turn tables and no qualification-path assertions. |
| 24 | Question grading /100 | — | MISSING | Everything. |
| 25 | Release gates | Tracker 8.28 | MISSING | See §C.5. |

---

## B. Design: extend, don't fork

### B.1 Where the new code lives

One new **pure** directory, `src/lib/qualification-intelligence/`: no `server-only`, no Supabase,
relative `.ts` imports so the node test runner can load it. It sits beside `qualification/` and
`sales-library/` and imports from both. Server I/O goes in one `service.ts` (`server-only`).
Capabilities reach Copilot, MCP and the API only through `services/registry.ts` plus
`services/operations/qualification.ts`.

| File | Pure | Contents |
|---|---|---|
| `types.ts` | ✅ | Every shared contract: `IntentSignal`, `IntentAssessment`, `QualificationFact`, `OfferProfile`, `QuestionIntent`, `NextBestAction`, `Interpretation`, `QaFinding`, `GoalKey`, the version constants. **Written first (Phase 0) and frozen for the parallel phases.** |
| `signals.ts` | ✅ | Deterministic signal extraction from reply text, classifications, touches, bookings, opportunities and enrichment |
| `decay.ts` | ✅ | Half-life table, `decayed(signal, now)`, `nextDecayBoundary()` |
| `intent.ts` | ✅ | `assessIntent(signals, now)` → score, categories, state, evidence, contradictions |
| `facts.ts` | ✅ | Fact merge: CONFIRMED / INFERRED / UNKNOWN / CONFLICTING, validity windows, verification need |
| `offer-profile.ts` | ✅ | Zod schema, defaults per archetype × motion, resolution (lead → offer → workspace → motion) |
| `question-intents.ts` | ✅ | The question-intent library (data), plus synthesis of custom intents from configured questions |
| `question-value.ts` | ✅ | The value function and the ask-nothing comparison |
| `goals.ts` | ✅ | Goal A–G resolution and mapping to motion, close target, agent tools and handover reasons |
| `nba.ts` | ✅ | `decideNextBestAction(state)` → structured NBA (§18) |
| `interpret.ts` + `extractors.ts` | ✅ | Multi-dimension interpretation of one reply |
| `qa.ts` | ✅ | The 13 pre-send question checks (deterministic) |
| `grade.ts` | ✅ | The /100 question grader (shared by QA and tests) |
| `service.ts` | server | Load state, persist signals, facts and assessments, emit events |

### B.2 The one migration: `0134_qualification_intelligence.sql`

Re-check `ls supabase/migrations | sort | tail` before writing: parallel sessions collide. If 0134
is taken, use the next free number. Every table carries `business_id`, RLS is forced, members get
SELECT, and writes go through the service role (the `0121` pattern).

| Object | Change | Why not reuse |
|---|---|---|
| `lead_intent_signals` (new) | `id, business_id, lead_id, service_id null, category (EXPLICIT/BEHAVIOURAL/CONVERSATIONAL/CONTEXT), signal_type, polarity (POSITIVE/NEGATIVE/NEUTRAL), strength 0..1, confidence 0..1, source (FORM/REPLY/CLASSIFICATION/BOOKING/OPPORTUNITY/TOUCH/ENRICHMENT/SOURCING/MANUAL/AI_ASSIST), source_ref text, observed_at, half_life_hours, expires_at null, resume_at null (NOT_NOW), reason text ≤200, evidence_excerpt ≤240, dedupe_key unique, rule_version, retracted_at null` | `intent_events` needs `intent_category_id NOT NULL`, is shaped for ICP monitoring, and is read by Find Leads surfaces. Mixing conversational lead signals in would pollute them. Prospect `intent_events` rows become **CONTEXT inputs** instead (§B.3). |
| `lead_qualification_facts` (new) | `id, business_id, lead_id, service_id null, dimension, value text, value_normalised text, state (CONFIRMED/INFERRED/CONFLICTING/REJECTED), source (ANSWER/FORM/LEAD_FIELD/ENRICHMENT/REPLY/AI_ASSIST/CRM/MANUAL), source_ref, question_id null, question_intent_key null, confidence, observed_at, valid_until null, verified_at, set_by uuid null, superseded_at null` | `qualification_answers` is keyed on a *configured* `question_id` (FK, unique per lead). Library dimensions and incidental facts have no question. Answers stay the engine's input, and facts mirror them. |
| `lead_assessments` (new, append-only, `is_current`) | `intent_state, intent_score, intent_categories jsonb, intent_evidence jsonb, intent_contradictions jsonb, intent_confidence, valid_until, goal, qualification_completeness, dimension_status jsonb, nba jsonb, engine_version, trigger_event, created_at`; unique (`lead_id, trigger_event, engine_version`) | One source of truth for the agent, UI and Copilot. The same idempotency pattern as `lead_scores`. |
| `leads` | `+ intent_state text, intent_score smallint, qualification_completeness numeric(4,3), next_action text, assessed_at` | Denormalised for list filters ("strong intent + incomplete"). Written only by the assessment service. |
| `services` | `+ offer_profile jsonb not null default '{}'` (object check) | `services` **is** the offer entity. A new table would duplicate it. |
| `qualification_questions` | `+ dimension_key text null, question_intent_key text null` | Explicit mapping replaces `inferDimension` guessing. The selector already accepts `dimensionMap` ([next-question.ts:113](../../src/lib/qualification/next-question.ts#L113)). |
| `workspace_sales_overrides.kind` | Add `QUALIFICATION_POLICY` to the CHECK. `QUALIFICATION_QUESTION` (custom and forbidden intents) and `DISQUALIFIER` finally get readers | Policy keyed `*` (workspace) or `service:<uuid>` (offer). |
| `experiments.kind` | Add `QUESTION_STRATEGY` | Reuses the governed experiment machinery. |
| `domain_events` | None. The type CHECK is a pattern ([0123:278](../../supabase/migrations/0123_revenue_spine.sql#L278)) | New types are code-only. |

`database.types.ts` is regenerated in Phase 0, never hand-patched (memory rule). Until a local
stack exists, use the existing `select(... as "business_id")` cast pattern
([qualify.ts:73](../../src/lib/jobs/handlers/qualify.ts#L73)).

### B.3 Intent signal model (§3)

**FIT and INTENT stay separate by construction.** `intent.ts` may read only `lead_intent_signals`.
The FIT dimension may read only `FIT_FEATURES`. A test asserts that the two feature sets are
disjoint.

| Category | Signal types (initial) | Deterministic source available today |
|---|---|---|
| EXPLICIT (+) | `BOOKING_REQUEST`, `DEMO_REQUEST`, `CALLBACK_REQUEST`, `QUOTE_REQUEST`, `PRICING_REQUEST`, `PURCHASE_REQUEST`, `TRIAL_OR_SIGNUP_REQUEST`, `IMPLEMENTATION_QUESTION`, `INBOUND_ENQUIRY`, `STATED_PROBLEM`, `GENERAL_QUESTION` | `classifyHeuristic` booking/price/availability phrases ([classification.ts:415](../../src/lib/agent/classification.ts#L415)); `reply_classification` BOOKING_INTENT; `PRICE_ASK` ([answer-features.ts:39](../../src/lib/scoring/answer-features.ts#L39)); `created_via` / `relationship_type` inbound; conversion goal type on the form (`BOOK_DEMO`, `REQUEST_QUOTE`) |
| CONVERSATIONAL (+) | `URGENCY`, `TIMEFRAME` (with a date), `DISSATISFACTION_CURRENT`, `REPLACEMENT_SEARCH`, `COMPETITOR_COMPARISON`, `PRICING_CONCERN_ENGAGED`, `READY_TO_MEET`, `READY_TO_BUY` | `timelineDays` (answer-features:43); `matchObjection` COMPETITOR / EXISTING_PROVIDER / SWITCHING_COST (objections.ts); new phrase lists in `signals.ts` |
| BEHAVIOURAL (+) | `CONVERTING_PAGE_PRICING` / `…_DEMO` (landing URL), `REPEAT_SUBMISSION`, `FAST_REPLY` (<10 min), `BOOKING_LINK_OPENED` (future) | `lead_touches.landing_url`, touch count per lead, message timestamps. **Nothing else is lawful or available** (§D) |
| CONTEXT (+) | `FUNDING`, `HIRING`, `JOB_CHANGE`, `TECH_CHANGE`, `TENDER` | Promoted prospect's `intent_events` / `prospect_intent_matches` (the Find Leads agent is deepening these; **input only**) |
| NEGATIVE (−) | `NOT_INTERESTED`, `NO_NEED`, `WRONG_PERSON`, `NOT_NOW` (+`resume_at`), `UNSUBSCRIBE`, `COMPLAINT`, `NON_LEAD`, `NO_SHOW`, `OPPORTUNITY_LOST` | Binding classification, `MESSAGE_REPLY_CLASSIFICATIONS` NOT_NOW / WRONG_PERSON / REFERRAL ([types.ts:253](../../src/lib/agent/types.ts#L253)), bookings, opportunities |

Every signal carries a `reason` ("Asked 'can we book a call Thursday?'"), a capped verbatim
`evidence_excerpt`, and `source_ref` (message, touch, booking or opportunity id). The excerpt is
personal data: it is exported with a DSAR and cleared on anonymisation (extend the 0131 anonymise
trigger).

### B.4 Intent score and contradiction handling (§4)

`assessIntent` is pure and versioned `ie-1`. Each category = cap ×
`clamp01(max(decayed strength × confidence) + 0.15 × second distinct type)`.

| Component | Cap | Rule |
|---|---|---|
| Explicit | 35 | Strongest explicit positive, decayed |
| Behavioural | 20 | Strongest permitted behavioural, decayed. Usually 0 today (§D) |
| Conversational | 25 | Strongest conversational positive, decayed |
| Recency | 10 | 10 × decay factor of the newest positive signal (half-life 7 days) |
| Consistency | 10 | 10 when no negative signal is live; 5 when a live negative is **older** than the newest positive; 0 when the newest signal is negative |

**Contradictions are never summed. They cap, like `VETOES`.** Precedence, first match wins:

| Order | Condition | State | Score |
|---|---|---|---|
| 1 | UNSUBSCRIBE, suppressed or opted out | `NEGATIVE` (does not decay; lifted only by a new explicit inbound) | 0 |
| 2 | Newest non-neutral signal is NOT_INTERESTED / NO_NEED / WRONG_PERSON / NON_LEAD | `NEGATIVE` | ≤10; positives listed under `contradictions` |
| 3 | Live NOT_NOW (`resume_at` in future) | `NOT_NOW` | ≤25 |
| 4 | Explicit BOOKING / DEMO / CALLBACK, decayed ≥0.6, no newer negative, no scheduled booking | `BOOKING_READY` | computed |
| 5 | Explicit PURCHASE / TRIAL_OR_SIGNUP / READY_TO_BUY, decayed ≥0.6, no newer negative | `PURCHASE_READY` | computed |
| 6 | score ≥70 | `HIGH` | |
| 7 | 45–69 | `MEDIUM` | |
| 8 | 20–44 with an info-seeking signal (PRICING, GENERAL_QUESTION, STATED_PROBLEM) | `EXPLORATORY` | |
| 9 | 10–44 | `LOW` | |
| 10 | <10 or no signals | `NO_DETECTED_INTENT` | |

The brief's example, a pricing-page visit plus "not interested", hits rule 2: the result is
NEGATIVE, with the pricing visit shown as contradicting evidence, never HIGH. `HIGH` is reachable
without behavioural data (35 + 25 + 10 + 10 = 80), so the 20-point behavioural gap (§D) does not
distort the states.

**Stored per assessment:** overall score, category scores, evidence (signal ids + decayed
strength), contradictions, confidence (mean signal confidence × category coverage, floored at
0.25), `valid_until` (next decay boundary), `engine_version` and `trigger_event`.

**Lead score integration:** the INTENT dimension reads `intent_score / 100` as one fact
(`intent_assessment`), replacing the boolean MAX. The booleans remain allow-listed for
explanation. Bump `SCORING_VERSION`.

### B.5 Decay and recalculation (§5)

`strength(t) = s₀ · 0.5^(age / halfLife)`; a signal is ignored after `4 × halfLife` or after
`expires_at`.

| Signal | Half-life | Hard stop |
|---|---|---|
| BOOKING / DEMO / CALLBACK / PURCHASE / TRIAL request | 5 d | 30 d |
| QUOTE / PRICING request, READY_TO_MEET | 10 d | 45 d |
| INBOUND_ENQUIRY, STATED_PROBLEM, IMPLEMENTATION_QUESTION | 14 d | 60 d |
| URGENCY | 7 d | 30 d |
| TIMEFRAME | Flat until the stated date + 7 d, then 7 d | date + 30 d |
| DISSATISFACTION, REPLACEMENT_SEARCH, COMPETITOR_COMPARISON | 30 d | 120 d |
| Behavioural | 3 d | 14 d |
| CONTEXT (funding / hiring) | `intent_categories.freshness_days / 2` | `expires_at` |
| NOT_INTERESTED / NO_NEED | 90 d | 365 d |
| NOT_NOW | Flat until `resume_at` (default +60 d) | `resume_at` |
| UNSUBSCRIBE | never | — |

| Recalculation trigger (brief) | Mapped to | Change needed |
|---|---|---|
| New activity / new form | `lead.touched` ∈ `RESCORE_ON` | None |
| Reply / objection | `reply.classified` (trigger in 0123) ∈ `RESCORE_ON` | None; the signal is extracted in the same job |
| Qualification answer | `qualification.answered` ∈ `RESCORE_ON` | None |
| Booking | `meeting.*` ∈ `RESCORE_ON` | None |
| Opportunity change | `opportunity.created/won/lost` (emitted, not in `RESCORE_ON`) | Add them, plus a new internal `opportunity.stage_changed` emitted from `opportunities/service.ts` |
| Silence | none | Pure decay is time-based: a sweep re-assesses leads whose `lead_assessments.valid_until < now()` (new job `intent.sweep`, cron every 6 h, batch-limited) |
| Stated timeframe expired | none | When a TIMEFRAME or NOT_NOW signal is stored, `enqueue('lead.score', …, { runAt: resume_at, idempotencyKey: 'intent.resume:<lead>:<date>' })` |

The assessment runs **inside the existing `lead.score` job**: signals → intent → score → tags →
NBA → one `lead_assessments` row. No second queue path. `lead.intent_changed` (public, webhook
forwarded) is emitted only when the state changes. It is not in `RESCORE_ON`, so it cannot loop.

### B.6 Offer profile (§1)

`services.offer_profile` is validated by a zod schema in `offer-profile.ts`. Every field is
optional; defaults come from archetype × motion.

| Group | Fields |
|---|---|
| Commercial | `pricingModel` (FIXED / FROM / QUOTE / SUBSCRIPTION / USAGE / RETAINER), `averageDealValue` (else `services.average_value`), `billing` (ONE_OFF / RECURRING), `cycleComplexity` (SIMPLE / CONSIDERED / COMPLEX) |
| Who | `customerType` (B2B / B2C / BOTH), `targetCustomer` (sizes, industries as SIC prefixes, roles; may reference an `icp_profiles.id`), `excludedCustomer` (same shape), `geography` (postcode prefixes / regions; falls back to the service area) |
| Fit | `buyingRequirements[]`, `prerequisites[]` (dimension + predicate), `disqualifiers[]` (dimension + predicate + `reviewInstead` + `suppress`), `painSolved`, `differentiators[]` (approved claims only; they feed the offer card) |
| Delivery | `onboarding`, `availability` (lead time) |
| Selling | `goal` (A–G), `motion` override, `requiredDimensions[]`, `forbiddenQuestionIntents[]`, `thresholds` (booking / direct-sale / handoff as intent state + completeness), `handoffRules[]` |

**Resolution order (per lead):** `leads.service_id` → the offer's profile → workspace
`QUALIFICATION_POLICY '*'` → archetype × motion defaults. The **qualification plan becomes per
offer**: `qualificationPlan(archetype, offer.motion ?? workspaceMotion)` + `offer.requiredDimensions`
− `offer.forbiddenQuestionIntents`. `icp_profiles` finally feeds `company_size_match`,
`industry_match` and `geography_match`, which closes the "not fed" note in tracker row 16–19.

### B.7 Dimension library and question-intent library (§§6–8)

**Dimensions:** add 6 keys to `QUALIFICATION_DIMENSION_KEYS` and bump `LIBRARY_VERSION`: `OUTCOME`,
`AVAILABILITY`, `DISSATISFACTION`, `TECHNICAL_REQUIREMENTS`, `IMPLEMENTATION_READINESS`,
`PURCHASE_READINESS`. Map the rest of the brief's list without duplicating: need → PROBLEM, scope →
PROJECT_SCOPE, size → COMPANY_SIZE / TEAM_SIZE, existing provider → CURRENT_SOLUTION, procurement →
DECISION_PROCESS, delivery requirement → PROJECT_SCOPE (a `DELIVERY` intent), compliance / security
→ COMPLIANCE_REQUIREMENTS. That makes 26 keys.

**Question intents** (data in `question-intents.ts`, typed, versioned `qi-1`):

```ts
type QuestionIntent = {
  key: string;                       // "TIMING.START_WINDOW", "SIZE.STAFF_AND_DEVICES"
  dimension: QualificationDimensionKey;
  purpose: "DISCOVER" | "VERIFY" | "CLARIFY" | "DISQUALIFY_CHECK";
  prerequisites: { knownAllOf?: Dim[]; stageAtLeast?: ConversationStage;
                   intentIn?: IntentState[]; intentNotIn?: IntentState[] };
  appliesTo: { archetypes?: string[]; sicPrefixes?: string[]; motions?: SalesMotion[];
               goals?: GoalKey[]; pricingModels?: PricingModel[]; customerType?: "B2B"|"B2C" };
  stages: ConversationStage[];
  channels: AgentChannel[];          // e.g. no open-ended VOLUME on SMS
  answerType: ResponseType | "money" | "count" | "date" | "role";
  extractor: ExtractorKey;           // deterministic, in extractors.ts
  scoring: { feature: FeatureKey; map: ExtractorKey }[];   // → lead-score facts
  branches: { when: Predicate; next: string | "CTA" | "ESCALATE" }[];
  disqualifies?: { when: Predicate; reason: string; reviewInstead: boolean };
  attrs: { decisionRelevance; informationGain; salesProgression; intentRelevance; friction; prematurity };
  wordingFamily: string;             // the experiment unit
  renderings: { default: string; sms?: string; email?: string; social?: string };
};
```

**Relation to configured questions (backward-compatible):**

| Configured question | Becomes |
|---|---|
| With `question_intent_key` | That library intent; its own text is the rendering; its rules still judge |
| Without a key | A synthetic `custom:<question_id>` intent. Dimension = `dimension_key` ?? `inferDimension()`; `answerType` = `response_type`; options kept; attributes from the dimension (or `UNMAPPED`) |
| `required = true` | Always survives depth and the threshold (unchanged rule) |
| Its `qualification_rules` | Unchanged. The engine verdict is still computed **only** from configured questions and answers |

Library intents with no configured question are askable. Their answers land in
`lead_qualification_facts` and feed the score, the threshold and the NBA, but never the engine
verdict. A workspace can "adopt" one as a configured question when it wants a rule on it. Workspace
overrides (`QUALIFICATION_QUESTION` kind, keyed by intent key) can reword, forbid or require; the
same schemas validate them.

**Hierarchy (§7):** Industry (SIC) → Archetype → Offer profile → Motion / goal → Lead context
(facts) → Intent state → Known → value-ranked next intent. The complete profiles for roofer
(LOCAL_SERVICE: service, location, timing, property; no authority, stakeholder or budget before a
quote), MSP, B2B SaaS, accountant, ecommerce, enterprise SaaS and web studio are unit fixtures
reused by the matrix (§C.4).

### B.8 Question value (§9)

Additive, each term 0..1, weights default to 1, versioned `qv-1`. It replaces the multiplicative
formula; `selectNextQuestion`'s signature and result shape stay the same.

`V = decisionRelevance + informationGain·(1−pKnown) + salesProgression + intentRelevance − friction − repetitionRisk − prematurity − pKnown`

| Term | Computation |
|---|---|
| decisionRelevance | Attribute; ×1.0 if the dimension is in the goal threshold or `requiredDimensions`, ×0.5 otherwise |
| informationGain | Attribute × (1 − pKnown) |
| salesProgression | 1 if answering unlocks the goal's next step (missing threshold dimension or booking gate); 0.5 if it narrows the offer; else 0.2 |
| intentRelevance | At HIGH / BOOKING_READY / PURCHASE_READY, only gating dimensions get >0. At LOW / EXPLORATORY, PROBLEM / USE_CASE / OUTCOME get 0.8 (builds intent); commercial dimensions get 0 |
| friction | Attribute + 0.15 for open text on SMS or WhatsApp, + 0.15 when direction is OUTBOUND and the lead has not replied twice |
| repetitionRisk | 0.5 if asked once and unanswered, 1.0 if asked twice. **Sticky re-ask is limited to one**; after that, a different intent or no question |
| prematurity | Existing `adjustedPrematurity` ([next-question.ts:322](../../src/lib/qualification/next-question.ts#L322)) |
| pKnown | 1 CONFIRMED (never asked); 0.6 INFERRED material (a VERIFY intent is scored instead); 0.3 derivable by enrichment not yet run |

**Asking nothing is a scored alternative.** `nba.ts` compares the best question against ANSWER,
INFORM, CTA, BOOK, CHECKOUT, ESCALATE and WAIT (§B.9). A question is asked only if `V ≥ ASK_FLOOR`
(0.25) and no higher-priority action applies.

### B.9 NBA engine and structured output (§§11, 18)

`decideNextBestAction(state)` is pure and deterministic, versioned `nba-1`. It runs in the
`lead.score` job (stored on the assessment) **and** at turn time in the orchestrator, after
interpretation.

```json
{
  "current_goal": "B_BOOK_MEETING",
  "intent_state": "BOOKING_READY", "intent_score": 78,
  "known_dimensions": [{"dimension":"USE_CASE","state":"CONFIRMED"}, {"dimension":"COMPANY_SIZE","state":"INFERRED"}],
  "unknown_required_dimensions": ["TIMING"],
  "next_action": "CTA_BOOK",
  "question_intent": null,
  "reason": "Lead asked to book; threshold met (USE_CASE + COMPANY_SIZE). Booking is not slowed by an optional question.",
  "expected_information_gain": 0,
  "qualification_score": 71, "qualification_completeness": 0.67,
  "confidence": 0.82,
  "alternatives": [{"action":"ASK","intent":"TIMING.START_WINDOW","value":0.31}],
  "engine_version": "nba-1"
}
```

`next_action` ∈ `ANSWER | ASK | ANSWER_AND_ASK | INFORM | CTA_BOOK | CTA_CHECKOUT | CTA_SIGNUP |
ESCALATE | WAIT | NURTURE | DISQUALIFY | NO_ACTION`. Decision rules, first match wins.

> **Amended 2026-09-27 (owner decision: human hand-over is the last resort).** `ESCALATE` is kept
> only for the lead asking for a person, a complaint, an emergency, a legal or contract question,
> a VERIFY asked twice unanswered, and rules the workspace configured itself (offer hand-off
> rules, escalation conditions, goal A). Everything else continues; the NBA's optional
> `assist_reason` asks a person to do one thing in the background (`agent/types.ts`
> `ASSIST_REASONS`). A lead flagged `QUALIFICATION_REVIEW` gets no CTA until a person clears it.
> Rows 3, 4, 8, 10 and 12 below and goal E read as amended.

| # | Condition | Action |
|---|---|---|
| 1 | Binding verdict (`classifyDeterministic`) | Existing handling; NBA records it |
| 2 | Suppressed, opted out, or intent `NEGATIVE` | `NO_ACTION` (stop follow-up); `DISQUALIFY` if the goal requires it |
| 3 | Engine `NOT_QUALIFIED`, or a disqualifier met on a **CONFIRMED** fact | `DISQUALIFY` (+ suppress if the offer says so). A `reviewInstead` disqualifier: `assist_reason = QUALIFICATION_REVIEW`, the plan continues. An INFERRED fact goes to a VERIFY question; asked twice unanswered ⇒ `ESCALATE` |
| 4 | The lead asked for a person, a legal or contract objection, an offer hand-off rule, a workspace escalation condition | `ESCALATE` with an existing `HandoverReason`. A security/procurement step or an engine REVIEW sets `assist_reason` and continues; value above threshold and goal E close with a meeting (rules 7 and 10) |
| 5 | The lead asked a question | `ANSWER`; then `ANSWER_AND_ASK` only if rule 9 yields a question with V ≥ 0.4 |
| 6 | Intent `NOT_NOW` | `WAIT` (resume job at `resume_at`) → goal F on resume |
| 7 | `BOOKING_READY` and goal ∈ {B, E} | `CTA_BOOK`. Ask **at most one** gating question first, and only if a disqualifier dimension is unknown |
| 8 | `PURCHASE_READY` and goal ∈ {C, D} | `CTA_CHECKOUT` / `CTA_SIGNUP` through the existing `checkoutGate`; refused ⇒ `INFORM` + `SEND_ORDER_DETAILS` assist (a colleague sends the details; the AI keeps the conversation) |
| 9 | Best question V ≥ 0.25 and the threshold is not met | `ASK` (question_intent) |
| 10 | Threshold met | Goal CTA (A ⇒ `ESCALATE` with a qualified brief; E ⇒ `CTA_BOOK`, the meeting is the hand-off; C/D without direct close ⇒ as rule 8) |
| 11 | Intent `LOW` / `NO_DETECTED_INTENT` | `INFORM` (value line from the offer card + soft CTA) or `WAIT` |
| 12 | Otherwise | `INFORM` (one useful point, a soft next step) |

**The trees (§11)** are the `branches` on intents plus rule 10: the plan stops as soon as the
goal's threshold is met, *or* as soon as a disqualifier is confirmed.

### B.10 Goal routing A–G (§12)

| Goal | Resolved from | Motion(s) | Close target / tool | Terminal |
|---|---|---|---|---|
| A Qualify only | `conversion_goals.type` HUMAN_HANDOVER / CUSTOM with `qualification_required`, or offer `goal` | any | `ESCALATE` with the handoff brief (`buildLeadBrief`) | QUALIFIED + handover `POLICY` |
| B Book meeting | BOOK_APPOINTMENT / BOOK_DEMO / BOOK_SITE_VISIT | BOOK_MEETING_B2B, LOCAL_SERVICE, HIGH_TICKET_B2C | `CHECK_AVAILABILITY`, `SEND_BOOKING_OPTIONS` (mode `BOOKING_ASSISTANCE`) | `meeting.booked` / `meeting.pending` |
| C Direct sale | DIRECT_PURCHASE | ECOMMERCE_DIRECT, DIRECT_B2B | `PROPOSE_CHECKOUT` via `commercial_authority` | checkout sent, or `READY_TO_BUY` |
| D Signup / trial | DIRECT_SIGNUP | SAAS_SELF_SERVE | `PROPOSE_CHECKOUT` with an approved signup link | same |
| E Human closer | offer `goal`, or ENTERPRISE motion, or value > threshold | ENTERPRISE, DIRECT_B2B | `CTA_BOOK`: the AI books the meeting with the person who closes, with the hand-off brief attached (`MEETING_BRIEF` assist). Amended 2026-09-27; was `ESCALATE READY_TO_BUY` | meeting booked |
| F Nurture / reactivation | NOT_NOW, LOW intent, reactivation reply | any | modes `FOLLOW_UP` / `REACTIVATION`; the plan starts from stored facts and stale facts become VERIFY intents | back to B–E |
| G Disqualify | engine NOT_QUALIFIED / confirmed disqualifier | any | `stopFollowUp`; `lead.suppress` only for opt-out, wrong person or a disqualifier with `suppress:true` | reason in `qualification_reason` + `opportunities.outcome_reason` |

**Order:** `leads.conversion_goal_type` → offer profile → workspace default `conversion_goals.is_default`
→ `closeTargetForMotion` ([stages.ts:123](../../src/lib/opportunities/stages.ts#L123)).

### B.11 Answer interpretation (§14)

`interpret(reply, state)` → `Interpretation`:

| Step | Deterministic first | AI assist (optional) |
|---|---|---|
| 1 | `classifyDeterministic`: binding ⇒ stop | — |
| 2 | The current question: `matchAnswer` (existing) ⇒ CONFIRMED fact + `qualification_answers` row | Existing `matchAnswerWithAi`, re-validated (**fix Q-D1:** store `source:'ai_assist'` + confidence) |
| 3 | **Every** unknown dimension: `extractors.ts` (timeline, money, count, postcode, role mention, provider / competitor from offer profile, service name, urgency, dissatisfaction, readiness) ⇒ INFERRED facts (CONFIRMED when unambiguous and self-stated, e.g. "we're 40 staff") | One `answer_extraction` call (nano; same task, multi-dimension schema): `[{dimension, value, evidence_span, confidence}]`. Accepted only if `evidence_span` is a verbatim substring, the dimension's validator accepts the value, and confidence ≥ 0.85 ⇒ **INFERRED only**. Gated by `aiAssistEnabled && allowAiInterpretation` + tier |
| 4 | Signals (§B.3) and objections (`matchObjection`) | Intent label (existing `intent_classification`), a hint only |
| 5 | Output: `answeredQuestionId`, `completeness` (FULL / PARTIAL / NONE / DEFLECTED), `facts[]`, `signals[]`, `objections[]`, `leadAskedQuestion`, `requestedAction`, `intentDelta`, `closeInstead` | — |

Deterministic rules decide: a required configured question answered only by AI and not matched ⇒
the engine sees no value ⇒ REVIEW (or PENDING when required) ⇒ the question is asked again in
other words, twice at most, then a hand-over (amended 2026-09-27; was an immediate
`QUALIFICATION_REVIEW` handover). The agent's
`extracted[]` keeps its 5-field whitelist for lead columns. Dimension facts come only from
`interpret()`, never from the model's free proposal.

### B.12 Confirmed / inferred / unknown / conflicting (§15)

| State | Set when | Effect |
|---|---|---|
| CONFIRMED | The lead's answer to that dimension's intent; an exact form-answer match; a manual set | Never asked again; may drive DISQUALIFY and booking gates |
| INFERRED | Lead field, enrichment, CRM, AI ≥0.85, incidental mention | Not asked. If **material** (BUDGET, AUTHORITY, LOCATION under a service-area rule, any dimension named by a `hard_fail` or disqualifier, `requiredDimensions`), a VERIFY intent is ranked ("Just to check, is it around 40 staff?") before it can gate anything |
| UNKNOWN | No live fact | Ranked normally. Counts toward completeness, not as negative |
| CONFLICTING | Two live facts with different normalised values, neither superseding | Always a CLARIFY intent. Excluded from the score and gates until resolved. Shown in the UI |

**Validity windows:** TIMING until the stated date + 14 d; BUDGET and AUTHORITY 180 d;
CURRENT_SOLUTION 365 d; others none. An expired fact becomes a "last known" INFERRED fact. This is
how nurture remembers without restarting from zero and without trusting stale facts.

### B.13 Pre-send QA (§16)

`qa.ts`: deterministic checks run inside `validateResponse` / `lintStyle` against the NBA and the
fact state. Failure ⇒ correction prompt ⇒ retry, up to three drafts ⇒ handover (the existing
loop; three drafts since 2026-09-27).

| # | Check | Deterministic test | Code |
|---|---|---|---|
| 1 | Necessary | The asked dimension (from `DIMENSION_RULES` over the draft's question sentence) = NBA `question_intent.dimension` | `QA_UNPLANNED_QUESTION` |
| 2 | Already known | Asked dimension ∈ CONFIRMED / INFERRED-non-material | `QA_ASKS_KNOWN` |
| 3–5 | Business / offer / intent / stage fit | The intent's `appliesTo` and `stages` hold; forbidden intents; prematurity > 0.6 | `QA_OFF_PROFILE`, `QA_FORBIDDEN_INTENT`, `QA_PREMATURE` |
| 6 | Intrusive | `PROTECTED_FEATURE_PATTERN` ([lead-score.ts:146](../../src/lib/scoring/lead-score.ts#L146)) + personal-finance wording on B2B | `QA_INTRUSIVE` |
| 7 | Generic | Blocklist ("how can I help", "anything else", "tell me more") when an intent was planned | `QA_GENERIC` |
| 8 | Form-like | >1 question (existing), ≥4 enumerated options on SMS, "Q1/Q2" patterns | `STYLE_MULTIPLE_QUESTIONS`, `QA_FORM_LIKE` |
| 9 | Channel-natural | Existing `CHANNEL_LIMITS` + no markdown lists on SMS / WhatsApp | `TOO_LONG`, `QA_CHANNEL` |
| 10 | Responds to what was said | Inbound had a question ⇒ the draft has a non-question sentence | `QA_IGNORES_LEAD` |
| 11 | Answer their question first | …and that sentence comes before the question | `QA_QUESTION_FIRST` |
| 12 | Should close instead | NBA ∈ CTA_* and the draft asks a qualifying question | `QA_SHOULD_CLOSE` |
| 13 | No repetition | Same dimension as an unanswered question in the last 2 outbound messages | `QA_REPEAT` |

**Linked pairs (§10):** not implemented. Two questions stay a lint failure. The brief allows two
"only when naturally linked"; the evidence for over-questioning is stronger than the gain, and the
exception would weaken check 8.

### B.14 Qualification score (§13): one score, not two

Keep `lead-score.ts` as the single score (`ls-v2`). Change it as follows:

| Change | Detail |
|---|---|
| Brief profile | New scoring profile `QUALIFICATION_DEFAULT` = need 20, offer-fit 20, intent 20, timing 15, commercial 10, decision access 10, engagement 5. FIT is relabelled "Offer fit" and computed against the offer profile. Archetype profiles keep their shapes; motion adjustments unchanged |
| Per-dimension `status` | `KNOWN_POSITIVE` / `KNOWN_NEGATIVE` / `UNKNOWN` / `CONFLICTING`, from facts, not from points |
| Completeness | Share of the plan's required + threshold dimensions CONFIRMED or non-material INFERRED; stored on the assessment and `leads` |
| UNKNOWN ≠ NEGATIVE | UNKNOWN earns 0 points but is labelled unknown, lowers confidence, and never triggers a veto; only KNOWN_NEGATIVE caps |

### B.15 Analytics and self-improvement (§17)

| Piece | Design |
|---|---|
| Features | `MessageFeatures` **v2** (`learning/features.ts`) adds `questionIntent`, `dimension`, `wordingFamily`, `questionPosition`, `intentState`, `goal`, `offerId`, `nbaAction`, `strategyVersion`. Written where v1 is written ([orchestrator.ts:509](../../src/lib/agent/orchestrator.ts#L509), [automation-advance.ts:625](../../src/lib/jobs/handlers/automation-advance.ts#L625)). No migration: `messages.features` is jsonb |
| Outcomes (joined, never copied) | Response = inbound ≤72 h; meaningful answer = a fact whose `source_ref` is that inbound and whose dimension matches; drop-off = no inbound ≤7 d; progression = threshold met / stage advance; booking; won; unsubscribe / complaint (a negative constraint) |
| Read model | `src/lib/analytics/question-performance.ts`, sliced by industry, archetype, offer, intent key, wording family, position, channel and intent state; `n < 30` ⇒ low-sample flag (the v4-metrics convention) |
| Experiments | `experiments.kind = QUESTION_STRATEGY`; variants map intent key → wording family or strategy version; primary metric BOOKING / WIN, **never replies**; ≥100 per arm; no automatic change (the existing governance) |
| Versioning | `QI_LIBRARY_VERSION`, `nba-1`, `qv-1`, `ie-1` on every assessment and feature row. A strategy changes only by a reviewed code change or a person applying an experiment result |

### B.16 Token accounting (§18)

| Measure | How |
|---|---|
| Zero-token decisions | NBA, intent, facts and QA are pure. `WAIT`, `NO_ACTION`, `DISQUALIFY` (no message) and templated `ESCALATE` acknowledgements **skip the model call** |
| Smaller prompt | The strategy block renders from the NBA (≤150 tokens). The known-list is summarised by dimension, not by question text |
| Measured | `decision_json.nba.action` on `conversation_agent_runs` + the existing per-run token columns ([agent/audit.ts:254](../../src/lib/agent/audit.ts#L254)) ⇒ tokens per turn by action, and model calls avoided |
| Regression | Update `prompt-token-snapshot.json` (`agent_decision`, `answer_extraction` multi-dimension); a test that the NBA block is ≤150 tokens and `agent_decision` grows ≤5% |
| Budget | `answer_extraction` multi-dimension keeps the nano tier; its envelope in `TASK_TOKEN_ENVELOPES` rises to 900 in / 200 out ([tiers.ts:72](../../src/lib/ai/tiers.ts#L72)) |

### B.17 Lead Detail UI (§19)

| Surface | Content | File |
|---|---|---|
| Right rail: **Next best action** card | Action, reason, "Why this question?" (value terms in words), alternatives, confidence, engine version | new `components/leads/detail/next-best-action-card.tsx` |
| Qualification tab → **Intent** section | State badge, score /100 with the 5 category bars, evidence list (reason, source, age, decayed %), contradictions, `valid_until` | new `intent-panel.tsx`; loader in `lib/leads/detail-queries.ts` |
| Qualification tab → **Dimensions** | Confirmed / Inferred / Unknown / Conflicting (replaces Known / Inferred / Missing), completeness, asked-question history from `messages.features` | `lead-page-tabs.tsx` |
| Overrides (audited service ops) | Confirm or reject an inferred fact, set a fact, resolve a conflict, override intent state (with reason + expiry), mark disqualified | dialogs in `components/leads/detail/` |
| Leads list | Filters: intent state, minimum intent score, completeness below X | `lead-filter-popover.tsx`, `operations/leads.ts` `lead.search` schema |
| Badges | Intent-state tone mapping in the **one** mapping file | `components/ui/badge.tsx` |

All six route states apply. The Intent section is empty when the engine is off or the lead has not
been assessed yet.

### B.18 Settings (§20)

Stored as `workspace_sales_overrides` `QUALIFICATION_POLICY` (`*` and `service:<uuid>`),
`QUALIFICATION_QUESTION` (custom / forbidden intents) and `DISQUALIFIER`. All zod-validated in
`settings/ai-selling.ts`.

| Brief item | Where |
|---|---|
| Goal, depth, framework, required dimensions, booking / direct-sale / handoff thresholds, escalation conditions, min/max autonomy, AI budget | Settings → AI & selling → new "Qualification policy" card (depth, methods and budgets already exist; link, don't duplicate) |
| Custom and forbidden question intents, disqualification criteria, offer-specific rules, industry profile override | Follow-Up → Qualification, per service (`service-scope-card.tsx`, `question-row.tsx` get dimension and intent pickers) |
| Autonomy | Reuse `agent_mode`. Policy can only **narrow** it; widening stays in the existing Settings flow (the `widensAutonomy` rule, tracker 8.25b) |

### B.19 Copilot and service operations (§21)

Each is one registry entry + one handler in the new `services/operations/qualification.ts`. The
agent is excluded from every write.

| Operation | Risk | Callers | Answers |
|---|---|---|---|
| `lead.qualification_explain` | READ | UI, COPILOT, MCP, API | "why are we asking this", "what do we still need", "is this lead qualified" |
| `lead.intent_explain` | READ | UI, COPILOT, MCP, API | state, evidence, contradictions, decay |
| `lead.requalify` | SAFE_WRITE | UI, COPILOT, MCP, API | re-run engine + intent + NBA (queues `lead.score`, like `lead.rescore`) |
| `lead.set_qualification_fact` | REVERSIBLE_WRITE (member) | UI, COPILOT (confirm), MCP, API | overrides; audit before/after |
| `lead.override_intent` | REVERSIBLE_WRITE (member) | UI, MCP | manual state with expiry |
| `qualification_policy.get` / `.update` | READ / REVERSIBLE_WRITE (admin) | UI, COPILOT, MCP, API | "don't ask about budget for these leads", "require employees before MSP booking". Copilot may only **narrow** (add a forbidden intent or a required dimension); lowering thresholds or widening autonomy is UI-only |
| `lead.search` (extended) | READ | existing | "show strong intent + incomplete qualification" (`intentStateIn`, `minIntentScore`, `maxCompleteness`) |
| `question_performance.get` | READ | UI, COPILOT, MCP, API | per-intent metrics with low-sample flags |

---

### B.20 Several interests per lead (2026-09-27)

A lead may want more than one offer (a subscription and a one-off project).
Each is an interest: one opportunity per (lead, service) with its own goal,
motion, stage, close target, qualification state and NBA
(`interests.ts`; migration `0144_lead_interests.sql`, not applied at writing).

- **Detection** (`detectInterests`): the lead's own service, services its
  messages name (`servicesMentioned`, negation-aware), services a submitted
  form selected, a person's `opportunity.add_interest`, existing interest
  opportunities. Recorded as CONFIRMED `SERVICE_NEEDED` facts per service.
- **Fact scope**: `SHARED_DIMENSIONS` are asked once for all interests;
  every other dimension is per interest (`factsForInterest`,
  `factsInMergeScope`, `attributeReply`). One interest: unchanged.
- **Planning** (`planInterests`): the unchanged pipeline per interest. The
  lead's conversion goal and estimated value apply to its own service; an
  offer that sets its own motion closes with that motion's default goal.
- **Coordination** (`coordinateInterests`): lead-level rules first, then the
  interest closest to its close, then the one just named, then value; a
  checkout may carry one light touch (`companionFor`). `interestStrategyLines`
  and `QaContext.companionQuestion` keep it to one clear call to action and
  one question.
- **Closing**: each interest's own checkout link and meeting type; winning one
  keeps the others open (0144 `close_opportunity` with `open_remaining`);
  follow-up continues while any is open (`followUpContinues`).
- **Tests**: `tests/multi-interest.test.ts` (detection, scope, coordinator,
  closing, CRM deal plan) and the golden conversation
  `tests/golden-conversations/multi-interest/` (subscription closed by
  sign-up, website meeting booked, no shared fact asked); live story S.

## C. Phased build plan

### C.1 Shape

**Phase 0 (contracts, one agent, lands first)** → **Wave 1 (4 agents in parallel, disjoint files)**
→ **Wave 2 (integration: A3 + A4 wire live)** → **release gates**. The engine ships behind a
per-workspace flag in **shadow mode** first: the NBA is computed and stored beside the current
selection, differences are logged, and the flag flips after the gates pass.

### C.2 Phase 0: contracts (Agent A1, ~0.5 day)

| Owns | Output |
|---|---|
| `supabase/migrations/0134_qualification_intelligence.sql` (number re-checked) | §B.2 in full, RLS + grants, anonymise-trigger extension |
| `src/lib/qualification-intelligence/types.ts` | All shared contracts and version constants. **Read-only for everyone after Phase 0** |
| `src/lib/supabase/database.types.ts` | Regenerated from a local stack |
| `tests/migrations.test.ts` (append), `tests/rls-new-tables.test.ts` (append) | Tables, RLS and CHECK constraints |

### C.3 Wave 1: file ownership

Every path below belongs to exactly one agent. Shared hot files have a single owner:
`package.json` belongs to the **coordinator**, who adds all test files at merge time.

| Agent | Scope | Owns (create or edit) | Tests it adds |
|---|---|---|---|
| **A1: Intent + facts + recalculation** | §§3–5, 13, 15 | `qualification-intelligence/{signals,decay,intent,facts}.ts`, `qualification-intelligence/service.ts`; `scoring/lead-score.ts` (status, completeness, INTENT from the assessment, `ls-v2`), `scoring/service.ts`, `scoring/answer-features.ts`, `scoring/tags.ts`; `events/types.ts` (`RESCORE_ON`, `opportunity.stage_changed`, `lead.intent_changed`, `intent.decay_due`); `events/outbox.ts`; `opportunities/service.ts` (stage event only); `jobs/handlers/lead-score.ts`; new `jobs/handlers/intent-sweep.ts`; `jobs/queue.ts`, `jobs/register.ts`; `app/api/cron/worker` scheduling of `intent.sweep` | `tests/intent-engine.test.ts` (states, caps, the pricing + "not interested" contradiction, FIT/INTENT disjointness), `tests/intent-decay.test.ts`, `tests/qualification-facts.test.ts`; updates to `tests/lead-score.test.ts`, `tests/domain-events.test.ts` |
| **A2: Offer, library, value, NBA, goals, interpretation** | §§1–2, 6–12, 14 | `qualification-intelligence/{offer-profile,question-intents,question-value,goals,nba,interpret,extractors}.ts`; `sales-library/types.ts`, `sales-library/qualification-dimensions.ts`, `sales-library/archetypes.ts` (profiles), `sales-library/motions.ts`; `qualification/next-question.ts` (delegates to `question-value`, keeps its API); `jobs/handlers/qualify.ts` (form answers from `lead_touches`, facts, `dimension_key` map, real stage) | `tests/offer-profile.test.ts`, `tests/question-value.test.ts`, `tests/nba.test.ts`, `tests/answer-interpretation.test.ts`, **`tests/qualification-matrix.test.ts` + `tests/qualification-intel/matrix.ts` (the generator)**; updates to `tests/adaptive-qualification.test.ts`, `tests/sales-library.test.ts` |
| **A3: Runtime, QA, grader, analytics, tokens** | §§10, 16–18, 23–24 | `qualification-intelligence/{qa,grade}.ts`; `agent/strategy.ts`, `agent/orchestrator.ts`, `agent/context.ts`, `agent/validate.ts`, `agent/types.ts`; `jobs/handlers/message-inbound.ts` (Q-D1 fix + `interpret()` on the non-agent path); `ai/schemas.ts`, `ai/prompts.ts`, `ai/tiers.ts`; `learning/features.ts`, `learning/experiments.ts`, `learning/experiments-service.ts`; new `analytics/question-performance.ts`; `tests/fixtures/prompt-token-snapshot.json` | **`tests/golden-conversations.test.ts` + `tests/golden-conversations/*.json` (the harness)**, **`tests/question-grader.test.ts` + `tests/fixtures/question-grades.json` (held-out labels)**, `tests/question-qa.test.ts`, `tests/question-performance.test.ts`; updates to `tests/agent-strategy.test.ts`, `tests/agent-evals.test.ts`, `tests/token-budget.test.ts` |
| **A4: Surfaces, settings, ops** | §§19–21 | `services/registry.ts`, new `services/operations/qualification.ts`, `services/operations/leads.ts` (search filters), `services/index.ts` (import the new operations file); `lib/leads/detail-queries.ts`; `components/leads/detail/*` (new `intent-panel.tsx`, `next-best-action-card.tsx`, override dialogs, `lead-page-tabs.tsx`); `components/leads/lead-filter-popover.tsx`; `components/ui/badge.tsx`; `settings/ai-selling.ts`, `ai-selling-actions.ts`, `ai-selling-queries.ts`; new `components/settings/ai-selling/qualification-policy-card.tsx`; `components/qualification/{question-row,service-scope-card}.tsx`, `qualification/actions.ts`, `qualification/types.ts`; `content/help/qualifying/*` | `tests/qualification-ops.test.ts` (roles, callers, the narrow-only Copilot rule, audit), `tests/qualification-policy-settings.test.ts`; updates to `tests/phase5-surfaces.test.ts`, `tests/services.test.ts`, `tests/copilot.test.ts` |

**Dependencies inside Wave 1:** all four code against `types.ts`. A3 builds `qa.ts`, `grade.ts`,
features and analytics first. It wires `nba()` / `interpret()` into the orchestrator once A2 merges
(Wave 2). A4 builds against the contracts with a fixture loader, then points at A1's storage
(Wave 2).

### C.4 Test harnesses

| Harness | Owner | Design |
|---|---|---|
| **Matrix generator** (§22) | A2 | 7 profiles (roofer / LOCAL_SERVICE, MSP / BOOK_MEETING_B2B, B2B_SAAS / SAAS_SELF_SERVE, ACCOUNTING, ECOMMERCE / ECOMMERCE_DIRECT, ENTERPRISE_SAAS / ENTERPRISE, CREATIVE_WEB_STUDIO / DIRECT_B2B) × intent 8 (none / weak / medium / strong / explicit / contradictory / stale / negative) × information 5 (empty / partial / threshold met / conflicting / stale facts) × role 5 × behaviour 9 (asks price, asks to book, one word, deflects, objection, not now, off-topic, asks a question, silent) × goal 7 = **88,200 cases** through the pure pipeline (~seconds). Invariants: never asks a CONFIRMED dimension; NEGATIVE ⇒ no ASK/CTA; BOOKING_READY + goal B ⇒ CTA_BOOK or ≤1 gating question; confirmed disqualifier ⇒ no pursuit; no MEDDPICC-only dimensions on LOCAL_SERVICE; no BUDGET before a problem dimension; stale TIMING ⇒ VERIFY, not a blind re-ask. Default run = all-pairs subset; `MATRIX_FULL=1` runs everything |
| **Golden conversations** (§23) | A3 | ≥3 conversations per archetype above (21+). Each is a JSON per-turn table: lead message → expected facts (+state), intent state, NBA action, question intent or none, forbidden intents, QA verdict on a canned candidate reply. Deterministic by default; `EVAL_LIVE=1` reuses `tests/evals/live-hook.ts`. Asserts the 8 behaviours in §23 |
| **Question grader** (§24) | A3 | `grade.ts` /100: necessity 15, not-known 15, stage fit 10, intent fit 10, friction 10, channel naturalness 10, responsiveness 10, specificity 8, single focus 7, progression 5. **Critical failures** (grade = 0): asks a known dimension, asks a forbidden intent, multiple questions, qualifies when booking-ready, pursues a negative or disqualified lead. Threshold 80. Anti-gaming: the labelled fixture is written separately from the implementation, scores come from structured state (not wording alone), and a mutation test proves each criterion can fail |

### C.5 Release gates (§25), mapped to evidence

| Gate | Evidence |
|---|---|
| Intent signals + explainable evidence + decay | `intent-engine`, `intent-decay`; lead page Intent section |
| Differs by industry / offer / goal; adapts to answers; no repeats; stops correctly | matrix invariants + golden conversations |
| Scoring; UNKNOWN ≠ negative | `lead-score` status tests |
| NBA routing; no over-qualification; direct-sale transition; nurture remembers; suppression / disqualification | `nba`, matrix, `direct-close` (existing), golden F / G cases |
| UI, Copilot | `phase5-surfaces`, `qualification-ops` |
| Agent on the same source of truth | Orchestrator reads `lead_assessments` / NBA; test that strategy `nextQuestionId` = NBA `question_intent` |
| Token cost measured | token-budget snapshot + tokens-by-action read model |
| Question analytics | `question-performance` |
| Regression | Full `npm test`, `tsc`, lint, build; shadow-mode diff report reviewed before the flag flips |

Rough size: Phase 0 0.5 d; A1 4–5 d; A2 5–6 d; A3 5–6 d; A4 4–5 d; Wave 2 2–3 d. About 3 weeks
elapsed with 4 agents.

---

## D. Honest risks and limits

| # | Risk or limit | Consequence and handling |
|---|---|---|
| D1 | **Behavioural intent has almost no lawful data source today.** There is no site snippet, pixel or click tracking; `opened_at` has no writer. A snippet would need PECR reg. 6 consent on the *customer's* site (a consent banner we don't control), plus visitor-to-lead identity resolution. Open tracking is unreliable (Apple Mail Privacy Protection) and is itself reg. 6 tracking. | Behavioural stays capped at 20 and is usually 0. States are calibrated so HIGH needs no behavioural points. Only first-party data the lead submitted is used (converting `landing_url`, repeat submissions). **The UI copy promising a tracking snippet must be removed or marked "not yet available"** (CLAUDE.md: never fabricate). Tracking is a separate, owner-approved project. |
| D2 | Third-party intent data (Bombora-style), LinkedIn profile views and CRM activity timelines are unavailable. We have no licence; the LinkedIn Community Management API covers the customer's own posts only; CRM pull imports records, not activity. | CONTEXT signals come only from Find Leads' permitted sources (Companies House, company websites, provider APIs), as input. |
| D3 | Profiling and automated decisions. A disqualify + suppress decision is automated profiling. For B2C motions (HIGH_TICKET_B2C) it could be a "similarly significant" effect under UK GDPR Art. 22 (as amended by DUAA 2025). | Disqualify only on CONFIRMED facts; INFERRED ⇒ REVIEW. Every decision explainable and overridable. Assessments included in the DSAR export and the anonymise path. Privacy notice names profiling. Never use protected features (existing allow-list plus `QA_INTRUSIVE`). |
| D4 | The AI extractor could hallucinate. | Verbatim `evidence_span` check, deterministic re-validation, INFERRED-only status, material facts must be verified, and the engine verdict never reads AI facts. |
| D5 | Statistical power. Most workspaces will never reach 100 leads per arm per question intent, and learning must stay workspace-level (features.ts; no pooling without a legal basis and a DPA update). | Per-workspace results will mostly read "not enough evidence". Library-level improvement happens offline through the golden sets and graders, with reviewed releases. Do not promise "self-learning" in marketing. |
| D6 | Behaviour change for live workspaces: the new value formula, sticky limit and NBA change which question is asked. | Shadow mode + per-workspace flag, versioned engines, diff report. Existing `adaptive-qualification` expectations are updated deliberately, not silently. |
| D7 | The dual score shapes (existing archetype profiles vs the brief's §13 default) could confuse customers. | One score. The brief's shape is the default profile; archetype shapes remain explicit and are shown in `lead.score_explain`. |
| D8 | Load. `lead.score` gets heavier, and the sweep touches many leads. | Batch-limited sweep; `valid_until` index; the assessment only writes when state, score band or NBA changes, plus an hourly heartbeat. |
| D9 | Parallel sessions: migration-number collisions, and the Find Leads agent is editing `intent_events` / `prospect_intent_matches` right now. | Re-check the number at write time. Read Find Leads tables only through a narrow adapter in `signals.ts`. Never alter their schema here. |
| D10 | "Two questions when linked" (§10) and "optimise for replies" (§17) conflict with evidence-based rules already in the code. | Deliberately not implemented; recorded as decisions. |
| D11 | Existing defects this work depends on: **Q-D1** (AI-matched answers stored as `reply`), **F3** (form answers never used), **F9** (override kinds unread), and the tracking-snippet copy (D1). | Fixed inside A3 (Q-D1), A2 (F3, F9 reader) and A4 (copy), each with a failing test first. |

---

## E. Contract decisions (Phase 0, 2026-09-26)

Phase 0 delivered `supabase/migrations/0134_qualification_intelligence.sql` (written, not applied)
and `src/lib/qualification-intelligence/types.ts` (frozen for Wave 1), held equal by
`tests/qualification-intel-contract.test.ts`. The owner has since confirmed that all 25 sections
are built and wired into the live agent: the engine becomes the agent's source of truth once the
§C.5 gates pass. SHADOW is a rollout stage, not a permanent mode. Where the design was ambiguous,
the option most consistent with the existing code was chosen:

| # | Decision | Why |
|---|---|---|
| CD-1 | **CONTEXT signals feed the BEHAVIOURAL component** (cap 20). `CATEGORY_SCORE_COMPONENT` in types.ts | §B.4 has five capped components and no CONTEXT cap. Funding and hiring are observed, not said, so they sit with behaviour, not with conversation. |
| CD-2 | **`category` has 4 values (§B.2), not 5.** Negative types keep the category they were observed in: said ⇒ EXPLICIT, `NO_SHOW` ⇒ BEHAVIOURAL, `OPPORTUNITY_LOST` ⇒ CONTEXT. `polarity` is what makes a signal negative, and zod enforces that NEGATIVE polarity applies exactly to the negative types | §B.2 is the table spec; §B.3's "NEGATIVE (−)" row is a grouping for reading, not a category. |
| CD-3 | `NEUTRAL` polarity is allowed but unused by default. It is reserved for evidence-only rows that must not score | §B.2 lists it; no initial type needs it. |
| CD-4 | **Added `lead_intent_signals.flat_until`** (not in §B.2) | §B.5 needs "flat until the stated date + 7 d" for TIMEFRAME. Without it, the stated date could only be recovered by arithmetic on `expires_at`. NOT_NOW sets both `resume_at` and `flat_until`. |
| CD-5 | **Fact `state` stores CONFIRMED / INFERRED / CONFLICTING / REJECTED. UNKNOWN is never stored.** The derived per-dimension status is `DIMENSION_STATUSES` = CONFIRMED / INFERRED / UNKNOWN / CONFLICTING | §B.2 vs §B.12: UNKNOWN is the absence of a live fact. REJECTED records a person rejecting an inference, so the inference is not re-made. |
| CD-6 | **Dimension `UNMAPPED`** is allowed on facts only, and only with a `custom:<question id>` intent key | A configured question with no dimension (§B.7) still needs its answer mirrored. The synthetic key survives the question being deleted, and `question_id` is set to null on delete. |
| CD-7 | The six new dimension keys are listed in the contract as `QI_ADDED_DIMENSION_KEYS`. `QI_DIMENSION_KEYS` = library ∪ added, de-duplicated. **A2 still adds them to `QUALIFICATION_DIMENSION_KEYS` and the catalogue** (it owns `sales-library/`) | "Extend, don't duplicate": the contract never redefines the 20 library keys. The union stays stable when A2 lands. |
| CD-8 | **AI never confirms**, enforced at three layers: a DB CHECK (`source='AI_ASSIST'` ⇒ not CONFIRMED), the fact write schema, and the interpretation schema (verbatim `evidence_span`, confidence ≥ 0.85) | CLAUDE.md resolved conflict 1, §B.11, D4. |
| CD-9 | **Rollout flag** = `engineMode` OFF / SHADOW / LIVE in the `QUALIFICATION_POLICY '*'` payload. There is no new column. Default: `defaultEngineMode()` = SHADOW until `QI_RELEASE_GATES_PASSED` is flipped by a reviewed change, then LIVE for any workspace without a stored value. An explicit stored value always wins | Owner direction. The flag reuses the policy store that §B.18 already defines. |
| CD-10 | `lead_assessments` gained **`engine_mode`** (SHADOW / LIVE) and **`legacy_decision`** (SHADOW only, ≤4 KB) | Shadow mode needs the diff report (§C.1). OFF writes no assessment. |
| CD-11 | **`record_lead_assessment()` RPC** (security definer, service role only), in the `record_lead_score` pattern. It serialises per lead, is idempotent on (lead, trigger_event, engine_version), refuses anonymised leads, and always writes the lead's denormalised columns (both modes). Mode governs only whether the agent acts | This is the one writer of `leads.intent_*`, so the list, the Lead page and the assessment can never disagree. |
| CD-12 | `engine_version` = `QIE_ENGINE_VERSION` = `ie-1+nba-1+qv-1+qi-1+qf-1` | One column carries every component version, and idempotency breaks correctly when any of them changes. |
| CD-13 | The **NBA is snake_case end to end** (`nextBestActionSchema`), as in the §B.9 JSON. Added fields: `rule` (R1–R12), `engine_verdict`, `handover_reason`, `resume_at`, `suppress`, `model_call_required`, `question_value`. `question_intent` is an object (key, dimension, purpose, question_id, wording_family, rendering), not a bare key | The orchestrator needs these to act without re-deriving anything, and the "Why this question?" UI needs the value terms. |
| CD-14 | **Orchestrator integration contract:** `decision_json.qi` on `conversation_agent_runs` = `{ nba, interpretation, accounting }` (`agentRunQiSchema`). No migration: `decision_json` is jsonb. Tokens and cost stay in the run's own columns; `turnAccountingSchema` records the action, the rule, `model_called` / `model_call_avoided`, `shadow_differs`, the strategy-block tokens, the interpretation (AI assist) tokens, QA findings and the question grade | §B.16. The owner's integration requirement: the NBA consumed, the interpretation written back and the accounting are all typed. |
| CD-15 | The **interpretation is written back after every inbound reply**: facts go to `lead_qualification_facts` and signals to `lead_intent_signals`, both with `source_ref` = the inbound message id, and the whole object goes to `decision_json.qi.interpretation` | §B.11 step 5, and the "meaningful answer" join in §B.15. |
| CD-16 | Goal keys are `A_QUALIFY_ONLY` … `G_DISQUALIFY` (the §B.9 example's `B_BOOK_MEETING` form). `CONVERSION_GOAL_TO_GOAL` maps PHONE_CALL and REQUEST_QUOTE to B. HUMAN_HANDOVER and CUSTOM map to A, and `goals.ts` downgrades them to E when `qualification_required` is false. `MOTION_DEFAULT_GOAL`: DIRECT_B2B ⇒ C (it is a direct-close motion in `stages.ts`) | This mirrors `closeTargetForMotion` and `DIRECT_CLOSE_MOTIONS`. |
| CD-17 | `Predicate` is a small serialisable union (known / unknown / equals / in / lt–gte / intentIn / all / any / not) with a zod schema | Branches, prerequisites and disqualifiers are stored as jsonb in offer profiles and policy. No eval. |
| CD-18 | Copilot's narrow-only rule is a pure function, `policyChangeOnlyNarrows(before, after)`. Allowed: add a forbidden intent, a required dimension, an escalation condition or a disqualifier, or lower `maxAutonomy`. Everything else is UI-only | §B.19. A4 calls it from the registry handler. |
| CD-19 | `experiments.kind = QUESTION_STRATEGY`: `target_id` = the `services.id`, or the business id for a workspace-wide experiment. A3 adds the kind to `EXPERIMENT_KINDS` | `target_id` is NOT NULL (0131). |
| CD-20 | **Data rights: cascade + trigger + coverage.** Delete: all three tables cascade on `lead_id`. Anonymise: an AFTER UPDATE OF `anonymised_at` trigger on `leads` (fired by `data_rights_scrub`, same transaction) deletes the lead's signals, facts and assessments. A BEFORE UPDATE trigger clears and keeps clear `leads.intent_*`, and a BEFORE INSERT trigger on each table skips rows for an anonymised lead. `coverage.ts` has three new rules (REMOVE / REMOVE) | 0124's scrub is applied and was not rewritten. See E.1. |
| CD-21 | `leads` SELECT is a column grant (0050), so the five new lead columns are granted SELECT explicitly. There is no UPDATE grant | Without the grant the columns would be invisible to the browser client. |
| CD-22 | `services.offer_profile` is writable by members through services' existing table grant, so readers must use `parseOfferProfile` (safeParse ⇒ `{}` defaults). The DB enforces only object + ≤16 KB | Column-level revokes do not work under a table-level grant. |

### E.1 Follow-ups for the coordinator

1. **`tests/data-rights.test.ts` needs one change.** "every table the rules redact, remove,
   stop or hash is touched by data_rights_scrub" reads only 0124's scrub body, so it reports the
   three new tables as untouched, although the 0134 trigger removes them inside the scrub's
   transaction. Suggested fix: also accept a table deleted by a function that an
   `after update of anonymised_at on public.leads` trigger executes in any migration. Leaving the
   rules out instead would fail "no person-linked table is missing", which is the worse failure.
2. The scrub's `data_rights_actions` summary counts do not include these three tables, because
   the trigger does not report counts. The DSAR export (`data-rights/export.ts`) must add them in
   A1.
3. `database.types.ts` was not hand-edited, because the contract does not need it. Regenerate it
   after applying 0134.
4. Add `tests/qualification-intel-contract.test.ts` to `npm test`.
