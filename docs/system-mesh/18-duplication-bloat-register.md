# 18 · Duplication and Bloat Register

Every duplication found, in the required form: **Location A · Location B · why equivalent · how
they diverge · risk · canonical replacement · migration impact · verdict.**

Verdicts: `KEEP` · `MERGE` · `REPLACE` · `DEPRECATE` · `DELETE`.

---

<a id="d1"></a>
## D1 · `assignLead` — three implementations · **REPLACE**

**A** [`src/lib/leads/actions.ts:57`](../../src/lib/leads/actions.ts)
**B** [`src/lib/copilot/tool-service.ts:449`](../../src/lib/copilot/tool-service.ts)
**C** [`src/lib/mcp/handlers.ts:173`](../../src/lib/mcp/handlers.ts)

**Why equivalent** — all three answer "make this workspace member the owner of this lead", all
three validate membership first, all three write `leads.assigned_user_id`.

**How they diverge**

| Side effect | A | B | C |
|---|---|---|---|
| `leads.assigned_user_id` | ✅ | ✅ | ✅ |
| Close the open `lead_assignments` row (`unassigned_at`) | ✅ | ❌ | ❌ |
| Insert a new `lead_assignments` row with `assigned_by` | ✅ | ❌ | ❌ |
| `audit_log` `lead.assigned` | ✅ | ❌ (writes `copilot_actions` instead) | ❌ (writes `mcp_audit_logs` instead) |
| `requireRole("member")` | ✅ | role from Copilot context | live role re-read |
| `revalidatePath` | ✅ | ❌ | n/a |
| Membership check includes `status='active'` | ✅ | ❌ — B omits it, so a **removed or invited** member can be assigned a lead | ✅ |

**Risk** — assignment history is silently incomplete, so "who has owned this lead?" returns a
partial answer whose completeness depends on which interface was used. B can assign work to
someone who is no longer in the workspace.

**Canonical replacement** — A, with an explicit `actor` parameter.

**Migration impact** — B and C become thin adapters. `lead_assignments` will have gaps for any
assignment already made through B or C; a backfill can insert rows from `audit_log` where one
exists, but Copilot/MCP assignments left no audit row, so those are unrecoverable. Historical gap
must be accepted.

---

<a id="d2"></a>
## D2 · `updateLeadStatus` — two implementations · **REPLACE** · P0

**A** [`src/lib/leads/actions.ts:130`](../../src/lib/leads/actions.ts)
**B** [`src/lib/mcp/handlers.ts:199`](../../src/lib/mcp/handlers.ts)

**Why equivalent** — both set `leads.status` from the same seven-value vocabulary.

**How they diverge** — B does *only* that. A additionally:

- stamps `qualified_at` / `booked_at` / `won_at` / `lost_at` from `STATUS_TIMESTAMPS`;
- sets `qualification_state='QUALIFIED'` when status becomes QUALIFIED;
- sets `automation_active=false` on WON and on LOST;
- clears `needs_attention` on LOST;
- writes an `audit_log` row with `{from, to}`;
- calls `enqueueCrmPushes()` for QUALIFIED / BOOKED / WON.

**Risk — this is the worst single divergence in the codebase.** An MCP-driven WON leaves:

1. `won_at` null → invisible to `analytics/v4-queries.ts:80`, `v4-extras.ts:104`,
   `v4-queries.ts:292` and the Dashboard funnel. Revenue reporting under-counts.
2. `automation_active` true → the follow-up sequence keeps messaging a won customer.
3. no CRM push → the customer's own CRM never learns they won the deal.
4. no audit row → the change is invisible in the lead history.

**Canonical replacement** — A.

**Migration impact** — a data-repair migration should backfill `won_at`/`booked_at` from
`updated_at` for rows where the status implies a timestamp and none is set, and turn
`automation_active` off for WON/LOST leads.

**Belt and braces** — make the timestamps a trigger. A second code path cannot forget a trigger.

---

<a id="d3"></a>
## D3 · Reply rate — five implementations · **MERGE** · P0

