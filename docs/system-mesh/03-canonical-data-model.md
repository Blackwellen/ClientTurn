# 03 · Canonical Data Model

For each candidate entity in the brief: what it should be in ClientTurn, what it currently is,
and whether it needs to exist at all. The rule applied throughout is *minimum necessary
complexity*, not minimum table count — a genuinely different lifecycle earns a table; a different
label for the same lifecycle does not.

Legend: **ENTITY** = first-class table · **STATE** = enum/column on an existing entity ·
**DERIVED** = computed, never stored · **REL** = relationship table · **EVENT** = append-only
log · **REMOVE** = should not exist.

---

## 1. Identity and tenancy

| Candidate | Verdict | Current | Note |
|---|---|---|---|
| User | **ENTITY** | `auth.users` + `profiles` | Correct |
| Workspace | **ENTITY** | `businesses` | Correct. Named `business` throughout; the UI says "workspace". Vocabulary drift, not a data problem |
| Workspace Membership | **REL** | `business_members` | Correct |
| Role | **STATE** | `business_members.role` (owner/admin/member) | Correct. Do not promote to a table |
| Permission | **DERIVED** | `hasRole()` ladder | Correct — three roles do not justify a permission matrix |
| Team | **REMOVE** | absent | A workspace *is* the team at this scale |
| Invitation | **ENTITY** | handled in `auth/invites.ts` + `business_members.status` | Acceptable |

## 2. Business knowledge

| Candidate | Verdict | Current |
|---|---|---|
| Business Profile | **ENTITY** | `business_profiles` (fact rows with source + lock + verification) — a strong model |
| Service | **ENTITY** | `services` |
| Product/Offer | **REMOVE** | Folded into `services`. Correct for home services |
| ICP | **ENTITY** | `icp_profiles` |
| Persona / Target Market | **STATE** | fields on `icp_profiles` |
| Territory | **STATE** | `icp_profiles.location_json` + `outreach_campaigns` geography |
| Exclusion | **STATE** | `prospect_companies.excluded` + `suppression_entries` |
| Goal | **ENTITY** | `conversion_goals` |
| ICP Segment | **REMOVE** | `icp_segments` table exists and is **never referenced** |

## 3. Prospecting

| Candidate | Verdict | Current |
|---|---|---|
| Company | **ENTITY** | `prospect_companies` with a `dedupe_key` unique index |
| Person/Contact | **ENTITY** | `prospects` — see §5 on the Contact question |
| Prospect | **ENTITY** | `prospects` |
| Prospect Source | **EVENT** | `prospect_data_sources` — field-level provenance. Best-designed table in the schema |
| Prospect Search | **ENTITY** | `search_sessions` + `search_strategies` |
| Search Run | **ENTITY** | `sourcing_runs` + `sourcing_run_stages/queries/results/issues` |
| Search Result | **ENTITY** | `sourcing_run_results` |
| Sourcing Provider | **REFERENCE** | `platform_providers` + `provider_price_book` (platform-owned, correct) |
| Intent Signal | **ENTITY** | `intent_events` + `prospect_intent_matches` |
| Intent Monitor | **ENTITY** | `intent_monitors` |
| Enrichment Record | **ENTITY** | `prospect_enrichments` |
| Verification Record | **ENTITY** | `prospect_verifications` |
| Provenance Record | **ENTITY** | `prospect_data_sources` (same as Prospect Source — one table, correctly) |

## 4. Lead management

| Candidate | Verdict | Current |
|---|---|---|
| Lead | **ENTITY** | `leads` |
| Lead Source | **ENTITY** | `lead_sources` (ad platforms) |
| Lead Stage | **STATE** | `leads.status` |
| Lead Grade | **STATE** | on `prospects` only. Leads carry no grade — correct, a lead is qualified not graded |
| Qualification | **ENTITY** | `qualification_questions/options/rules/answers` |
| Assignment | **REL + STATE** | `leads.assigned_user_id` (current) + `lead_assignments` (history). Correct pattern — **but only one of the three assign implementations writes the history table** |
| Tag | **STATE** | `campaigns.tags` only. Leads have no tags. Acceptable omission |
| Note | **STATE** | `leads.notes` free text. No threaded notes on leads (support tickets have them) |
| Task | **REMOVE** | Absent. `agent_queue_items` and `needs_attention` cover the real need |
| Activity | **DERIVED** | Assembled from `messages`, `audit_log`, `automation_runs` at read time |

## 5. The Contact question

The brief asks whether a canonical `Person` / `Contact` should sit under both Prospect and Lead.
**Recommendation: no — but fix the lineage instead.**

