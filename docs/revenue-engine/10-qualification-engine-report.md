# 10: Qualification Intelligence & Intent Engine, final report

**Date:** 2026-09-26 (Saturday, finished 22:40 BST). **Updated 2026-09-27** with the live story runs and the first shadow-diff review (§15 R1–R2, §17). **Tracker:** 8.28. **Design:** [08-qualification-intelligence.md](08-qualification-intelligence.md).
**Live evidence:** [09-business-stories-evidence.md](09-business-stories-evidence.md). **Runtime:** [../AGENT_RUNTIME.md](../AGENT_RUNTIME.md).

**Bottom line:**

* The engine is built, wired into the live agent and deterministically tested at scale:
  * 88,200 matrix cases;
  * 24 golden conversations with 0 known gaps;
  * the question grader agrees with all 32 held-out labels.
* It is **not released as the default**. `QI_RELEASE_GATES_PASSED` stays `false` because one gate
  is still open (updated 2026-09-27):
  * ~~the live business stories in LIVE mode~~ **CLOSED:** Q1–Q5 PASS in four full runs, and run
    `704f6b49` (after migration 0137 was applied) met the isolation condition
    (`deployedWorkerTouched: []`) with zero rows left (doc 09);
  * the shadow-diff review: a first review was done on test traffic (8 of 24 SHADOW turns
    differed, all explained). A review on real traffic is still owed.
* **Score: 78/100.**

---

## 1. Existing architecture found

What the discovery (doc 08 §0, §A) found before this programme.

| Area | What existed | Gap |
|---|---|---|
| Question selection | Deterministic adaptive selector (`qualification/next-question.ts`): known and inferred marking, value ranking, threshold stop, depth | Ranked only configured questions; a library dimension with no question could never be asked |
| Known facts | Two lead fields only (postcode, service); memory facts `[]` | Form answers in `lead_touches.answers` were never read (F3) |
| Intent | A `MAX` over five booleans inside the lead score | No signal entity, strength, decay or state |
| Offer | `services` row + archetype + workspace motion | No per-offer profile, goal or disqualifiers |
| Agent | Deterministic strategy block; the model rewords one question; claim validator; one question per message | Only 2 of 13 QA checks; no structured NBA; no path that skips the model when nothing needs saying |
| Score | Lead score v2 with archetype × motion weights | UNKNOWN and NEGATIVE both scored 0; no completeness |
| Learning | Governed experiments, `messages.features` v1 | No question-level features, metrics or versions |
| Tests | Unit tests per motion, 12 guardrail evals | No matrix, golden conversations or grader |

Status at discovery: 1 of 25 sections done, 20 partial, 4 missing.

## 2. Missing functionality

The status of the brief's 25 sections now.

| # | Section | Status now | Evidence |
|---|---|---|---|
| 1–2 | Offer understanding, customer context | Built | `offer-profile.ts`, form answers read (F3 fixed), lead-field provenance (this pass) |
| 3–5 | Intent signals, score, decay | Built; behavioural source limited (see §15) | `signals.ts`, `intent.ts`, `decay.ts`, `intent-sweep` job |
| 6–8 | Dimensions, hierarchy, question intents | Built | 26 dimensions, 95 question intents, 71 archetypes |
| 9, 11 | Question value, adaptive trees | Built | `question-value.ts`, branches, prerequisites, sticky re-ask capped at `MAX_ASKS_PER_INTENT` |
| 10 | One question per turn | Built (unchanged, by decision D10) | `validate.ts`, grader MULTIPLE_QUESTIONS critical |
| 12 | Goal routing A–G | Built | `goals.ts`, NBA R1–R12 |
| 13 | Transparent score | Built | `lead-score.ts` status + completeness |
| 14–15 | Interpretation, uncertainty states | Built; heuristics documented (§15) | `interpret.ts`, `extractors.ts`, `facts.ts` |
| 16 | Pre-send QA (13 checks) | Built | `qa.ts` |
| 17 | Self-improvement | Built as read model and governed experiments; statistically weak per workspace (§15) | `question-performance.ts`, `QUESTION_STRATEGY` experiments |
| 18 | Token control / structured NBA | Built | NBA-only strategy block, zero-token actions |
| 19–21 | Lead UI, settings, Copilot | Built | `intent-panel.tsx`, `next-best-action-card.tsx`, override dialogs, qualification policy card, `qualification.*` operations |
| 22–24 | Matrix, golden conversations, grader | Built | see §12 and §13 |
| 25 | Release gates | Evaluated: **2 open** | see §17 |

