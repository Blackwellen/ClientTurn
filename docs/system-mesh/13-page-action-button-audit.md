# 13 · Page, Action and Button Audit

## Coverage statement

This register was built by enumerating **every file containing `"use server"`** (41 files, 255
exported functions), then tracing each export to its call sites across all 989 `.ts`/`.tsx` files,
then reading the component that calls it. Every server action in the product appears below in one
of the status tables.

What this register does **not** claim: that every one of the several hundred rendered controls
was clicked. Pure-navigation controls (links, tabs, view toggles, filter chips, sort headers) are
not individually listed — they are URL state and are covered by
[01](01-route-page-inventory.md). Where a control's status is inferred from its wiring rather than
from execution, it is marked *(inferred)*.

Status vocabulary: **WORKING** · **PARTIAL** · **UI-ONLY** · **DEAD** · **DUPLICATE** ·
**DANGEROUS** · **MISSING-CHECK**.

---

## 1 · Summary

| Status | Count | |
|---|---|---|
| WORKING | ~200 | Traced from a rendered control to a service to a DB write |
| DEAD — no caller anywhere | 27 | §4 |
| DEAD — only caller is an orphan component | 11 actions across 9 orphan components | §4 |
| DUPLICATE | 8 | §5 |
| PARTIAL | 6 | §6 |
| MISSING-CHECK | 5 | §7 |
| BROKEN | 2 | §8 |
| DANGEROUS | 0 | §10 |

## 2 · Working actions by surface

Listed compactly; each row is action → component → primary table.

### Dashboard `/app`
Read-only. No mutating actions. `NeedsAttentionPanel` links into Leads; `HealthStrip` links into
Settings → Connections. **Correct** — the Dashboard owns no logic.

### Leads `/app/leads`
`lead-drawer-host.tsx` → `assignLead`, `updateLeadStatus`, `markWon`, `markLost`,
`humanTakeover`, `resumeAutomation`, `sendBookingLink`, `sendManualMessage`, `setNeedsAttention`,
`setQualificationResult` → `leads`, `lead_assignments`, `messages`, `audit_log`.
`add-lead-wizard.tsx` → `checkLeadDuplicates`, `checkContactability`, `createManualLead`,
`createProspectFromWizard`; `enquiry-step.tsx` → `addAllowedService`.
`import-wizard.tsx` → `createImport`, `commitImport`.

### Find Leads `/app/find-leads`
Discover: `analyseBusinessAction`, `createSearchSessionAction`, `renameSearchSessionAction`,
`archiveSearchSessionAction`, `duplicateSearchSessionAction`, `createRecurringSearchAction`,
`setRecurringSearchStatusAction`, `deleteRecurringSearchAction`.
Search session: `sendSearchMessageAction`, `updateSearchPlanAction`, `previewBudgetAction`,
`startSourcingRunAction`.
Run: `pauseSourcingRunAction`, `resumeSourcingRunAction`, `stopSourcingRunAction`,
`increaseRunTargetAction`.
Prospects: `approveProspectAction`, `promoteProspectToLeadAction`, `suppressProspectAction`,
`refreshProspectResearchAction`, `generateResearchSummaryAction` (drawer);
`approveProspectsAction`, `markProspectsForReviewAction`, `suppressProspectsAction`,
`removeProspectsFromCampaignAction`, `addProspectsToCampaignAction` (bulk bar).
Intent: `saveIntentCategory`, `setIntentCategoryActive`, `createIntentMonitor`,
`controlIntentMonitor`.
Campaigns: `createSenderIdentityAction`, `launchCampaignAction`, `setCampaignStatusAction`
(builder) **and** `saveCampaignDraftAction`, `estimateAudienceAction`, `validateCampaignAction`,
`launchAcquisitionCampaignAction`, `generateVariantsAction`, `setCampaignStateAction`,
`setCampaignPriorityAction`, `duplicateCampaignAction`, `archiveCampaignAction` (wizard +
detail). See §5 — two implementations.