Today the same human can exist as a `prospects` row and a `leads` row, with `email`, name and
phone duplicated across both. That looks like the "same fact in five places" anti-pattern, and it
is not, because the two rows describe *different relationships to the business*, and the
`leads` copy is deliberately a **snapshot at promotion** — the cold record must stay frozen for
provenance while the warm record is edited by the operator.

That design is right. What is wrong is that the snapshot is incomplete and the link is not
populated:

- `leads.promoted_from_prospect_id` and `leads.promoted_at` were added in `0038` and are
  **never written** — the promotion routine does not set them.
- `prospect_companies` is never carried across; `leads.company_name` stays null.
- `leads.phone_normalized` is not populated on promotion, so a promoted lead is invisible to
  duplicate detection and may be unreachable by SMS.

So: keep two entities, **fix the promotion routine** so the reference exists and the snapshot is
complete. Detail in [06](06-prospect-lead-data-flow.md) and [17](17-data-lineage.md).

The other identity duplications named in the brief do **not** exist here — there is no
`contacts` table, and `campaign_contacts` / `conversations` hold foreign keys rather than
copied email addresses. Verified: `campaign_contacts` has `lead_id` only; `conversations` has
`lead_id` / `prospect_id` only.

## 6. Communication

| Candidate | Verdict | Current |
|---|---|---|
| Conversation | **ENTITY** | `conversations` — one table, cross-channel, lead *and/or* prospect. Correct |
| Message | **ENTITY** | `messages` — one table, all channels. Correct |
| Email / SMS / WhatsApp Message | **REMOVE** | Correctly absent. `messages.channel` is the discriminator |
| Message Delivery | **EVENT** | `message_events` (provider callbacks) + status columns |
| Conversation Participant | **REMOVE** | Two-party by definition here |
| Reply | **STATE** | `messages.direction='inbound'` + `reply_classification` |
| Attachment | **STATE** | `messages.attachments` jsonb — **never written** |
| Template | **ENTITY** | `outreach_steps.body_template`, `automation_steps`, `campaigns.message_template`. **Three template models** — see [18 · D4](18-duplication-bloat-register.md) |
| Snippet | **REMOVE** | Not needed |

**The canonical Message abstraction already exists and is correct.** This is the single best
structural decision in the codebase and the target architecture keeps it unchanged.

## 7. Outreach

| Candidate | Verdict | Current |
|---|---|---|
| Campaign | **ENTITY ×2** | `campaigns` (warm bulk) and `outreach_campaigns` (cold sequenced). **Keep both** — different lifecycle, audience source, budget model and compliance basis. Rename in the UI: "Reactivation campaign" vs "Acquisition campaign" |
| Campaign Audience | **STATE + DERIVED** | `campaigns.filter_config` / `outreach_campaigns.audience_json`, materialised into membership |
| Sequence | **ENTITY** | `outreach_sequences` (cold), `automation_versions` (warm). Two models for one concept |
| Sequence Step | **ENTITY** | `outreach_steps` / `automation_steps` |
| Campaign Membership | **ENTITY ×2** | `campaign_contacts` / `outreach_recipient_runs` |
| Follow-Up | **NOT AN ENTITY** | See §Follow-Up below |
| Schedule / Sending Window | **STATE** | `campaigns.send_window_*`, `business_settings` quiet hours |
| Sender/Mailbox | **ENTITY** | `mailbox_connections` + `sender_identities`. Correct split |
| Suppression | **ENTITY** | `contact_suppressions` (V3) + `suppression_entries` (V4) — **two suppression lists**, see [11](11-compliance-permission-mesh.md) |

### Follow-Up

Follow-Up is **not** a domain, a campaign type or an entity. It is a **lead lifecycle automation**
— one `automation_definitions` row per workspace, versioned, with steps, driven by
`automation.advance`. The UI at `/app/follow-up` is an editor for that one definition plus the
qualification config. That is the correct shape and should be stated explicitly in the docs,
because the current code spreads it over `lib/automation`, `lib/automations` and `lib/follow-up`
and reads like three things.

### Reactivation

**Reactivation should stay a campaign type, and it already is.** `0022_reactivation.sql` adds
columns to `campaigns` and creates no new tables — the migration says so in its header. The
Reactivation UI is a purpose-built wizard over the shared campaign engine. Correct.
The only duplication is UI-side (`reactivation/campaign-filters.tsx` and
`reactivation/audience-source-selector.tsx` are orphaned).

## 8. Sales progression