## 3. Intent Signal architecture

| Layer | Design |
|---|---|
| Entity | `lead_intent_signals` (0134): type (38), category (EXPLICIT / BEHAVIOURAL / CONVERSATIONAL / CONTEXT), polarity, strength, confidence, source, `source_ref`, half-life, `flat_until`, `expires_at`, `resume_at`, reason, evidence excerpt, rule version, retraction |
| Sources | Reply phrases and readiness (`interpret.ts`); origin (inbound, form goal); converting page on the touch (`/pricing` gives `CONVERTING_PAGE_PRICING`); bookings, opportunities; Find Leads context (read-only adapter) |
| Score | Capped components: Explicit 35, Behavioural 20 (CONTEXT feeds it, CD-1), Conversational 25, Recency 10, Consistency 10. Contradictions **cap**, never sum |
| States | NO_DETECTED_INTENT, LOW, EXPLORATORY, MEDIUM, HIGH (≥70), BOOKING_READY, PURCHASE_READY, NOT_NOW, NEGATIVE, by first-match precedence (doc 08 §B.4) |
| Decay | Per-signal half-life; TIMEFRAME and NOT_NOW flat until the stated date; `valid_until` on every assessment; the `intent.sweep` job re-assesses at the boundary |
| Explainability | Evidence (signal ids + decayed strength), contradictions and confidence are stored on `lead_assessments` and shown in the Intent panel |
| This pass | New BOOKING_REQUEST phrasing: "book someone to come and look", "send someone round", "when can someone come out", "arrange a survey". A pricing page plus "not interested" is NEGATIVE with the pricing visit shown as a contradiction (intent-engine tests) |

## 4. Industry/business/offer qualification hierarchy

| Level | Source | Resolves |
|---|---|---|
| Industry / archetype | `business_profiles.archetype_key` (71 archetypes) | Default plan, wording, gating dimensions |
| Business / motion | `sales_motions` (e.g. LOCAL_SERVICE, BOOK_MEETING_B2B, SAAS_SELF_SERVE, ENTERPRISE, DIRECT_B2B) | Goal default, booking gate, close action |
| Offer | `services.offer_profile` (parsed with `parseOfferProfile`) | Required dimensions, disqualifiers (with `suppress`), thresholds, hand-off rules, customer type |
| Workspace policy | `QUALIFICATION_POLICY` `*` and `service:<id>` overrides | Forbidden and custom intents, required dimensions, escalation conditions, `engineMode` |
| Lead | Lead fields, form answers, conversion goal, facts | What is already known; the lead's own goal |

Layers are unions: a lower layer can never un-forbid what a higher one forbids (`offer-profile.ts`
`resolveOffer`). B8 golden check: the same opening gives at least three different first
questions across seven archetypes.

## 5. Question library architecture

| Item | Detail |
|---|---|
| Intent entity | `QuestionIntent`: key, dimension, purpose (DISCOVER / VERIFY / CLARIFY), prerequisites, `appliesTo`, stages, channels, answer type, extractor, scoring, branches, disqualifies, attributes, wording family, renderings per channel |
| Size | 95 intents over 26 dimensions (20 library + 6 added, CD-7); 15 deterministic extractors |
| Configured questions | A configured question adopts a library intent (`question_intent_key`) or becomes `custom:<id>` (UNMAPPED dimension, CD-6) |
| VERIFY / CLARIFY | Built per lead: "Just to check, is it around {value} staff?" A "yes" confirms the shown value (`withVerifiedAnswer`) |
| Rendering | The NBA carries the channel rendering; the model rewords it and never re-plans |

