# Phase 2 — Sales intelligence: taxonomy, archetypes, motions, scoring, qualification, method

**Implements:** brief §§4–8, 16–20, 32–39, 59 and 106.
**Builds on:** migration 0120 (UK SIC 2026 plus 2007, and the correspondence table).

## 0. Where the library lives, and why

The brief asks for "versioned internal libraries … configurable … not one giant system prompt" (§106). There are three possible homes:

| Option | Problem |
|---|---|
| All in the database, seeded by migration | Every content fix needs a migration, and the content can't be reviewed or tested as code. |
| All in prompts | Can't be tested or versioned, and has to be resent on every call. |
| **Chosen: in code, with workspace overrides in the database** | — |

How the chosen option works:

- **Canonical library** in `src/lib/sales-library/`: pure TypeScript, typed, with a `LIBRARY_VERSION`. It is unit-tested for internal consistency (weights sum to 100, every dimension referenced exists, every archetype maps to real SIC codes).
- **Workspace choices** are stored in the database: primary and secondary industry codes, archetype, and the list of motions.
- **Workspace overrides** are also stored there: weight adjustments, question edits, extra objections and disqualifiers. Every override is validated by the same zod schemas.
- **Every decision records the library version** that produced it: scores, method choices, qualification plans.

## 1. Classification (§§4–6)

### Business profile columns (migration 0121)

- `primary_industry_system`, `primary_industry_code`
- `secondary_industry_codes jsonb`
- `archetype_key`
- `sales_motions text[]`
- `classification_source`: USER, COMPANIES_HOUSE, WEBSITE or AI_SUGGESTED
- `classification_confidence`

The same shape goes on `prospect_companies`: `sic_codes jsonb` straight from the register, and a derived `archetype_key`.

### Archetypes

The library holds a tree of about 60 archetypes. Each archetype carries:

- its group
- SIC 2026 code prefixes
- aliases
- default motions
- a typical deal size band
- the typical decision-makers

### Resolution order, deterministic first

1. Companies House SIC 2007 codes, mapped to 2026 candidates, then to archetypes.
2. Alias match on what the customer typed.
3. Website text keywords.
4. Optional AI suggestion, stored as `AI_SUGGESTED` and never binding.

### Sales motions

| Motion | Close target |
|---|---|
| `BOOK_MEETING_B2B` | Qualify, then book a human |
| `DIRECT_B2B` | Qualify, then proposal or checkout |
| `LOCAL_SERVICE` | Requirements, then quote or visit |
| `HIGH_TICKET_B2C` | Suitability, then consultation |
| `ECOMMERCE_DIRECT` | Product match, then checkout |
| `SAAS_SELF_SERVE` | Fit, then trial or signup |
| `ENTERPRISE` | Stakeholders, then business case, then human |

## 2. Lead scoring v2 (§§16–19)

Pure engine `src/lib/scoring/lead-score.ts`. It generalises `prospects/scoring.ts`, which is kept for sourcing and fed through the same dimensions.

- **Dimensions, defaulting to 100 in total:** fit 30, intent 20, need 15, commercial 10, decision access 10, timing 10, engagement 5. The weights come from the archetype × motion profile, with workspace overrides applied on top.
- **What each dimension returns:** a score, the evidence behind it (source, value, observed time), what is missing, and a confidence.
- **The overall result:** total, grade, per-dimension breakdown, missing list, overall confidence, `scoringVersion`, and a one-sentence *why*.
- **Hard rule:** no protected or special-category inputs. The feature allow-list is enforced by a test (§87).
- **Storage:** `lead_scores` holds history as append-only rows with a current flag. `lead_score_factors` holds the evidence per dimension.
- **Re-scoring:** each event triggers a `lead.score` job, idempotent on (lead, triggering event):
  - lead created, touched or enriched
  - reply received or classified
  - qualification answer recorded
  - booking made, cancelled or marked no-show
  - opt-out
- **Events emitted:** `lead.scored`, and `score.changed` when the grade moves.
- **Existing defect fixed here:** intent now reaches the *prospect* score. The intent stage has to run before scoring, and the boost has to be passed through.

