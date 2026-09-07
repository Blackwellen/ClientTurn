# 20 · Dead Code and Orphan Register

Nothing here should be deleted on the strength of this document alone. Each entry states how
absence of use was established and what to check before removing it.

**Method.** Orphan modules were found by resolving every `import`/`from` specifier in all 989
`src/**/*.ts(x)` files to a repository path (alias `@/…` and relative `./`, `../`, with `.ts`,
`.tsx` and `/index` resolution), then subtracting from the file list, excluding Next.js entry
points. Orphan actions and tables were found by word-boundary grep across the same file set,
excluding the generated `database.types.ts`. **Dynamic imports are included** in the specifier
scan, so `await import("./handlers")` is counted.

**What this method cannot see:** string-keyed dynamic resolution (none found), and anything
referenced only from outside `src/` (the `tests/` and `scripts/` directories were not counted as
usage, deliberately — a module used only by a test is still product-dead).

---

## 1 · Orphan modules — 41

### Product code (13) — safe to delete after the dependency check

| File | Superseded by | Check before deleting |
|---|---|---|
| `src/components/campaigns/campaign-actions.tsx` | `components/reactivation/campaign-overflow-menu.tsx` | The whole `components/campaigns/` directory goes |
| `src/components/campaigns/campaign-contacts-table.tsx` | `components/reactivation/*` | " |
| `src/components/automations/automation-editor.tsx` | `components/follow-up/sequence-editor.tsx` | **Read §3 first** — deleting this removes the only draft-then-publish UI for follow-up |
| `src/components/automations/create-automation-button.tsx` | inline creation in `follow-up-workspace.tsx` | — |
| `src/components/automations/quiet-hours-card.tsx` | `components/follow-up/quiet-hours-card.tsx` | Two near-identical components; keep the Follow-Up one |
| `src/components/settings/billing-actions.tsx` | `components/settings/billing/billing-settings.tsx` | — |
| `src/components/integrations/integration-card.tsx` | `components/settings/connections/connection-setup-drawer.tsx` | `components/integrations/` also holds `brand-marks`, which **is** used |
| `src/components/affiliates/links-view.tsx` | `components/affiliates/links/links-view.tsx` | Same basename — the earlier orphan scan missed this; confirmed by path resolution |
| `src/components/affiliates/profile-form.tsx` | `components/affiliates/settings/settings-view.tsx` | — |
| `src/components/affiliates/payment-details-form.tsx` | " | — |
| `src/components/affiliates/click-sparkline.tsx` | — | Check whether a performance chart is meant to use it |
| `src/components/affiliates/copy-block.tsx` | — | " |
| `src/components/reactivation/audience-source-selector.tsx` | `reactivation/wizard/audience-step.tsx` | — |
| `src/components/reactivation/campaign-filters.tsx` | filters inline in `reactivation-view.tsx` | — |
| `src/components/find-leads/coming-soon-view.tsx` | — | Deliberate placeholder for unbuilt views. **Its own doc comment says it must not ship to a paying workspace.** Now unused — delete it |
| `src/components/find-leads/usage-summary.tsx` | `find-leads/kpi-strip.tsx` | Also contains one of the 21 broken `?view=billing` links |
| `src/components/app/health-banner.tsx` | `components/dashboard/health-strip.tsx` | — |
| `src/components/auth/product-preview.tsx` | — | Check the auth layout design intent |
| `src/lib/bookings/actions.ts` | — | **Read §3** — this is the only booking status writer |
| `src/lib/ai/context-builder.ts` | context built inline per task | Check whether `runTask` callers should be using it |

### Legacy marketing components (11) — superseded by `components/marketing/public/*`

`analytics-preview.tsx` · `conversation-demo.tsx` · `faq.tsx` · `final-cta.tsx` ·
`funnel-visual.tsx` · `hero.tsx` · `hero-visual.tsx` · `how-it-works.tsx` · `industries.tsx` ·
`integration-strip.tsx` · `landing-motion.tsx` · `marketing-footer.tsx` · `marketing-header.tsx` ·
`outcome-cards.tsx` · `pain-timeline.tsx` · `pricing.tsx` · `reactivation.tsx` ·
`why-it-works.tsx` · `clientturn-story/ClientTurnStory.tsx` · `world/ClientTurnExperience.tsx`

The last two are the Three.js scroll experience. **Check with the user before deleting those** —
`CLAUDE.md` describes the landing page as *"a near-black (#050814) Three.js / Motion scroll
experience"*, so if that is still the intended landing page these are not dead, they are
disconnected, which is a different and more urgent problem.

### False positives to ignore

| File | Why it looked orphaned |
|---|---|
| `src/app/layout.tsx` | Root layout — a Next.js entry point the exclusion regex missed |
| `src/proxy.ts` | **Next.js 16 middleware.** This is live and load-bearing — it does the Supabase session refresh and the `status.` host rewrite |
| `src/lib/supabase/proxy-session.ts` | Imported by `src/proxy.ts` |

## 2 · Orphan server actions — 27

Full table with recommendations in [13 · §4](13-page-action-button-audit.md). Summary:

**DELETE (12):** `moveQuestion`, `deleteRule`, `previewQualification`, `changePassword`,
`markQualification`, `setFollowUpPaused`, `getTokenOverview`, `getEmailAccount`,
`listCopilotMessages`, `acceptAnalysisFactsAction`, `updateAcquisitionProfileAction`,
`loadCampaignDraftAction`, `createCampaignAction`.

**KEEP + FIX — the missing UI is a real gap (15):** `updateBookingStatus`, `verifyFact`,
`setRowClassification`, `assignHandoff`, `saveOptimizationConfigAction`,
`rebuildCampaignAudienceAction`, `sendPayout`, `retryPayout`, `adjustAffiliateLedger`,
`createPolicyVersion`, `exportComplianceAudit`, `updateLinkUtm`, `attachPromoCode`,
`checkSlugAvailable`.

