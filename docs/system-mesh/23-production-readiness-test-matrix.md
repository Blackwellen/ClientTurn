# 23 · Production Readiness Test Matrix

What must pass before ClientTurn can be called production-ready, and what exists today.

Existing suite: 37 test files under `tests/`, including two that run against the real Supabase
project (`rls.test.ts`, `rls-v4.test.ts`) — the only way RLS can honestly be proved.

---

## A · The end-to-end acceptance journey

The journey the brief requires, with today's status.

| # | Step | Status | Blocker |
|---|---|---|---|
| 1 | Business Profile captured | ✅ | |
| 2 | ICP configured | ✅ | |
| 3 | Search planned | ✅ | |
| 4 | Sourcing run produces prospects | ✅ | |
| 5 | Research + enrichment | ✅ | |
| 6 | Verification | ✅ | |
| 7 | Contactability decision | ✅ | |
| 8 | Prospect review + approve | ✅ | |
| 9 | Campaign enrolment | ✅ | |
| 10 | Cold email sent, guarded | ✅ | |
| 11 | Delivery event | ✅ | |
| 12 | Reply received | ✅ | |
| 13 | Reply classified | ✅ | |
| 14 | Sequence stops | ✅ | |
| 15 | **Promoted to Lead** | ❌ | **P0-1 — check-constraint violation** |
| 16 | Follow-up runs | ⛔ | unreachable — no lead |
| 17 | Qualification | ⛔ | " |
| 18 | Booking | ⛔ | " |
| 19 | Handover | ⛔ | " |
| 20 | CRM sync | ⛔ | " |
| 21 | Outcome recorded | ⛔ | " |
| 22 | Analytics | ⚠️ | five reply-rate definitions; `won_at` can be null |
| 23 | Feedback into ICP / scoring | ❌ | never built |

**Steps 1–14 work. Step 15 fails, and 16–21 are unreachable behind it.** A single SQL routine is
the difference between a demonstrable end-to-end product and one that stops at the boundary it
was built around.

## B · Interface parity suite — the audit's acceptance criterion

For each action, perform it through all four doors and assert identical outcomes.

| Action | UI | Copilot | Agent | MCP | Assert |
|---|---|---|---|---|---|
| Assign lead | ✅ | ⚠️ | n/a | ⚠️ | `leads.assigned_user_id`; `lead_assignments` closed + opened; `audit_log` with the right `actor_type`; inactive member refused |
| Change lead status | ✅ | n/a | ✅ | ⚠️ | status; lifecycle timestamp; `qualification_state`; `automation_active`; audit; CRM push enqueued |
| Mark needs attention | ✅ | ⚠️ | n/a | n/a | flag + reason + audit |
| Create lead | ✅ | n/a | n/a | ⚠️ | duplicate check; `contact_permissions`; cold relationship refused |
| Approve prospect | ✅ | n/a | ✅ | ✅ | status; `approved_by`; audit |
| Promote prospect | ❌ | n/a | ❌ | n/a | lead created; lineage columns; conversation re-stamped; idempotent |
| Send message | ✅ | n/a | ✅ | ⏸ | `compliance_decisions`; `usage_events`; `send_key` idempotency |
| Launch campaign | ✅ | ⏸ | ⏸ | ⏸ | validation ran; budget reserved; state transition legal |
| Pause campaign | ✅ | ✅ | n/a | ✅ | no slot issued after pause |
| Start sourcing run | ✅ | ❌ | ✅ | ⏸ | budget reserved; `usage_events` |

✅ works · ⚠️ works but diverges · ⏸ parks and is never executed · ❌ not implemented or broken

**This suite does not exist today.** It is the single most valuable test asset to build, because
it is the only thing that keeps the interfaces from drifting apart again.

## C · Coverage of the existing suite

| Area | Test file | Covers | Gap |
|---|---|---|---|
| RLS | `rls.test.ts`, `rls-v4.test.ts` | cross-tenant reads/writes, real database | — |
| Send guard | `send-guard.test.ts` | stop conditions, quiet hours, origin exemptions | not the policy engine |
| Scheduler | `scheduler.test.ts` | step timing, quiet hours roll-forward | — |
| Policy | `policy.test.ts` | `canSend` rules | not `evaluate()`'s I/O, not the warm path |
| Qualification | `qualification.test.ts`, `qualification-editor.test.ts` | engine + draft model | — |
| Outreach | `outreach-dispatch.test.ts`, `outreach-sequences.test.ts` | dispatch, sequence advance | — |
| Acquisition campaign | `acquisition-campaign.test.ts` | draft, validation, launch | — |
| Prospects | `find-leads-prospects.test.ts`, `prospect-scoring.test.ts`, `find-leads-filters.test.ts`, `find-leads-plan.test.ts`, `find-leads-research.test.ts` | filters, scoring, plan parsing | **no promotion test** |
| Agents | `agent.test.ts`, `agent-adversarial.test.ts`, `agent-availability.test.ts` | tool allow-list, prompt injection, slots | — |
| MCP | `mcp.test.ts` | gateway auth and scope | **no parity assertions against the UI actions** |
| Billing | `ai-tokens.test.ts`, `upgrade-card.test.ts` | token ledger | **no entitlement enforcement test** |
| Messaging / email | `messaging.test.ts`, `email.test.ts`, `rich-text.test.ts` | providers, parsing | — |
| Imports | `imports.test.ts` | classification | — |
| Reactivation | `reactivation.test.ts`, `reactivation-wizard.test.ts` | audience, wizard | — |
| Onboarding | `onboarding.test.ts` | steps | — |
| Security | `ssrf.test.ts` | outbound fetch guard | — |
| Admin / affiliates | `admin.test.ts`, `affiliates.test.ts`, `affiliate-programme.test.ts` | ops actions | — |
| Public pages | `public-pages.test.ts`, `find-leads-public-page.test.ts` | marketing | — |
| Visual | `tests/visual/` | baselines | — |