### Inbox `/app/inbox`
`inbox-controls.tsx` → `inboxAction` (read / archive / restore / reply).
`agent-panel.tsx` → `acknowledgeHandoff`, `resolveHandoff`, `cancelHandoff`, `updateDraft`,
`sendDraft`, `discardDraft`, `takeOverConversation`, `returnConversationToAi`.

### Agents `/app/agents`
`agent-controls.tsx` → `controlAgent`; `agent-wizard.tsx` → `saveAgent`.

### Follow-Up `/app/follow-up`
`follow-up-workspace.tsx`, `sequence-editor.tsx` → `createAutomation`,
`updateFollowUpSequence`; `status-card.tsx` → `setAutomationEnabled`;
`quiet-hours-card.tsx` → `saveQuietHours`, `saveFollowUpTimezone`;
`booking-reminder-card.tsx` → `createAutomation`, `setAutomationEnabled`,
`updateFollowUpSequence`; `test-follow-up-panel.tsx` → `sendFollowUpTest`.
Qualification view → `qualification-editor.tsx` → `publishQualification` (one bulk publish).

### Reactivation `/app/reactivation`
`reactivation-wizard.tsx` → `previewAudience`, `createCampaign`;
`wizard/csv-import.tsx` → `analyseImportFile`, `previewImportFile`, `confirmImportFile`;
`campaign-overflow-menu.tsx` → `launchCampaign`, `pauseCampaign`, `resumeCampaign`,
`cancelCampaign`, `duplicateCampaign`, `deleteDraftCampaign`;
`campaign-table.tsx` → same subset; `campaign-edit-dialog.tsx` → `updateCampaignDetails`.

### Settings `/app/settings`
Workspace: `saveWorkspaceSettings`, `saveService`, `deleteService`, `createLogoUploadUrl`,
`saveBusinessLogo`, `removeBusinessLogo`, `updateMessagingSettings`, `updateSlackChannel`,
`updateBookingSettings`, `saveAiBehaviour`.
Connections: `testConnection`, `refreshConnectionHealth`, `connectProviderToken`,
`disconnectIntegration`, `testEmailAccount`, `saveEmailConnection`, `sendEmailConnectionTest`,
`disconnectEmail`, `listAppInstalls`, `generateConnectorSecret`, `installWorkspaceApp`,
`uninstallWorkspaceApp`.
Business Profile: `saveFact`, `deleteFact`, `setFactLocked`, `saveIcpProfile`, `setIcpActive`,
`saveConversionGoal`, `saveOutreachGuidance`, `analyseWebsite`.
Team: `inviteMember`, `changeMemberRole`, `removeMember`.
Billing: `openBillingPortal`, `startPlanCheckout`, `startTokenTopUp`, `saveAllocation`,
`saveDailyCaps`, `saveOverage`.
Danger zone: `exportWorkspaceData`, `deleteWorkspace`.
Account dialog: `loadAccountPreferences`, `updateProfile`, `updateNotificationPreferences`,
`requestOwnPasswordReset`.

### Support, Copilot, Onboarding, Auth, Admin, Affiliates
All traced and wired. Admin: 40 actions across customers, support, affiliates, billing,
compliance, jobs, settings — every one reaches a rendered control except the four in §4.

## 3 · Cross-cutting properties, measured