## 6. Qualification logic trees

| Mechanism | Rule |
|---|---|
| Prerequisites | An intent is askable only when its predicate holds (serialisable `Predicate`, CD-17) |
| Branches | An answer can unlock a follow-up intent or send the lead straight to the close (`branchToCta`) |
| Stop | Stop at the goal threshold (allOf + one of anyOf + required). Stop on a confirmed disqualifier. Never ask past `MAX_ASKS_PER_INTENT` |
| Gating | A booking-ready lead gets at most one gating question (motion booking gate ∪ offer-required ∪ disqualifier dimensions), then the booking |
| Answer handling (this pass) | A direct answer to the planned question, read by a deterministic reader, is **CONFIRMED**, so the lead is never asked to verify what they just said. A reply about something else is **not** filed under the planned intent. Form values the lead typed are CONFIRMED (source FORM), so no VERIFY turn precedes a booking |

## 7. Scoring system

| Score | Shape | Notes |
|---|---|---|
| Intent score /100 | See §3 | Per-state caps. Stored with evidence and confidence |
| Qualification (lead) score | `lead-score.ts` `ls-v2`: need, offer fit, intent (reads the intent assessment), timing, commercial, decision access, engagement; archetype × motion weights | Per-dimension status KNOWN_POSITIVE / KNOWN_NEGATIVE / UNKNOWN / CONFLICTING. **UNKNOWN ≠ NEGATIVE**: unknown earns 0 but never vetoes, and lowers confidence. Completeness stored |
| Question grade /100 | `grade.ts`: necessity 15, not-known 15, stage fit 10, intent fit 10, friction 10, channel naturalness 10, responsiveness 10, specificity 8, single focus 7, progression 5. Five critical failures grade 0. Pass mark 80 | This pass: a lettered menu of 4+ options fails **singleFocus** ("one primary question"). It is deliberately not a critical failure: form-likeness is fixed by rewording, QA check 8 rejects it pre-send, and the held-out label (`sms-multiple-choice-form`: fail, no critical) agrees. No weight was changed |

## 8. Next-Best-Action engine

| Item | Detail |
|---|---|
| Actions (12) | ANSWER, ASK, ANSWER_AND_ASK, INFORM, CTA_BOOK, CTA_CHECKOUT, CTA_SIGNUP, ESCALATE, WAIT, NURTURE, DISQUALIFY, NO_ACTION |
| Rules | R1 binding verdict, R2 negative or suppressed, R3 disqualified, R4 escalate, R5 lead asked, R6 not now, R7 booking-ready, R8 purchase-ready, R9 ask, R10 threshold met, R11 low intent, R12 fallback. First match wins |
| Output | `nextBestActionSchema` (snake_case, CD-13), with reason, alternatives, question value terms, confidence and `model_call_required` |
| Runtime (LIVE) | WAIT, NO_ACTION and DISQUALIFY send nothing and make no model call. ESCALATE uses a fixed acknowledgement. CTA_BOOK in manual mode uses a fixed preferred-time question. Everything else composes from a ≤150-token NBA block |
| This pass | `create_booking` accepts the engine's booking-readiness in place of a QUALIFIED lifecycle (§9). A DISQUALIFY with `suppress: true` hands over silently for a person to confirm suppression (§9) |

## 9. Goal-specific flows