| # | Location | Formula | Unit | Empty denominator |
|---|---|---|---|---|
| **Registry** | `analytics/v4-metrics.ts:145` | *"Contacts who sent at least one inbound reply divided by contacts messaged"* — **distinct contacts** | — | — |
| 1 | `analytics/v4-queries.ts:417` | `inbound message count / outbound message count` | 0–1 | null ✅ |
| 2 | `analytics/v4-extras.ts:194` | same, per channel; denominator is `status in (SENT, DELIVERED, FAILED)` | 0–1 | null ✅ |
| 3 | `billing/usage-service.ts:227` | same again | 0–1 | null ✅ |
| 4 | `campaigns/reactivation-types.ts:278` | `(replies / sent) * 100` | **0–100** | **0** ✗ |
| 5 | `leads/queries.ts:271` | `(replied leads / contacted leads) * 100` — **distinct leads** | **0–100** | **0** ✗ |
| 6 | `analytics/queries.ts:170` | legacy V3 | 0–100 | 0 | dead |

**Why equivalent** — every one is labelled "reply rate" in the UI.

**How they diverge** — three distinct semantic problems, not one:

1. **Numerator.** 1–4 count *messages*; the registry and 5 count *people*. A lead who sends four
   replies counts four times in Analytics and once in Leads.
2. **Denominator.** 1–3 include `FAILED` sends. A failed message was never delivered and cannot
   be replied to, so every rate is depressed by the failure rate.
3. **Empty case.** 4 and 5 return `0`; 1–3 return `null`. `v4-metrics.rate()` has a comment
   explaining precisely why `0` is wrong — *"0% reply rate on a campaign that has sent nothing is
   a lie that reads as failure"* — and two call sites do it anyway.

**Risk** — the Analytics page, the Reactivation card and the Leads header show three different
numbers under one name, and none matches the definition the product publishes to the user in the
metric tooltip. A customer comparing two screens concludes the product is broken, and they are
not wrong.

**Canonical replacement** — one SQL function per metric, e.g.

```sql
create function public.reply_rate(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns numeric  -- distinct recipients with an inbound reply / distinct recipients delivered to
```

consumed by Analytics, Dashboard, Copilot `getAnalytics`, campaign detail, the reactivation card
and `/api/analytics/export`. Keep `v4-metrics.METRICS` as the label-and-definition registry it
already is, and make the numbers come from the same place as the words.

**Migration impact** — display only; no stored data changes. But **the numbers customers see will
move**, which needs a release note. The same treatment applies to `delivery_rate`,
`qualification_rate`, `booking_rate` and `conversion_rate`.

---

<a id="d4"></a>
## D4 · Three message-template models · **KEEP, with a shared merge-field core**

**A** `automation_steps.body_template` (warm follow-up)
**B** `campaigns.message_template` + `followup_template` (reactivation)
**C** `outreach_steps.subject_template` + `body_template` + `campaign_variants.content_json` (cold)

**Why equivalent** — all three are a message body with merge fields.

**How they diverge** — genuinely: A is channel-fallback aware; B is a fixed two-message pattern
with no sequence; C has subject lines, A/B variants and per-step scheduling.

**Verdict: KEEP.** These are three different products, not three implementations of one. But
`messaging/merge-fields.ts` should be the single source of the merge-field vocabulary and the
single renderer — today `outreach/campaign-draft.ts` declares its own `MERGE_FIELDS` and
`unknownMergeFields`, while `automation/scheduler.ts` has `findUnknownMergeFields`. **MERGE those
two helpers.**

---

<a id="d5"></a>
## D5 · Two acquisition-campaign UIs · **MERGE** · P1

**A** `find-leads/campaigns/campaign-builder.tsx` + `campaign-controls.tsx` →
`outreach/actions.ts` (`createCampaignAction`, `launchCampaignAction`, `setCampaignStatusAction`,
`createSenderIdentityAction`)

**B** `find-leads/campaigns/wizard/*` (6 steps) + `detail/*` → `outreach/campaign-actions.ts`
(13 actions) + `outreach/campaigns/*` (16 modules)

**Why equivalent** — both create, launch and control a row in `outreach_campaigns`.

**How they diverge**