| Property | Finding |
|---|---|
| **Permission** | Every mutating action begins with `requireRole(...)` or `requireWorkspace()` and derives `businessId` from the session. No action accepts `businessId` from the client. Spot-checked across all 41 action files by grep; no exception found |
| **Validation** | Zod on every action input. Consistent |
| **Error surfacing** | Uniform `{ ok: false, error }` discriminated result, rendered as a toast. Consistent — with one harmful exception, §8 |
| **Audit** | `recordAudit()` on high-impact actions. **Not** on every mutation — e.g. `saveWorkspaceSettings`, `saveService`, `updateBookingSettings` write no audit row |
| **Idempotency** | Strong on the paths that matter: `send_key` on messages, `idempotency_key` on jobs, `FOR UPDATE` in `promote_reviewed_prospect`, compare-and-swap on `agents.next_run_at` and `sourcing_runs.spent_cost_minor`, atomic SQL slot claims for campaign and sender caps |
| **Double-click** | Every audited component uses a `pending`/`submitting` state to disable its control. That is a UI guard, not a server guard — but the server-side idempotency above covers the cases where a duplicate would be expensive |
| **Optimistic updates** | Used sparingly (`notification-tray.tsx`). Most actions `revalidatePath` and re-render |
| **Loading/empty/error/permission/plan-limit states** | `ui/feedback.tsx` provides `EmptyState`, `PlanLimitState`, error states; routes have `loading.tsx` and `error.tsx`. Coverage is good but not universal — `/app/analytics`, `/app/leads/import` and `/app/agents/new` have no `loading.tsx` |

## 4 · DEAD — actions with no reachable caller

Verified by whole-repository word-boundary grep. Each returns only its own definition file.

| Action | File | Why it is dead | Recommendation |
|---|---|---|---|
| `moveQuestion` | `qualification/actions.ts` | The editor is a client-side draft published in bulk by `publishQualification`; reordering happens in local state | **DELETE** |
| `deleteRule` | `qualification/actions.ts` | Same | **DELETE** |
| `previewQualification` | `qualification/actions.ts` | Preview runs client-side through `qualification/preview.ts` | **DELETE** |
| `changePassword` | `settings/actions.ts` | Superseded by `requestOwnPasswordReset` (email link) | **DELETE** |
| `updateBookingStatus` | `bookings/actions.ts` | No booking detail surface exists | **KEEP + FIX** — bookings cannot be marked completed or no-show anywhere |
| `verifyFact` | `business-profile/actions.ts` | Business Profile has lock and delete, no verify | **KEEP + FIX** — `business_profiles.verified_*` is otherwise unreachable |
| `setRowClassification` | `imports/actions.ts` | The import wizard classifies the whole file, not per row | **KEEP + FIX** — per-row relationship review is a compliance affordance |
| `markQualification` | `leads/actions.ts` | Superseded by `setQualificationResult` | **DELETE** |
| `setFollowUpPaused` | `leads/actions.ts` | Superseded by `humanTakeover` / `resumeAutomation` | **DELETE** |
| `assignHandoff` | `agent/actions.ts` | Agent panel offers acknowledge/resolve/cancel only | **KEEP + FIX** — handoffs cannot be routed to a colleague |
| `getTokenOverview` | `billing/token-actions.ts` | Token meter reads server-side instead | **DELETE** |
| `getEmailAccount` | `email/actions.ts` | Panel is server-rendered | **DELETE** |
| `listCopilotMessages` | `copilot/actions.ts` | History is loaded with the session | **DELETE** |
| `acceptAnalysisFactsAction` | `find-leads/actions.ts` | Business analysis writes facts directly | **DELETE** |
| `updateAcquisitionProfileAction` | `find-leads/actions.ts` | Superseded by the Business Profile section | **DELETE** |
| `saveOptimizationConfigAction` | `outreach/campaign-actions.ts` | `auto_optimize` is set at launch only | **KEEP + FIX** — a running campaign cannot have optimisation turned off |
| `rebuildCampaignAudienceAction` | `outreach/campaign-actions.ts` | No "rebuild audience" control on campaign detail | **KEEP + FIX** — a campaign whose ICP changed cannot be refreshed |
| `loadCampaignDraftAction` | `outreach/campaign-actions.ts` | The page loads the draft server-side via `loadDraft()` | **DELETE** — exact duplicate |
| `createCampaignAction` | `outreach/actions.ts` | Superseded by `createCampaignDraftAction` | **DELETE** with the rest of §5 |
| `sendPayout` | `admin/affiliate-actions.ts` | Admin affiliates view wires approve/reject/suspend/reinstate/commission/markPaid but not send | **KEEP + FIX** — payouts can be marked paid but not actually sent through Stripe Connect |
| `retryPayout` | `admin/affiliate-actions.ts` | Same | **KEEP + FIX** — a failed payout has no retry control |
| `adjustAffiliateLedger` | `admin/affiliate-actions.ts` | Same | **KEEP + FIX** — no manual ledger correction |
| `createPolicyVersion` | `admin/compliance-actions.ts` | The compliance view wires publish and archive, not create | **KEEP + FIX** — a new compliance pack cannot be created in the product |
| `exportComplianceAudit` | `admin/compliance-actions.ts` | No export control | **KEEP + FIX** |
| `updateLinkUtm` | `affiliates/link-actions.ts` | Not wired | **KEEP + FIX** |
| `attachPromoCode` | `affiliates/link-actions.ts` | Not wired | **KEEP + FIX** |
| `checkSlugAvailable` | `affiliates/link-actions.ts` | Link creation does not check slug availability before submitting | **KEEP + FIX** |