| Goal | Flow | Verified by |
|---|---|---|
| A Qualify only | Ask to threshold, then hand over | nba, matrix |
| B Book meeting | Booking-ready means CTA_BOOK with ≤1 gating question. Slots route to SEND_BOOKING_OPTIONS; a link routes to the booking link; manual mode asks the preferred time and creates a **pending** request. **New:** readiness (CTA_BOOK, no gating question left, gate and required dimensions known, no NOT_QUALIFIED/REVIEW, lifecycle NEW/CONTACTED/ENGAGED/QUALIFYING) lets `create_booking` proceed without a QUALIFIED lifecycle; confirmed availability is still required | golden `roofer-02`, `roofer-05`, `qi-engine-fixes` (item 2), story Q1/Q5 (live PASS, 2026-09-27, runs `9b566d75`, `625a2045`, `4e15707c`) |
| C Direct sale / D Sign-up | PURCHASE_READY plus an allowed checkout gives CTA_CHECKOUT or CTA_SIGNUP. Otherwise a person closes (READY_TO_BUY) | direct-close, golden `saas-01` |
| E Human closer | Threshold met means ESCALATE | nba |
| F Nurture | NOT_NOW means WAIT until `resume_at`, remembering facts; stale facts are VERIFY-asked, never blind-asked | intent-decay, matrix invariant |
| G Disqualify | Confirmed disqualifier means DISQUALIFY and follow-up stopped. **New:** with `suppress: true` the conversation is handed to a person (no acknowledgement to the lead) to confirm suppression. `human_takeover` makes the run gate refuse further AI turns and the send guard stop automated sends. `apply_suppression` still needs a recognised opt-out | `qi-engine-fixes` (item 3) |

## 10. UI/settings/Copilot integration

| Surface | Delivered | Tests |
|---|---|---|
| Lead page | Intent panel (state, score, category bars, evidence, contradictions, valid-until); Next-best-action card with "Why this question?"; Confirmed / Inferred / Unknown / Conflicting dimensions; override dialogs | phase5-surfaces 33 |
| Leads list | Filters: intent state, minimum intent score, completeness | qualification-ops |
| Settings | Qualification policy card: goal, required dimensions, thresholds, escalation conditions, autonomy (narrow only), `engineMode` | qualification-policy-settings 34 |
| Copilot / MCP / API | `qualification.status`, `.unknowns`, `.explain`, `.intent`, `.requalify`, `.set_fact`, `.override_intent`, `.override_nba`, `.policy_get`, `.policy_update`. Copilot may only narrow policy (CD-18). The agent is excluded from every write | qualification-ops 42 |
| Honest note | No browser pass of these screens was made in this final pass | |

## 11. Changes implemented

This final pass only. Earlier waves are in doc 08 §C.