**This is a strong suite.** The gaps below are specific, not general.

## D · Tests to add, in priority order

| # | Test | Catches |
|---|---|---|
| **T1** | Promote a replied prospect against a real database; assert the lead, the lineage columns, the re-stamped conversation, idempotency on a second call, refusal when suppressed or unreplied | P0-1, P0-2 — **would have caught the live blocker** |
| **T2** | Every status enum value inserts successfully into its column | The casing class of bug that caused P0-1 |
| **T3** | Interface parity suite (§B) | P0-4, and permanently |
| **T4** | Suppression crossover: SMS `STOP` blocks cold email and vice versa | P0-3 |
| **T5** | Golden-dataset metric tests — every rate asserted to an exact value from every surface | P0-5 |
| **T6** | Every internal `/app/settings?…` link resolves to a real section id | P1-8, and the whole class |
| **T7** | Every mutating server action calls `requireRole` or `requireWorkspace` | P1-10 |
| **T8** | Send N cold emails; assert N `usage_events`; assert N+1 refused past the hard limit without overage | P0-6 |
| **T9** | Every tool declared in `mcp/tools.ts` and `copilot/types.ts` has a reachable implementation or is explicitly approval-gated with a working approval path | P1-3, Copilot's two unreachable tools |
| **T10** | Every metric with an entitlement has a writer and a reader that agree | P0-6, P1-7 |
| **T11** | Every provider in the catalogue with `connectionMethod: "oauth"` has a registered adapter | P1-1, and the four dead Connect buttons |
| **T12** | Every channel in `CHANNEL_DEFINITIONS` has an ingestion path | P1-5 |
| **T13** | Analytics queries return correct results above the row caps in `v4-extras` | S1 — silent truncation |
| **T14** | Orphan scan in CI: no module in `src/` is unreachable from an entry point | Prevents re-accumulation |

T1, T2, T6, T7, T11 and T12 are all mechanical, cheap, and each catches a defect class that this
audit found by hand.

## E · Release gate

Do not call the product production-ready until:

1. **The end-to-end journey in §A completes**, initiated from the UI. (Blocked by P0-1.)
2. **The parity suite in §B passes for all four interfaces.** (Blocked by P0-4.)
3. **One suppression list.** An opt-out on any channel blocks every channel. (P0-3.)
4. **One number per metric name.** Any two screens showing "reply rate" show the same figure.
   (P0-5.)
5. **Every metered action is metered.** No entitlement is displayed that is not enforced. (P0-6.)
6. **No surface advertises a capability it cannot deliver** — Meta connect, the three Inbox social
   tabs, the four MCP approval-gated tools, the two unreachable Copilot tools, the four dead
   Connect buttons. Each is either built or removed. (P1-1, P1-3, P1-5.)
7. **Every warm send writes a compliance decision.** (P1-2.)
8. `9999_qa_seed_temp.sql` is not applied to production.

Items 1–5 are correctness. Item 6 is honesty. Item 7 is the legal position for a UK product.

## F · What is already production-grade

Stated plainly, because it is a lot and it should not get lost in a defect list:

- RLS on all 174 tables, with real cross-tenant tests.
- The job queue: SKIP LOCKED claiming, idempotency keys, capped backoff, dead-lettering, a
  stalled-worker reaper, and admin retry/cancel controls.
- Send idempotency via `send_key`, and the webhook inbox on `webhook_events`.
- The conversation model: one thread, every channel, lead and prospect, surviving promotion.
- The provenance model: `prospect_data_sources` with per-field provider, licence tags and cost.
- Deterministic qualification and scoring, both versioned and both explainable.
- The AI safety model: prompt registry, schema-validated output, confidence banding, untrusted
  content wrapping, tool allow-lists, adversarial tests, and a graceful `AI_UNAVAILABLE` path.
- The shared OAuth framework and adapter registries.
- Secret handling: envelope encryption, server-only clients, no secret in any response body.
- The acquisition campaign state machine, with an explicit transition table and an actor-attributed
  event history.
- The admin operator toolkit: jobs, errors, webhook replay, provider health, compliance,
  economics.
- Atomic SQL cap claiming for campaign and sender send limits, with release on failure.

The defects in this report are real and several are serious. They sit on top of an unusually
well-built foundation, and none of them requires rebuilding any of it.