| Candidate | Verdict | Current |
|---|---|---|
| Opportunity | **REMOVE** | Not modelled, and should not be. `leads.status` + `estimated_value` carry it |
| Booking | **ENTITY** | `bookings` |
| Handover | **ENTITY** | `agent_handoffs` |
| Outcome / Conversion | **STATE** | `leads.status` WON/LOST + timestamps |
| Revenue | **STATE** | `leads.estimated_value`. No invoicing — correct for this product |

## 9. AI and automation

| Candidate | Verdict | Current |
|---|---|---|
| Agent | **ENTITY** | `agents` (worker agents). The conversational agent is *not* an entity — it is a runtime |
| Agent Configuration | **STATE** | columns on `agents` + `agent_sources` |
| Agent Run | **ENTITY** | `agent_runs` (worker) + `conversation_agent_runs` (conversational). Two run tables for two genuinely different things — acceptable, badly named |
| Agent Step / Tool Call | **ENTITY** | `conversation_agent_actions` used; `agent_tool_calls` **never referenced** |
| Automation / Trigger / Action / Execution | **ENTITY** | `automation_definitions/steps/runs` |
| Retry | **STATE** | `jobs.attempts` + backoff |
| Dead Letter | **STATE** | `jobs.state='dead_letter'` |
| Copilot Conversation | **ENTITY** | `copilot_sessions` + `copilot_messages` + `copilot_actions` |
| AI Request | **EVENT** | `ai_runs` |
| AI Usage | **EVENT** | `ai_token_ledger` + `usage_events` |

## 10. Integrations

All present and correctly shaped: `integrations`, `integration_secrets` (envelope-encrypted,
server-only), `integration_oauth_states`, `webhook_events`, `sync_runs`, `field_mappings`,
`integration_objects`, `external_connections`, `workspace_app_installs`.

**REMOVE candidates:** `external_entity_links` and `sync_conflicts` are never referenced.

## 11. Governance

| Candidate | Verdict | Current |
|---|---|---|
| Consent | **ENTITY** | `contact_permissions` |
| Contactability Decision | **ENTITY** | `contactability_results` (current state) + `compliance_decisions` (audit trail). Correct two-table split |
| Suppression Record | **ENTITY ×2** | Should be one — see [11](11-compliance-permission-mesh.md) |
| Data Provenance | **ENTITY** | `prospect_data_sources` |
| Data Retention Rule | **STATE** | `business_settings` + `retention.cleanup` job |
| Deletion Request | **ENTITY** | `privacy_requests` |
| Audit Event | **EVENT** | `audit_log` |

## 12. Billing and usage

| Candidate | Verdict | Current |
|---|---|---|
| Subscription | **ENTITY** | `subscriptions` |
| Plan | **REFERENCE** | `PLANS` in code + `plan_entitlements` in DB. **Two sources** |
| Entitlement | **ENTITY** | `plan_entitlements` + `business_entitlement_grants` — the right model. Migrate the V3 boolean columns into it |
| Usage Ledger | **EVENT** | `usage_events` should be the one ledger. Today: `usage_events`, `usage_counters`, `cost_events`, `ai_token_ledger`, `outreach_campaign_usage`, `customer_usage_allocations` |
| Overage / Top-Up | **ENTITY** | `ai_token_purchases`, `billing_credit_entries` |
| Usage Reservation | **REMOVE or IMPLEMENT** | `usage_reservations` table + `expire_usage_reservations()` RPC exist; nothing ever writes a reservation |

---

## Summary of model changes proposed

| Change | Type | Section |
|---|---|---|
| Populate `leads.promoted_from_prospect_id`, `promoted_at`, `company_name`, `phone_normalized` on promotion | **MIGRATION REQUIRED** | [06](06-prospect-lead-data-flow.md) |
| Merge `contact_suppressions` into `suppression_entries` | MERGE REQUIRED | [11](11-compliance-permission-mesh.md) |
| Move V3 plan booleans into `plan_entitlements` | MIGRATION REQUIRED | [12](12-usage-billing-mesh.md) |
| Make `usage_events` the single ledger; derive `usage_counters` | MIGRATION REQUIRED | [12](12-usage-billing-mesh.md) |
| Drop `icp_segments`, `external_entity_links`, `sync_conflicts`, `agent_tool_calls`, `agent_budgets`, `business_playbooks`, `lead_import_mappings`, `mcp_scopes`, `search_feedback`, `campaign_learnings`, `ai_prompt_versions` | SAFE TO DELETE after dependency check | [20](20-dead-code-register.md) |
| Decide `usage_reservations` and `outreach_runs`: implement or drop | DEPRECATE FIRST | [20](20-dead-code-register.md) |