| # | Change | Files |
|---|---|---|
| 1a | Direct answer to the planned question is CONFIRMED when a deterministic reader accepts it; AI-only candidates stay INFERRED (CD-8) | `interpret.ts` (`plannedAnswer`) |
| 1b | A reply is filed under the planned intent only when it answers that dimension. For FREE_TEXT, other readers explain part of the reply and at least two content words must remain; a question back or an acknowledgement answers nothing. For COUNT, the unit must fit the dimension; a short bare number answers | `interpret.ts` (`answersFreeText`, `COUNT_UNITS_FOR`) |
| 1c | Extractors: thousands separators to VOLUME (new incidental); spelled and hedged durations ("in about three months"); compound spelled numbers ("two hundred and fifty", found while verifying; previously read as 100); named teams to TEAM_SIZE (a headcount in the same reply is still read); PROJECT_SCOPE reader ("a new website", "a redesign of our online shop"; "a site visit" is not); dissatisfaction phrases with inflections and negation guard ("never replies", "missing deadlines", "we never miss a deadline" is not); BOOKING_REQUEST for "come and look" phrasing | `extractors.ts`, `interpret.ts` |
| 1d | Form-like lettered menus fail `singleFocus`; not a critical failure (justified in `grade.ts`) | `grade.ts` |
| 2.1 | Follow-up steps that ask a qualifying question write `messages.features.questionIntent` (not booking reminders) | `qi-turn.ts` `templateQuestionFeatures`, `automation-advance.ts` |
| 2.2 | Engine booking-readiness is enough for `create_booking` (pending or calendar), recorded when the booking is offered and read back when the lead answers | `qi-turn.ts` `engineBookingReadiness`, `policy.ts`, `tools.ts`, `qi-runtime.ts` (`bookingGate`), `orchestrator.ts`, `nba.ts` (export) |
| 2.3 | DISQUALIFY + `suppress` hands over silently for a person to confirm suppression | `qi-turn.ts` `disqualifyFollowThrough`, `orchestrator.ts` `askPersonToConfirmSuppression` |
| 2.4 | Lead fields from a form the lead submitted are FORM / CONFIRMED. Label-inferred form answers are CONFIRMED when the value parses for the dimension | `facts.ts` (`leadFieldsFromLeadForm`, `submittedByLead`), `interpret.ts` (`formValueCorroborates`), `service.ts` |
| 3 | Story Q (Q1–Q5) for the engine in LIVE mode; README and evidence doc updated | `tests/stories/story-q-engine-live.ts`, `revenue-stories.test.ts`, doc 09 |
| T | 10 TODO markers removed (8 golden `knownGap`, grader `KNOWN_DISAGREEMENTS` emptied). New golden `roofer-05-form-fields-book`. New `tests/qi-engine-fixes.test.ts` (70 tests, in `npm test`) | tests |
| D | AGENT_RUNTIME tool table and LIVE plan table updated | `docs/AGENT_RUNTIME.md` |

No migration was needed. No expectation was edited to pass. No grader weight was changed.

## 12. Test matrix

| Suite | Pass / fail | What it proves |
|---|---|---|
| `qualification-matrix` (`MATRIX_FULL=1`) | 88,200 cases, 9/0 invariant tests | Never asks a CONFIRMED dimension; NEGATIVE means no ASK/CTA; BOOKING_READY + goal B means CTA_BOOK or ≤1 gating question; disqualified leads are not pursued; no MEDDPICC-only dimensions on LOCAL_SERVICE; no BUDGET before a problem; stale TIMING is VERIFY-asked |
| `golden-conversations` | 119/0 | 24 conversations, 49 turns, 8 behaviours per turn, QA on canned replies |
| `question-grader` | 53/0 | 32/32 held-out label agreement; mutation per criterion |
| `qi-engine-fixes` (new) | 70/0 | Every fix in §11 with negative controls |
| `answer-interpretation` | 28/0 | Multi-dimension replies, AI candidate rules, form answers |
| `intent-engine` / `intent-decay` | 33/0, 19/0 | States, caps, contradictions, decay |
| `nba` / `question-value` / `offer-profile` | 37/0, 15/0, 18/0 | Routing, value terms, resolution |
| `lead-score` / `qualification-facts` | 27/0, 27/0 | UNKNOWN ≠ NEGATIVE; fact merge |
| `direct-close` | 16/0 | Checkout gate |
| `qualification-runtime` / `agent-runtime-stories` | 24/0, 20/0 | Agent reads the NBA; LIVE plans |
| `question-qa` / `question-performance` | 38/0, 16/0 | 13 QA checks; analytics read model |
| `phase5-surfaces` / `qualification-ops` / `qualification-policy-settings` | 33/0, 42/0, 34/0 | UI, operations, settings |
| `token-budget` | 10/0 | NBA block ≤150 tokens; `agent_decision` +≤5% |
| **Full `npm test`** | **3,686 + 137 + 101 pass, 0 fail, 0 todo** | Regression |
| `npx tsc --noEmit` | clean | |
| `npm run lint` | 0 errors, 3 warnings (pre-existing, other files) | |
| `npm run build` | success, 152 pages | |

## 13. Golden conversation results