| | A | B |
|---|---|---|
| Draft persistence | none | `outreach_campaigns` DRAFT + version snapshots |
| Validation before launch | inline | `validateCampaignAction` + `launch_validated_at` |
| State transitions | `setCampaignStatusAction`, free-form | `setCampaignStateAction` against an explicit `TRANSITIONS` table |
| Budget reservation | none | `resolveCampaignBudgetContext` + `outreach_campaign_usage` |
| Audience estimate | none | `estimateAudienceAction` |
| A/B variants | none | `generateVariantsAction` + `campaign_experiments` |
| Sender health | — | `loadSenderHealth` |

**Risk** — `campaigns-view.tsx` renders **both**. A campaign created through A skips validation,
budget reservation and the transition table, then appears in B's detail page which assumes all
three happened. `createCampaignAction` is already unreferenced, so only the launch and status
controls are live — which is arguably worse, because it means A's controls operate on B's
campaigns without B's guards.

**Canonical replacement** — B. Keep `createSenderIdentityAction` (it is the only sender-creation
path and is not campaign-specific); delete the other three actions and both A components.

**Migration impact** — none in the database. `campaigns-view.tsx` loses two imports and gains a
link to `/app/find-leads/campaigns/new`.

---

## D6 · Two contactability engines · **MERGE** · P1

**A** `policy/service.evaluate()` + `policy/channel-policy.canSend()` — cold path
**B** `jobs/send-core.evaluateSend()` + `automation/scheduler.evaluateStopConditions()` — warm path

**Why equivalent** — both answer "may we send this message now?".

**How they diverge** — B checks opt-out, suppression flag, human takeover, has-replied and quiet
hours. A checks all of that *plus* lawful basis, subscriber type, jurisdiction, provider data
licence, channel permission, sender/domain health and caps — and records the decision with its
policy version.

**Risk** — no compliance decision record exists for any warm send; `contact_permissions` is never
consulted for warm sends; the two read different suppression tables (D7).

**Canonical replacement** — A, called from `send-core` with `campaignType: "WARM"`. The warm rule
set **already exists** in the pack (`ruleSetFor()` maps WARM / REACTIVATION / TRANSACTIONAL to
`pack.warm`), and `agents/ticks.ts` already proves the warm path can call it.

Full detail in [11](11-compliance-permission-mesh.md).

---

## D7 · Two suppression lists · **MERGE** · P0

**A** `contact_suppressions` (V3, warm) **B** `suppression_entries` (V4, cold)

Covered in full at [04 · 4.3](04-database-audit.md) and [11 · 1.3](11-compliance-permission-mesh.md).
Canonical: **B**. Migration: backfill, replace A with a view, repoint the three warm readers, drop
the view.

---

## D8 · Singular / plural prospect actions · **MERGE**

| A | B |
|---|---|
| `approveProspectAction(id)` — `find-leads/actions.ts:817` | `approveProspectsAction(ids[])` — `find-leads/prospect-actions.ts:163` |
| `suppressProspectAction(id)` — `prospect-actions.ts:87` | `suppressProspectsAction(ids[])` — `prospect-actions.ts:391` |

Same business action, one from the drawer and one from the bulk bar, in two different files.
Nothing guarantees they apply the same guards. **MERGE** each pair into the array form; the drawer
passes an array of one. Low risk, purely mechanical.

---

## D9 · Two quiet-hours implementations · **MERGE**

**A** `automation/scheduler.ts:87` `isWithinQuietHours(at: Date, quiet)` + `nextPermittedSendTime`
**B** `policy/channel-policy.ts:86` `isWithinQuietHours({hour,minute}, rule)` + `quietHoursEndMinutes`

Same rule, different signatures, different timezone responsibility (A resolves the zone itself
with `minutesInZone`; B expects the caller to have converted). They agree today. Nothing keeps
them agreeing.

**Canonical**: B (pure, no zone assumption), with A's `nextPermittedSendTime` roll-forward kept
and moved next to it. A's callers convert the zone first.

---

## D10 · Three audit trails · **MERGE**

`audit_log` (UI + system) · `mcp_audit_logs` (MCP) · `copilot_actions` (Copilot).