`createPolicyVersion` is the most consequential of these: the compliance pack is the versioned
rule set the whole ChannelPolicyService reads, and there is no way to author a new version from
inside the product.

### Dead by orphaned parent

Confirmed with a module-resolution orphan scan (alias and relative imports resolved to repo
paths), not basename matching.

| Action | Only caller | Caller status |
|---|---|---|
| `saveAutomationDraft`, `publishAutomation`, `discardAutomationDraft` | `automations/automation-editor.tsx` | **orphan** |
| `createAutomation` (one of three call sites) | `automations/create-automation-button.tsx` | **orphan** (the other two call sites are live) |
| `saveQuietHours` (one of two call sites) | `automations/quiet-hours-card.tsx` | **orphan** (the Follow-Up copy is live) |
| `launchCampaign`, `pauseCampaign`, `resumeCampaign`, `cancelCampaign` (one call site each) | `campaigns/campaign-actions.tsx` | **orphan** — the whole `src/components/campaigns/` directory is dead, superseded by `components/reactivation/` |
| `updateBookingStatus` | — | `src/lib/bookings/actions.ts` is itself an orphan module |
| `connectProviderToken`, `disconnectIntegration` (one call site each) | `integrations/integration-card.tsx` | **orphan** — superseded by `settings/connections/connection-setup-drawer.tsx` |
| `openBillingPortal`, `startPlanCheckout` (one call site each) | `settings/billing-actions.tsx` | **orphan** — superseded by `settings/billing/billing-settings.tsx` |
| `createLink`, `setLinkArchived`, affiliate `createCampaign` | `affiliates/links-view.tsx` | **orphan** — superseded by `affiliates/links/links-view.tsx` |
| affiliate `updateProfile` | `affiliates/profile-form.tsx` | **orphan** — superseded by `affiliates/settings/settings-view.tsx` |
| `updatePaymentDetails` | `affiliates/payment-details-form.tsx` | **orphan** — same |
| `analyseImportFile`, `previewImportFile`, `confirmImportFile` (one call site each) | `reactivation/audience-source-selector.tsx` | **orphan** (the `wizard/csv-import.tsx` call sites are live) |

`automation-editor.tsx` and `create-automation-button.tsx` are imported by nothing. The
draft-then-publish automation editor was replaced by the direct `updateFollowUpSequence` flow in
`follow-up/sequence-editor.tsx`. `saveAutomationDraft` and `publishAutomation` survive only
because `onboarding/actions.ts` calls them server-to-server.

**Consequence worth naming:** Follow-Up now saves changes to the live sequence directly. The
draft-then-publish safety that Qualification still has, Follow-Up has lost. Whether that is
intended is a product decision, but it is a real behavioural difference between two adjacent
editors on the same page.

## 5 · DUPLICATE