| Measure | Result |
|---|---|
| Conversations / turns | 24 / 49 (≥3 for each of 7 archetype profiles) |
| Known gaps | **0** (was 9 turns plus 1 grader disagreement) |
| Action mix | ASK 19, CTA_BOOK 12, ESCALATE 8, ANSWER_AND_ASK 4, NO_ACTION 3, WAIT 2, CTA_CHECKOUT 1 |
| Model calls avoided (deterministic plan) | 18 of 49 turns (37%) |
| Grader | n=32, mean 62.0, 19 below 80 (as labelled), agreement 32/32, known disagreements 0 |

The 10 closed TODOs:

| Conversation / case | Was | Now |
|---|---|---|
| accounting-02 t1 | "never replies", "missing deadlines" not DISSATISFACTION | DISSATISFACTION known, not asked |
| ecommerce-02 t1 | "2,000 orders a month" not VOLUME | VOLUME known, not asked |
| enterprise-01 t2 | PROBLEM answer INFERRED, then PROBLEM.VERIFY | CONFIRMED, not re-asked |
| roofer-02 t2 | "book someone to come and look" not a booking | BOOKING_READY, CTA_BOOK |
| saas-01 t2 | "sales team of 12" read as COMPANY_SIZE and as a USE_CASE answer | TEAM_SIZE; USE_CASE untouched |
| saas-02 t2 | USE_CASE answer INFERRED, then VERIFY | CONFIRMED |
| studio-01 t1, t2 | "a new website" read as PROBLEM; PROJECT_SCOPE asked next | PROJECT_SCOPE known, not asked |
| studio-02 t3 | "in about three months" not TIMING | TIMING known, not asked twice |
| grader `sms-multiple-choice-form` | graded 85 (pass) against a fail label | graded 78 (fail), no critical failure, as labelled |

## 14. Token/cost results

| Measure | Result | Source |
|---|---|---|
| Strategy block per turn | Legacy mean 151 (max 186) → NBA mean **75** (max 92) tokens, about −50% | `token-budget` |
| `agent_decision` system prompt | 1,115 tokens; grew ≤5% for the engine | `prompt-token-snapshot.json` |
| Zero-model actions | WAIT, NO_ACTION, DISQUALIFY, ESCALATE (fixed ack), manual CTA_BOOK (fixed question) | `NBA_ACTION_NEEDS_MODEL`, `planFor` |
| Golden turns avoiding the model | 18/49 (37%) | golden report |
| Matrix actions needing no model | 46,584 / 88,200 (53%). The grid is uniform, not a traffic mix, so this is not a forecast | matrix report |
| AI assist | Only when the rules read nothing and the reply is ≥20 chars; nano tier, ≤200 output tokens; INFERRED only | `qi-runtime.ts` |
| Live per-turn cost | **Not measured.** No LIVE traffic yet; per-run token columns will give tokens-by-action once it runs | §17 |

## 15. Remaining defects