### Auto-tags (§20)

`lead_tags` holds tag, reason, confidence, source event, rule version and set time. Tags are derived by pure rules from the score, the classifications and the lifecycle state, and each rule has a stated condition.

## 3. Adaptive qualification (§§32–35)

The existing deterministic engine stays as the judge. What changes is **which question comes next**:

- **Dimensions come from the motion profile.** Examples: `LOCAL_SERVICE` uses service, location, timing and property; `BOOK_MEETING_B2B` uses use case, team size, current solution, timing and authority.
- **Known answers.** A candidate question is marked *known* when:
  - an answer row exists;
  - a lead field answers it (postcode, service, company size taken from enrichment); or
  - a memory fact with confidence of at least 0.8 answers it.

  Known questions are never asked. An inferred answer is labelled *inferred*.
- **Value of each remaining candidate:**
  `informationGain × decisionRelevance × commercialValue − frictionPenalty − prematurityPenalty`.
  All five inputs are static attributes in the library, adjusted by stage. Prematurity is high for budget before the problem is stated, and for authority before engagement.
- **Stopping.** Questioning stops when the motion's *decision threshold* is met, meaning enough is known to take the next commercial action. The agent must not use up every configured question.
- **One primary question per outbound message.** The QA lint enforces this by counting question marks and interrogative clauses.

## 4. Method router (§§36–39)

Pure `src/lib/sales-library/method-router.ts`.

- **Inputs:**
  - archetype, motion and deal-size band
  - inbound or outbound, and the channel
  - stage
  - what is already known
  - stakeholder count
- **Outputs:**
  - primary method: `TRANSACTIONAL`, `SIMPLE_QUALIFICATION`, `SPIN`, `CHALLENGER_INSIGHT`, `MEDDPICC` or `PLG`;
  - question style;
  - close target;
  - a reason string (stored).
- **Evidence grade.** Every method carries its evidence grade from [01 §7](01-evidence-register.md). SPIN, Challenger and MEDDPICC are *convention*, used as internal question-planning heuristics only. Nothing is presented to a buyer as science. NLP is not implemented in any form.
- **The mode now reaches the model.** The agent context gets a short *strategy block*: motion, method, stage objective, the next best question, and what not to ask. It is built deterministically, so the model is given a plan, not left to invent one.

## 5. Knowledge and voice (§§7–8)

- **One voice profile** merges four existing stores: AI settings tone, `business_profiles.outreach_*`, `business_playbooks` and signatures. It covers tone sliders, forbidden phrases, CTA style, emoji and contractions policy, and examples of good and bad messages.
- **One knowledge feed** for the agent. From memory facts, services and prices, it builds a compact *offer card*:
  - what they sell
  - who for
  - differentiators
  - approved claims
  - prohibited claims
  - FAQs

  Every fact must be accepted or verified (provenance required), and the card stays within a token budget.
- **Stable and volatile context are separated for caching (§73).** The offer card and voice profile go in the stable prefix. The lead and the latest turn go in the volatile suffix.
- **Style lint (§49)** extends `agent/validate.ts` with:
  - the brief's banned clichés
  - excessive em dashes
  - repeated "just"
  - the question count
  - the workspace's forbidden phrases

## 6. Objection library (§59)

Each library entry has:

- a category, from the brief's list;
- surface-phrase patterns;
- possible underlying concerns;
- clarifying questions;
- an allowed response strategy, which may only reference approved claims;
- when to hand over (pricing exceptions, security or legal, contract terms).

The mode `OBJECTION_HANDLING` finally gets behaviour: the strategy block includes the matched objection's playbook. There are still no invented discounts or guarantees.

## 7. Opportunities (Q3)

`opportunities` table:

- lead or account
- stage
- value, currency and probability
- close target: book, buy, quote, proposal, trial, apply or next stage
- won or lost, with reason
- MEDDPICC fields as optional json, for the enterprise motion only
- `crm_external_id`

WON and LOST move from lead status onto the opportunity. Lead status stays as a compatibility projection.