| # | A | B | Verdict |
|---|---|---|---|
| 1 | `outreach/actions.ts` — `createCampaignAction`, `launchCampaignAction`, `setCampaignStatusAction`, `createSenderIdentityAction` driving `campaign-builder.tsx` + `campaign-controls.tsx` | `outreach/campaign-actions.ts` (13 actions) + `campaigns/*` (16 modules) driving `wizard/campaign-wizard.tsx` + `detail/*` | **MERGE.** Keep B. `campaigns-view.tsx` currently renders both, so a workspace has two ways to create and control an acquisition campaign with different validation |
| 2 | `approveProspectAction` (singular) | `approveProspectsAction` (plural) | **MERGE** into one that takes an array |
| 3 | `suppressProspectAction` | `suppressProspectsAction` | **MERGE** |
| 4 | `assignLead` (leads/actions) | `assignLead` (copilot/tool-service) and `assign_lead` (mcp/handlers) | **REPLACE** both with a call to the canonical action — see [10](10-ai-copilot-mcp-mesh.md) |
| 5 | `setNeedsAttention` (leads/actions) | `markAttention` (copilot/tool-service) | **REPLACE** |
| 6 | `updateLeadStatus` (leads/actions) | `update_lead_status` (mcp/handlers) | **REPLACE** |
| 7 | `loadCampaignDraftAction` | `loadDraft()` in `outreach/campaigns/draft.ts` | **DELETE** the action |
| 8 | `saveQuietHours` reachable from both `automations/quiet-hours-card.tsx` (orphan) and `follow-up/quiet-hours-card.tsx` (live) | — | **DELETE** the orphan component |

## 6 · PARTIAL

| Action / control | What works | What does not |
|---|---|---|
| `inboxAction("reply")` | SMS and WhatsApp on a lead conversation | Email, and any prospect conversation. See [07](07-messaging-conversation-mesh.md) |
| Inbox channel tabs | SMS, WhatsApp, Email render | Messenger, Instagram, LinkedIn can never populate — no ingestion exists |
| ~~Settings → Connections "Connect"~~ | **Correction:** this was wrongly listed as broken. Meta, Salesforce, Calendly and Google Calendar all carry `connectPath: null`, which `integrations/queries.ts:130` renders as a disabled "Not yet available" card. The behaviour is correct | — |
| Copilot action chips | 16 of 18 tools | `createSearchSession` and `startSourcingRun` have no `case` in `execute()` and return "That action is not available yet" — after the UI has offered a confirmation dialog |
| MCP high-impact tools | Correctly park in `mcp_approvals` | Nothing reads that table, so they are never approved or executed |
| `runTestLead` (onboarding) | Creates the test lead | `readTestLead` is polled; no timeout path if the job never runs |

## 7 · MISSING-CHECK

| # | Action | Missing | Impact |
|---|---|---|---|
| 1 | `mcp/handlers.create_lead` | `checkLeadDuplicates` | Easiest route in the product to create duplicate leads; `leads` has no unique constraint to catch it |
| 2 | `leads/actions.sendManualMessage` | `policy/service.evaluate()` | No `compliance_decisions` row; reads only `contact_suppressions` |
| 3 | `campaigns/actions.launchCampaign` (reactivation) | `policy/service.evaluate()` | Same |
| 4 | `outreach/campaign-actions.generateVariantsAction` | `hasTokenCapacity()` and usage recording | Unmetered AI spend — see [12 · 12.4](12-usage-billing-mesh.md) |
| 5 | Cold email dispatch | `assertCapacity("email_sent")` | The plan allowance is displayed and never enforced — see [12 · 12.2](12-usage-billing-mesh.md) |

## 8 · BROKEN