| # | Defect or limit | Impact | Owner action |
|---|---|---|---|
| R1 | **Live stories: behaviour proven, isolation not.** On 2026-09-27, Q1–Q5 and the H3/H3b/I3/B2 re-checks PASS in three full runs, with zero rows left. But in every run the deployed worker claimed 1–2 SQL-inserted `event.dispatch` jobs before the guard parked them (harmless by design: CANCELLED subscription, no endpoints) | Release gate open on the isolation condition | Apply migration 0137 (`job_claims_paused`), then run the stories once for `deployedWorkerTouched: []` |
| R2 | **Shadow diff: first review on test traffic only** (§C.5 regression gate). 8 of 24 SHADOW turns differed: 5 close a turn earlier (CTA_BOOK/CTA_SIGNUP), 3 ask a library intent instead of the next configured question. No reversal of pursue or stop | Release gate open | Run SHADOW on a real workspace; review `decision_json.qi.accounting.shadow_differs` per turn |
| R3 | **Model wording quality is not evaluated by any deterministic test.** `EVAL_LIVE=1` was **not run**: `tests/evals/live-hook.ts` `loadLiveRunner()` is a scaffold that returns null, so no live-model runner exists | Rewording by the real model is unverified; QA and the grader catch structure, not tone | Wire a live runner (Azure, e2e env, no outbound), then run it |
| R4 | **Behavioural intent has no lawful tracking source.** There is no site snippet or pixel, and open tracking is unreliable and is itself PECR reg. 6 tracking. Only first-party submitted data is used (converting page, repeat submissions) | Behavioural component usually 0 of 20; states are calibrated so HIGH needs none | Separate owner-approved project |
| R5 | **Per-workspace experiments rarely reach 100 leads per arm** (`MIN_SAMPLE_FLOOR = 100`) | Most results will read "not enough evidence"; library improvement happens offline through golden sets | Do not market "self-learning" |
| R6 | FREE_TEXT relevance is a heuristic. An off-topic reply that no other reader explains ("We're based in Leeds and pretty busy at the moment" after a USE_CASE question) is still filed as a **CONFIRMED** USE_CASE answer | Wrong fact recorded; the lead page can override it | Consider AI-assisted relevance (INFERRED-only) or a topic lexicon per dimension |
| R7 | Lead-field provenance is per lead, not per field. A team member editing the postcode on a form lead is treated as form-submitted | A staff edit counts as CONFIRMED | Per-field provenance on `leads` (needs a migration) |
| R8 | Extractors are English regex. Coverage is broad but finite; the 10 TODOs show gaps surface in use | New phrasings fall back to UNKNOWN (then asked), never invented | Grow the golden corpus from real conversations |
| R9 | Grader held-out set is small (32 labels) | Agreement is 32/32, but on a small sample | Label more real drafts |
| R10 | UI screens not re-checked in a browser this pass | Tests cover them; visuals unverified | Browser pass before release |

## 16. Qualification Engine Score /100

Scored per component on evidence, not intent. Unverified live behaviour is marked down.

| Component | Weight | Score | Justification |
|---|---|---|---|
| Intent signals, score, decay (§3–5) | 10 | 8 | Complete and tested (52 tests), explainable. −2: behavioural signals have no lawful source (R4) |
| Offer / hierarchy / context (§1–2, 7) | 8 | 7 | Union resolution, form answers and form provenance. −1: per-lead, not per-field, provenance (R7) |
| Dimension and question library (§6, 8) | 8 | 7 | 26 dimensions, 95 intents, channel renderings. −1: English-only phrasing |
| Question value and adaptive trees (§9, 11) | 8 | 7 | Value terms, branches, prerequisites, capped re-ask; 88,200-case invariants. −1: value weights are hand-set, not learned (R5) |
| Answer interpretation and uncertainty (§14–15) | 10 | 7 | Multi-dimension, provenance, CD-8 at three layers; today's fixes generalised with negative controls. −3: regex coverage finite (R8), off-topic free text can be CONFIRMED (R6) |
| NBA and goal routing (§10, 12, 18) | 12 | 10 | 12 rules, full-matrix invariants, booking-readiness and disqualify-suppress closed. −2: LIVE booking and negative paths not yet proven live (R1). *2026-09-27: Q1, Q2 and Q5 PASS live; not re-rated* |
| Qualification score (§13) | 5 | 4 | One score, UNKNOWN ≠ NEGATIVE, completeness. −1: two score shapes can still confuse (D7) |
| Pre-send QA and grading (§16, 24) | 8 | 7 | 13 checks; grader agrees 32/32 with mutations. −1: small held-out set (R9) |
| Runtime integration (agent on one source of truth) | 10 | 7 | NBA drives LIVE turns; zero-token actions; ask history now covers follow-ups. −3: the five LIVE stories were written but not run (R1). *2026-09-27: all five PASS live; the isolation proof waits on 0137. Not re-rated here* |
| UI, settings, Copilot (§19–21) | 6 | 5 | All surfaces built and tested. −1: no browser pass this round (R10) |
| Analytics and self-improvement (§17) | 5 | 3 | Features v2, read model, governed experiments. −2: per-workspace power is weak (R5) |
| Tests and release evidence (§22–23, 25) | 10 | 6 | Strong deterministic evidence. −4: no live E2E in LIVE mode (R1), EVAL_LIVE not wired (R3), no shadow diff review (R2). *2026-09-27: live LIVE-mode stories pass (isolation pending 0137); first shadow review on test traffic only. Not re-rated* |
| **Total** | **100** | **78** | |