Same fact — "an actor performed an action on an entity" — split by which door it came through,
which is precisely the axis a reader does not know in advance. `recordAudit()` already accepts an
`actorType`.

**Canonical:** `audit_log` with `actor_type ∈ {user, system, agent, copilot, mcp, integration}`.
Keep `mcp_audit_logs` only for the protocol-level detail that has no analogue elsewhere (scope
denials, latency), and cross-reference.

---

## D11 · Two entitlement systems · **MERGE**

**A** `billing/entitlements.ts` + `subscriptions` boolean columns + `PLANS` in code (V3)
**B** `billing/v4-entitlements.ts` + `plan_entitlements` + `business_entitlement_grants` (V4)

B already calls A for the plan key, so they are chained rather than conflicting. But "what does
Growth include?" has three answers in three places, and nothing checks they agree.

**Canonical:** B. Move `lead_limit`, `user_limit`, `whatsapp_enabled`, `campaigns_enabled`,
`ai_assist_allowed` into `plan_entitlements` as metrics; keep `PLANS` for marketing copy and
Stripe price ids only. See [12 · 12.5](12-usage-billing-mesh.md).

---

## D12 · `agent` vs `agents`, `automation` vs `automations` · **KEEP, RENAME**

Genuinely different concepts with confusingly similar names. Not duplication — a naming defect.
Rename per [08 · F](08-agent-automation-mesh.md). No behaviour change.

---

## D13 · Legacy V3 analytics · **DELETE**

`analytics/queries.ts` `getAnalyticsData()` — superseded by `v4-queries`/`v4-extras`, no callers.
`getAttributionRows()` in the same file is still used by `/api/exports/attribution` — move it out,
then delete the rest.

---

## D14 · `loadCampaignDraftAction` vs `loadDraft()` · **DELETE**

Exact duplicate. The page uses the server function; the action has no caller.

---

## Bloat classification

Per the taxonomy in the brief:

| Class | Items | Maintenance cost | Defect risk | Data-consistency risk | Migration difficulty | User impact |
|---|---|---|---|---|---|---|
| **Necessary complexity** | Three campaign engines (warm bulk / cold sequenced / per-lead follow-up); two dedupe rules; two run tables; separate affiliate tenancy | high but earned | low | low | n/a | none |
| **Accidental complexity** | D1, D2, D5, D6, D9 — one concept, several implementations | high | **high** | **high** | medium | wrong data, wrong compliance |
| **Data duplication** | D7 suppression, D11 entitlements, D3 metric formulas | medium | high | **high** | medium–high | compliance and billing |
| **Dead functionality** | 27 orphan actions, 41 orphan modules, 15 unreferenced tables — [20](20-dead-code-register.md) | medium | low | none | low | none |
| **Legacy functionality** | `analytics/queries.ts`, `components/campaigns/*`, `automations/automation-editor.tsx`, `settings/billing-actions.tsx`, `affiliates/links-view.tsx`, 11 legacy marketing components | medium | low | none | low | none |
| **Cosmetic duplication** | Two settings-view components; two links-view components; singular/plural prospect actions (D8) | low | low | none | low | none |
| **Process duplication** | Warm and cold both implement enrolment→schedule→send→reply→stop separately | high | medium | medium | **high** | none today |
| **Premature abstraction** | `usage_reservations` + `expire_usage_reservations()`; `sync_runs`/`sync_conflicts`/`external_entity_links`; `field_mappings`; `mcp_scopes`; `agent_budgets` — frameworks built for cases that never arrived | low | low | none | low | none |
| **Missing abstraction** | No event bus ([15](15-event-catalogue.md)); no canonical service layer ([22](22-final-target-architecture.md)); no shared metric definition ([D3](#d3)) | — | **high** | **high** | medium | the P0s in this report |

**The pattern is consistent.** ClientTurn is not suffering from too many abstractions — the
abstractions it has (OAuth framework, send core, job queue, policy engine, prompt registry,
metric registry, campaign transition table) are good ones. It is suffering from **interfaces and
surfaces that were built beside those abstractions instead of on top of them**. Every P0 in this
audit is an instance of that single pattern.