## 3 · Three orphans that are gaps, not waste

These three deserve a decision rather than a delete.

| Orphan | What is lost |
|---|---|
| `lib/bookings/actions.ts` (`updateBookingStatus`) | Bookings can never leave `scheduled`. No-show and completion are unrecordable, so booking→won conversion cannot be measured |
| `components/automations/automation-editor.tsx` | Follow-Up now edits the **live** sequence directly through `updateFollowUpSequence`. The draft-then-publish safety that Qualification still has, Follow-Up has lost. Whether that is intended is a product decision |
| `imports/actions.setRowClassification` | Per-row relationship classification on a CSV import. That is a lawful-basis decision, not a convenience feature |

## 4 · Unreferenced tables — 15

Established by grepping each table name across all `src/**/*.ts(x)`.

| Table | Migration | Assessment | Verdict |
|---|---|---|---|
| `usage_reservations` | 0032 | Nothing writes it. `expire_usage_reservations()` is called nightly by `/api/cron/daily` against an always-empty table | **DEPRECATE FIRST** — decide whether reservations are wanted; the sourcing budget guard uses compare-and-swap instead and works |
| `outreach_runs` | 0029 | Per-day campaign run rollup. The dispatcher never opens or closes one | DEPRECATE FIRST |
| `campaign_learnings` | 0029 | The "Learn" quarter of the V4 thesis | **KEEP** — P2-7 is to write it, not drop it |
| `search_feedback` | 0027 | Feedback loop into search planning | **KEEP** — same |
| `agent_tool_calls` | 0032 | Structured tool log for worker agents | **KEEP** — P2-9 |
| `agent_budgets` | 0032 | Per-agent spend ceiling | **KEEP** — P2-9 |
| `business_playbooks` | 0025 | No design reference found | SAFE TO DELETE |
| `icp_segments` | 0025 | ICP sub-segments; `icp_profiles` carries the whole definition | SAFE TO DELETE |
| `lead_import_mappings` | 0031 | Saved column mappings | SAFE TO DELETE unless the feature is planned |
| `mcp_scopes` | 0035 | Scopes are a hard-coded union in `mcp/tools.ts` | **Decide:** make the table authoritative, or delete |
| `external_entity_links` | 0035 | Bidirectional sync | DEPRECATE FIRST — with `sync_runs`/`sync_conflicts` |
| `sync_conflicts` | 0035 | " | " |
| `sync_runs` | 0035 | " (also unreferenced) | " |
| `ai_prompt_versions` | 0018 | Superseded by the in-code `PROMPT_REGISTRY` | SAFE TO DELETE |
| `workspace_app_events` | 0045 | Written by `receive_workspace_app_event()` SQL, read by nothing | **KEEP** — needs an admin reader (P2-15) |

**Not dead, despite appearing so:** `rate_limits` — reached only through the `consume_rate_limit()`
and `prune_rate_limits()` RPCs, both of which are called.

## 5 · Dead columns

| Table | Columns | Origin |
|---|---|---|
| `conversations` | `inbox_channel_id`, `external_thread_id`, `counterparty_name`, `counterparty_handle`, `counterparty_avatar_url`, `snoozed_until`, `assigned_user_id` | `0044_v4_unified_inbox` — schema for social channels and conversation assignment that was never built |
| `messages` | `inbox_channel_id`, `external_message_id`, `sender_name`, `sender_handle`, `attachments`, `read_at` | " |
| `leads` | `promoted_from_prospect_id`, `promoted_at`, `company_name`, `source_campaign_id`, `sourcing_run_id` | `0038` — **not dead by design, dead by bug.** The promotion routine never writes them (P0-2) |
| `outreach_campaign_usage` | none — all written, some in SQL only | (checked and cleared) |

Do **not** drop the `leads` columns. They are the fix for P0-2, and `leads_promoted_from_idx` was
built for them.

## 6 · Other

| Item | Status |
|---|---|
| `supabase/migrations/9999_qa_seed_temp.sql` | Untracked in git, named temporary. **Must not reach production.** Move it to `scripts/` or add it to `.gitignore` with a note |
| `scripts/_diag1.mjs`, `scripts/visual-check.mjs`, `scripts/e2e-public-pages.mjs`, `tests/visual/` | Untracked working files. Decide: commit as tooling, or ignore |
| `src/lib/app/nav.ts` `TITLES` entry for `/app/status` | The status page is at `/status`, outside the app shell. Dead mapping |
| `src/components/find-leads/coming-soon-view.tsx` | Its own comment says it must not ship. Now unused — delete |
| `dev-run.log`, `lint-story.json`, `lint-world.json`, `tsconfig.scratch.tsbuildinfo` | Build detritus at the repository root |

## 7 · Suggested deletion order

Dependencies first, so nothing is deleted while something still points at it.

1. **Actions with no caller and no missing UI** (the 12 DELETE items in §2) — zero risk.
2. **Orphan components** (§1 product code, minus the three in §3) — verify each with a fresh
   resolution scan immediately before deleting.
3. **`components/campaigns/` and `analytics/queries.ts`** after moving `getAttributionRows` out.
4. **Legacy marketing components** — only after confirming the landing-page direction with the
   user.
5. **`ai_prompt_versions`, `business_playbooks`, `icp_segments`, `lead_import_mappings`** — after
   confirming no external tooling reads them (Supabase dashboards, exports, BI).
6. **Everything marked DEPRECATE FIRST** — leave in place for one release with a comment stating
   the decision date, then remove.

Nothing in §3, §4-KEEP or §5 should be deleted at all — those are gaps to close.