## 17. Release decision

**Not released as the default. `QI_RELEASE_GATES_PASSED` stays `false`.** New workspaces keep
defaulting to SHADOW. A workspace can still be set to LIVE explicitly: the test workspace in story
Q, or an owner opting in.

| Gate (§C.5) | Result | Evidence |
|---|---|---|
| Intent signals + explainable evidence + decay | PASS | intent-engine 33/0, intent-decay 19/0; Intent panel (phase5-surfaces) |
| Differs by industry/offer/goal; adapts; no repeats; stops correctly | PASS | Matrix 88,200 cases; golden 24 conversations / 49 turns, 0 gaps; B8 archetype test |
| Scoring; UNKNOWN ≠ negative | PASS | lead-score 27/0 |
| NBA routing; no over-qualification; direct-sale; nurture; suppression/disqualification | PASS (deterministic) | nba 37/0, matrix, direct-close 16/0, qi-engine-fixes 70/0 (items 2 and 3), golden roofer-05 |
| UI, Copilot | PASS | phase5-surfaces 33/0, qualification-ops 42/0, policy-settings 34/0 |
| Agent on the same source of truth | PASS | qualification-runtime 24/0, agent-runtime-stories 20/0 |
| Token cost measured | PASS | token-budget 10/0 (151 → 75 tokens); tokens-by-action from run columns |
| Question analytics | PASS | question-performance 16/0 |
| Question grading | PASS | grader 53/0, 32/32 agreement, 0 known disagreements |
| Regression: `npm test`, tsc, lint, build | PASS | 3,686 + 137 + 101 / 0 fail / 0 todo; tsc clean; lint 0 errors; build 152 pages |
| Regression: shadow-mode diff report reviewed before the flag flips | **OPEN: first review done on test traffic; real-traffic review owed** | Run `4e15707c`: 24 SHADOW turns, 8 differ (CTA_BOOK 4/10, ASK 3/8, CTA_SIGNUP 1/3). 5 close one turn earlier than legacy on a booking- or purchase-ready lead; 3 ask a library intent where legacy asks the next configured question (ENTERPRISE story). None reverses pursue or stop. Scripted model and test conversations only (doc 09 "Shadow-diff review") |
| Live E2E business stories (engine LIVE) | **PASS (2026-09-27, run `704f6b49`)** | Q1–Q5 PASS in three full runs (2026-09-27: `9b566d75`, `625a2045`, `4e15707c`), 0 rows left each time. The run condition `deployedWorkerTouched: []` was not met: 2, 2 and 1 `event.dispatch` jobs claimed by the deployed worker. Fix: migration 0137, not applied (R1) |

**What flips it:**

1. ~~Apply migration 0137, then run the stories with `deployedWorkerTouched: []`.~~ **Done
   2026-09-27:** 0137 applied; run `704f6b49` passed 55/55 with `deployedWorkerTouched: []` and
   zero rows left.
2. Review a shadow diff report on at least one real workspace (a test-traffic review is done).

Then set `QI_RELEASE_GATES_PASSED = true` with a comment citing both. The model-wording limit (R3)
is not a §C.5 gate, but a live-model eval run before a wide rollout is recommended.