| # | Control | Failure |
|---|---|---|
| 1 | **"Promote to lead"** on the prospect drawer, and automatic promotion on a positive reply | `promote_reviewed_prospect()` inserts `status='new'` against an uppercase-only CHECK constraint. Every call raises `23514`. The manual path reports *"Only engaged, unsuppressed prospects can move to Leads. Review the conversation first."* — a plausible message for a completely different cause, which makes the bug look like correct behaviour. See [04 · 4.1](04-database-audit.md) |
| 2 | **21 "Open Connections" / "See plans" / "Add a service" links** across Find Leads, Inbox and Agents | They link to `/app/settings?view=…`; Settings parses only `?section=`. All 21 silently land on the default section. Full list in §9 |

<a id="broken-links"></a>

## 9 · The 21 broken settings deep links

`parseSettingsSection()` reads `params.section` only. These pass `view`:

```
src/app/(app)/app/find-leads/campaigns/new/page.tsx:74            ?view=billing
src/app/(app)/app/find-leads/campaigns/[campaignId]/page.tsx:82   ?view=billing
src/app/(app)/app/find-leads/page.tsx:89                          ?view=billing
src/app/(app)/app/find-leads/runs/[runId]/page.tsx:44             ?view=billing
src/app/(app)/app/find-leads/scoring/[prospectId]/page.tsx:49     ?view=billing
src/app/(app)/app/find-leads/search/[sessionId]/page.tsx:46       ?view=billing
src/components/agents/agent-tabs.tsx:263                          ?view=connections
src/components/find-leads/campaigns/campaigns-view.tsx:155         ?view=connections
src/components/find-leads/campaigns/wizard/budget-step.tsx:183     ?view=billing
src/components/find-leads/campaigns/wizard/goal-step.tsx:162       ?view=services   ← no such section
src/components/find-leads/campaigns/wizard/outreach-step.tsx:198   ?view=connections
src/components/find-leads/discover/acquisition-profile-card.tsx:265 ?view=workspace
src/components/find-leads/discover/side-cards.tsx:109              ?view=billing
src/components/find-leads/discover/side-cards.tsx:143              ?view=billing
src/components/find-leads/usage-summary.tsx:41                     ?view=billing    ← orphan component
src/components/inbox/agent-panel.tsx:92                            ?view=workspace
src/components/inbox/inbox-view.tsx:72                             ?view=connections
src/components/inbox/inbox-view.tsx:313                            ?view=connections
src/lib/outreach/campaign-validation.ts:103                        ?view=connections
src/lib/outreach/campaign-validation.ts:160                        ?view=billing
src/lib/outreach/campaigns/detail.ts:414                           ?view=connections
```

`?view=services` has no target at all — services live inside the `workspace` section.

**Fix:** rename the parameter in all 21 places, or accept both keys in `parseSettingsSection`.
Add a test that every internal `/app/settings?…` link resolves to a real section id — this class
of defect is only catchable mechanically.

## 10 · DANGEROUS — reviewed, none found

Checked specifically for destructive actions without confirmation or without an owner check:

| Action | Confirmation | Role |
|---|---|---|
| `deleteWorkspace` | typed confirmation in `danger-zone.tsx` | owner |
| `removeMember` | confirm dialog | admin |
| `deleteService` | confirm dialog | admin |
| `deleteFact` | confirm dialog | admin |
| `deleteDraftCampaign` | confirm dialog, DRAFT only | admin |
| `cancelCampaign` | confirm dialog | admin |
| `archiveCampaignAction` | confirm dialog | admin |
| `deleteRecurringSearchAction` | confirm dialog | admin |
| `stopSourcingRunAction` | confirm dialog, refunds the reservation | admin |
| `disconnectIntegration` | confirm dialog showing `disconnectConsequence` from the catalogue | admin |
| `suppressProspectsAction` | confirm dialog | admin |
| Admin `suspendWorkspace`, `reverseCommission`, `applyAccountCredit`, `reverseCredit`, `revokeEntitlement` | step-up required | platform admin |

Every destructive action that is reachable is confirmed and role-gated. **No dangerous action
found.** (`sendPayout`, `retryPayout` and `adjustAffiliateLedger` also require step-up, but are
unreachable — see §4.)
