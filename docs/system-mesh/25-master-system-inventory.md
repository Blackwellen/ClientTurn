# 25 · Master System Inventory

Every server action in ClientTurn, with the route that invokes it, the tables it writes, the
background work it queues, the role it demands, and whether it records audit, usage and a
compliance decision.

**This table is generated, not written.** It is derived by parsing every file containing
`"use server"`, extracting each exported action's body, and reading its `.from()`, `.rpc()`,
`enqueue()`, `requireRole()`, `recordAudit()`, `recordUsage()` and policy calls. Callers are found
by resolving imports across all 989 source files. That matters: a hand-maintained inventory of 270
actions would be wrong within a week, and its being wrong is exactly the failure it exists to
prevent.

Regenerate with the scripts described in §6.

---

## 1 · Totals

| | |
|---|---|
| Server actions | **270** |
| …that write to the database | 175 |
| …with no caller anywhere | **34** |
| …that record an audit row | 152 |
| …that record usage | **8** |
| …that take a compliance decision | **3** |
| Distinct tables written from actions | 86 of 174 |
| Job types queued from actions | 11 of 30 |

Three numbers in that table are the audit in miniature.

**8 of 175 mutating actions record usage.** Most mutations genuinely should not — renaming a
campaign costs nothing. But cold email dispatch is in the "should" set and is not there; see
[12 · 12.2](12-usage-billing-mesh.md).

**3 of 175 take a compliance decision.** Those three are `imports`, `add-lead` and the cold
dispatch path. Every warm send path — manual message, booking link, follow-up re-arm, reactivation
launch — writes messages without one; see [11 · 1.2](11-compliance-permission-mesh.md).

**34 actions have no caller.** See [13 · §4](13-page-action-button-audit.md) for the
delete/keep-and-fix decision on each.

## 2 · How to read the table

| Column | Meaning |
|---|---|
| **Action** | The exported server action |
| **Route / component** | Where a person triggers it. `server-to-server` means only another action calls it; `—` means nothing does |
| **Tables** | Tables the action body reads or writes directly |
| **Job / RPC** | Background work queued, and SQL functions called |
| **Role** | The minimum role resolved in the body. `member(any)` = `requireWorkspace()` with no role floor. Blank means the actor is resolved through a local wrapper — every action is guarded, and `tests/wiring.test.ts` proves it |
| **Audit** | Writes `audit_log` |
| **Usage** | Writes `usage_events`, checks an entitlement, or consumes AI tokens |
| **Policy** | Calls `ChannelPolicyService` or records a contact permission |
| **Status** | `working` · `server-only` · `DEAD` |

A blank **Role** is not a finding. `admin/*` actions wrap everything in `guarded()`, which resolves
the operator, enforces step-up and writes the audit row in one place; `settings/*` uses
`adminAccess()` / `ownerAccess()`; affiliates use `requireActiveAffiliate()`. The
`server action authority` test resolves one level of that indirection and asserts every
database-touching action reaches a real actor.

## 3 · The inventory

<!-- BEGIN GENERATED -->
### Identity

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `requestPasswordReset` | /login · /signup | — | — | — | — | — | — | working |
| `signIn` | /login · /signup · /affiliates/* | — | — | — | — | — | — | working |
| `signOut` | /affiliates/app/* · app shell (all routes) | — | — | — | — | — | — | working |
| `signUp` | /login · /signup | `profiles` `businesses` `business_members` `business_settings` `subscriptions` | — | — | — | — | — | working |
| `updatePassword` | /login · /signup | — | — | — | — | — | — | working |

### Business knowledge

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `advanceConnectLeadsStep` | /onboarding | — | — | — | — | — | — | working |
| `analyseWebsite` | /app/settings?section=business-profile | `business_profiles` | `business.analyse` | admin | — | — | — | working |
| `checkMetaConnection` | /onboarding | — | — | — | — | — | — | working |
| `completeOnboarding` | /affiliates/app/* · /onboarding | `businesses` | — | — | yes | — | — | working |
| `deleteFact` | /app/settings?section=business-profile | `business_memory_facts` | — | admin | yes | — | — | working |
| `goToStep` | components/marketing/find-leads/campaigns/campaign-panel.tsx · /onboarding · /app/reactivation/new | `businesses` | — | — | — | — | — | working |
| `readTestLead` | /onboarding | — | — | — | — | — | — | working |
| `runTestLead` | /onboarding | `profiles` | — | — | — | — | — | working |
| `saveBusinessStep` | /onboarding | — | — | — | — | — | — | working |
| `saveConversionGoal` | /app/settings?section=business-profile | `conversion_goals` | — | admin | — | — | — | working |
| `saveFact` | /app/settings?section=business-profile | `business_memory_facts` | — | admin | yes | — | — | working |
| `saveFollowUpStep` | /onboarding | `business_settings` `automation_definitions` | — | — | — | — | — | working |
| `saveIcpProfile` | /app/settings?section=business-profile | `icp_profiles` | — | admin | — | — | — | working |
| `saveOutreachGuidance` | /app/settings?section=business-profile | `business_profiles` | — | admin | yes | — | — | working |
| `saveQualifyBookStep` | /onboarding | — | — | — | — | — | — | working |
| `sendFollowUpTestMessage` | /onboarding | `businesses` | — | — | — | — | — | working |
| `setFactLocked` | /app/settings?section=business-profile | `business_memory_facts` | — | admin | — | — | — | working |
| `setIcpActive` | /app/settings?section=business-profile | `icp_profiles` | — | admin | — | — | — | working |
| `verifyFact` | — | `business_memory_facts` | — | admin | yes | — | — | **DEAD** |

### Prospecting

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `acceptAnalysisFactsAction` | — | `business_analysis_facts` `business_analysis_jobs` `business_profiles` | — | — | yes | — | — | **DEAD** |
| `addProspectsToCampaignAction` | /app/find-leads?view=prospects | `outreach_campaigns` `prospects` | — | — | yes | — | — | working |
| `analyseBusinessAction` | /app/find-leads?view=discover | — | — | — | — | — | — | working |
| `approveProspectAction` | /app/find-leads?view=prospects | `prospects` | — | — | yes | — | — | working |
| `approveProspectsAction` | /app/find-leads?view=prospects | `prospects` | — | — | yes | — | — | working |
| `archiveSearchSessionAction` | /app/find-leads?view=discover · /app/find-leads/search/[id] | — | — | — | yes | — | — | working |
| `controlIntentMonitor` | /app/find-leads?view=intent | `intent_monitors` | — | admin | — | — | — | working |
| `createIntentMonitor` | /app/find-leads?view=intent | `intent_categories` `intent_monitors` | — | admin | yes | yes | — | working |
| `createRecurringSearchAction` | /app/find-leads?view=discover | `search_strategies` `recurring_searches` | — | — | yes | — | — | working |
| `createSearchSessionAction` | /app/find-leads?view=discover | — | — | — | yes | — | — | working |
| `deleteRecurringSearchAction` | /app/find-leads?view=discover | `recurring_searches` | — | — | yes | — | — | working |
| `duplicateSearchSessionAction` | /app/find-leads?view=discover · /app/find-leads/search/[id] | — | — | — | — | — | — | working |
| `generateResearchSummaryAction` | /app/find-leads?view=prospects | `prospects` | — | — | yes | — | — | working |
| `increaseRunTargetAction` | /app/find-leads/runs/[id] | `sourcing_runs` | — | — | — | — | — | working |
| `markProspectsForReviewAction` | /app/find-leads?view=prospects | `prospects` | — | — | yes | — | — | working |
| `pauseSourcingRunAction` | /app/find-leads/runs/[id] | — | — | — | — | — | — | working |
| `previewBudgetAction` | /app/find-leads/search/[id] | — | — | — | — | — | — | working |
| `promoteProspectToLeadAction` | /app/find-leads?view=prospects | `prospects` | `promote_reviewed_prospect()` | — | yes | — | — | working |
| `refreshProspectResearchAction` | /app/find-leads?view=prospects | — | — | — | yes | — | — | working |
| `removeProspectsFromCampaignAction` | /app/find-leads?view=prospects | `prospects` | — | — | yes | — | — | working |
| `renameSearchSessionAction` | /app/find-leads?view=discover · /app/find-leads/search/[id] | — | — | — | yes | — | — | working |
| `resumeSourcingRunAction` | /app/find-leads/runs/[id] | — | — | — | — | — | — | working |
| `saveIntentCategory` | /app/find-leads?view=intent | `intent_categories` `intent_monitors` | — | admin | yes | — | — | working |
| `sendSearchMessageAction` | /app/find-leads/search/[id] | — | — | — | yes | — | — | working |
| `setIntentCategoryActive` | /app/find-leads?view=intent | `intent_categories` `intent_monitors` | — | admin | — | — | — | working |
| `setRecurringSearchStatusAction` | /app/find-leads?view=discover | `recurring_searches` | — | — | yes | — | — | working |
| `startSourcingRunAction` | /app/find-leads/search/[id] | — | — | — | — | — | — | working |
| `stopSourcingRunAction` | /app/find-leads/runs/[id] | `sourcing_runs` | — | — | — | — | — | working |
| `suppressProspectAction` | /app/find-leads?view=prospects | `prospects` | — | — | yes | — | — | working |
| `suppressProspectsAction` | /app/find-leads?view=prospects | `prospects` | — | — | yes | — | — | working |
| `updateAcquisitionProfileAction` | — | — | — | — | yes | — | — | **DEAD** |
| `updateSearchPlanAction` | /app/find-leads/search/[id] | — | — | — | — | — | — | working |

### Lead management

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `addAllowedService` | /app/leads (Add Lead) | `services` `lead_sources` | — | admin | yes | — | — | working |
| `assignLead` | /app/leads | `business_members` `leads` `lead_assignments` | — | member | yes | — | — | working |
| `checkContactability` | /app/leads (Add Lead) | — | — | — | — | — | — | working |
| `checkLeadDuplicates` | /app/leads (Add Lead) | — | — | — | — | — | — | working |
| `commitImport` | /app/leads/import | `lead_imports` `lead_import_rows` `leads` `lead_source_evidence` `prospect_companies` `prospects` | — | admin | yes | — | yes | working |
| `createImport` | /app/leads/import | `leads` `prospects` `lead_imports` `lead_import_rows` | — | admin | — | — | yes | working |
| `createManualLead` | /app/leads (Add Lead) | `services` `business_members` `automation_definitions` `automation_versions` `conversion_goals` `leads` `lead_assignments` | `lead.process` | — | yes | — | yes | working |
| `createProspectFromWizard` | /app/leads (Add Lead) | `prospect_companies` `prospects` | — | — | yes | — | — | working |
| `getImportReview` | /app/leads/import | `lead_imports` `lead_import_rows` | — | admin | — | — | — | working |
| `humanTakeover` | /app/leads | `leads` `automation_runs` | — | member | yes | — | — | working |
| `markLost` | /app/leads | — | — | — | — | — | — | working |
| `markQualification` | — | `leads` | — | member | yes | — | — | **DEAD** |
| `markWon` | /app/leads | — | — | — | — | — | — | working |
| `resumeAutomation` | /app/leads | `leads` | `automation.advance` | member | yes | — | — | working |
| `sendBookingLink` | /app/leads | `business_settings` `integrations` | — | member | — | — | — | working |
| `sendManualMessage` | /app/leads | `contact_suppressions` `conversations` `messages` | `message.send` | member | yes | yes | — | working |
| `setFollowUpPaused` | — | — | — | — | — | — | — | **DEAD** |
| `setNeedsAttention` | /app/leads | `leads` | — | member | yes | — | — | working |
| `setQualificationResult` | /app/leads | `leads` `automation_runs` | — | member | yes | — | — | working |
| `setRowClassification` | /app/leads/import | `lead_import_rows` | — | admin | — | — | — | working |
| `updateLeadStatus` | /app/leads | `leads` | — | member | yes | — | — | working |

### Communication

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `acknowledgeHandoff` | /app/inbox | `agent_handoffs` | — | member | yes | — | — | working |
| `assignHandoff` | — | `business_members` `agent_handoffs` | — | admin | yes | — | — | **DEAD** |
| `cancelHandoff` | /app/inbox | `agent_handoffs` | — | admin | yes | — | — | working |
| `discardDraft` | /app/inbox | `messages` | — | member | yes | — | — | working |
| `inboxAction` | /app/inbox | `conversations` | — | member | — | — | — | working |
| `resolveHandoff` | /app/inbox | `agent_handoffs` `leads` | — | member | yes | — | — | working |
| `returnConversationToAi` | /app/inbox | `conversations` `leads` | — | member | yes | — | — | working |
| `sendDraft` | /app/inbox | `messages` | `message.send` | member | yes | — | — | working |
| `takeOverConversation` | /app/inbox | `conversations` `leads` | — | member | yes | — | — | working |
| `updateDraft` | /app/inbox | `messages` | — | member | — | — | — | working |

### Outreach (cold)

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `archiveCampaignAction` | /app/find-leads/campaigns/[id] | — | — | — | — | — | — | working |
| `createCampaignAction` | — | `sender_identities` `outreach_campaigns` `outreach_sequences` `outreach_steps` | — | — | yes | — | — | **DEAD** |
| `createCampaignDraftAction` | server-to-server | — | — | — | yes | — | — | server-only |
| `createSenderIdentityAction` | /app/find-leads?view=campaigns | `sender_identities` | — | — | yes | — | — | working |
| `duplicateCampaignAction` | /app/find-leads/campaigns/[id] | — | — | — | — | — | — | working |
| `estimateAudienceAction` | /app/find-leads/campaigns/new | — | — | — | — | — | — | working |
| `generateVariantsAction` | /app/find-leads/campaigns/new | — | — | — | — | — | — | working |
| `launchAcquisitionCampaignAction` | /app/find-leads/campaigns/new | — | — | — | — | — | — | working |
| `launchCampaignAction` | /app/find-leads?view=campaigns | `outreach_campaigns` `sender_identities` `outreach_steps` | `outreach.dispatch` | — | yes | — | — | working |
| `loadCampaignDraftAction` | — | — | — | — | — | — | — | **DEAD** |
| `rebuildCampaignAudienceAction` | — | — | `outreach.audience` | — | — | — | — | **DEAD** |
| `saveCampaignDraftAction` | /app/find-leads/campaigns/new | — | — | — | — | — | — | working |
| `saveOptimizationConfigAction` | — | — | — | — | — | — | — | **DEAD** |
| `setCampaignPriorityAction` | /app/find-leads/campaigns/[id] | — | — | — | — | — | — | working |
| `setCampaignStateAction` | /app/find-leads/campaigns/[id] | — | — | — | — | — | — | working |
| `setCampaignStatusAction` | /app/find-leads?view=campaigns | `outreach_campaigns` | — | — | yes | — | — | working |
| `validateCampaignAction` | /app/find-leads/campaigns/new | — | — | — | — | — | — | working |

### Outreach (follow-up)

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `createAutomation` | components/automations/create-automation-button.tsx · /app/follow-up | `automation_definitions` | — | — | yes | — | — | working |
| `discardAutomationDraft` | components/automations/automation-editor.tsx | `automation_versions` `automation_runs` | — | — | yes | — | — | working |
| `publishAutomation` | components/automations/automation-editor.tsx | `automation_versions` `automation_steps` | — | — | yes | yes | — | working |
| `saveAutomationDraft` | components/automations/automation-editor.tsx | `automation_versions` `automation_steps` `automation_definitions` | — | — | yes | yes | — | working |
| `saveFollowUpTimezone` | /app/follow-up | `businesses` | — | — | yes | — | — | working |
| `saveQuietHours` | components/automations/quiet-hours-card.tsx · /app/follow-up | `business_settings` | — | — | yes | — | — | working |
| `sendFollowUpTest` | /app/follow-up | — | — | — | yes | yes | — | working |
| `setAutomationEnabled` | components/automations/automation-editor.tsx · /app/follow-up | `automation_versions` `automation_definitions` `automation_runs` | — | — | yes | yes | — | working |
| `updateFollowUpSequence` | /app/follow-up | — | — | — | — | — | — | working |

### Outreach (reactivation)

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `analyseImportFile` | /app/reactivation · /app/reactivation/new | — | — | — | — | — | — | working |
| `cancelCampaign` | components/campaigns/campaign-actions.tsx · /app/reactivation | — | — | — | — | — | — | working |
| `confirmImportFile` | /app/reactivation · /app/reactivation/new | `imports` `lead_sources` `services` `leads` | — | — | yes | — | — | working |
| `createCampaign` | /affiliates/app/* · /app/reactivation/new | `campaigns` | — | — | yes | yes | — | working |
| `deleteDraftCampaign` | /app/reactivation | `campaigns` | — | — | yes | — | — | working |
| `duplicateCampaign` | /app/reactivation | `campaigns` | — | — | yes | — | — | working |
| `launchCampaign` | components/campaigns/campaign-actions.tsx · /app/reactivation | `campaigns` `campaign_contacts` | `campaign.expand` `campaign.send` | — | yes | — | — | working |
| `pauseCampaign` | components/campaigns/campaign-actions.tsx · /app/reactivation | — | — | — | — | — | — | working |
| `previewAudience` | /app/reactivation/new | — | — | — | — | — | — | working |
| `previewImportFile` | /app/reactivation · /app/reactivation/new | — | — | — | — | — | — | working |
| `resumeCampaign` | components/campaigns/campaign-actions.tsx · /app/reactivation | — | — | — | — | — | — | working |
| `updateCampaignDetails` | /app/reactivation | `campaigns` | — | — | yes | — | — | working |

### Sales progression

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `deleteQuestion` | — | `qualification_answers` `qualification_questions` | — | — | yes | — | — | **DEAD** |
| `deleteRule` | — | `qualification_rules` | — | — | yes | — | — | **DEAD** |
| `moveQuestion` | — | `qualification_questions` | — | — | yes | — | — | **DEAD** |
| `previewQualification` | — | — | — | member(any) | — | — | — | **DEAD** |
| `publishQualification` | /app/follow-up?view=qualification | `services` `qualification_questions` `qualification_answers` `qualification_options` `qualification_rules` | — | — | yes | — | — | working |
| `saveQuestion` | — | `services` `qualification_questions` `qualification_options` | — | — | yes | — | — | **DEAD** |
| `saveRule` | — | `qualification_questions` `qualification_rules` | — | — | yes | — | — | **DEAD** |
| `updateBookingStatus` | — | `bookings` `leads` | — | member | yes | — | — | **DEAD** |

### Automation

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `controlAgent` | /app/agents | `agents` `search_strategies` `agent_activity_events` | — | admin | — | — | — | working |
| `saveAgent` | /app/agents | `search_strategies` `agents` `agent_sources` `agent_activity_events` | — | admin | — | — | — | working |

### Intelligence

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `approveMcpRequestAction` | /app/settings?section=connections | — | — | admin | — | — | — | working |
| `askCopilot` | Copilot panel (all app routes) | `copilot_messages` | — | member(any) | — | — | — | working |
| `createMcpClientAction` | /app/settings?section=connections | — | — | admin | — | — | — | working |
| `issueMcpTokenAction` | /app/settings?section=connections | — | — | admin | — | — | — | working |
| `listCopilotActions` | Copilot panel (all app routes) | `copilot_actions` `profiles` | — | member(any) | — | — | — | working |
| `listCopilotInsights` | Copilot panel (all app routes) | — | — | member(any) | — | — | — | working |
| `listCopilotMessages` | — | `copilot_sessions` `copilot_messages` | — | member(any) | — | — | — | **DEAD** |
| `refreshMcpTokenAction` | — | — | — | — | — | — | — | **DEAD** |
| `rejectMcpRequestAction` | /app/settings?section=connections | — | — | admin | — | — | — | working |
| `revokeMcpClientAction` | /app/settings?section=connections | — | — | admin | — | — | — | working |
| `runCopilotTool` | Copilot panel (all app routes) | — | — | member(any) | — | — | — | working |
| `saveAiBehaviour` | /app/settings | `business_settings` `business_ai_settings` | — | — | yes | yes | — | working |

### Integrations

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `disconnectEmail` | /app/settings?section=connections | — | — | — | yes | — | — | working |
| `dismissConnectorEventAction` | — | — | — | admin | — | — | — | **DEAD** |
| `generateConnectorSecret` | /app/settings?section=connections | — | — | admin | — | — | — | working |
| `getEmailAccount` | — | — | — | member | — | — | — | **DEAD** |
| `installWorkspaceApp` | /app/settings?section=connections | `workspace_app_installs` | — | admin | — | — | — | working |
| `listAppInstalls` | /app/settings?section=connections | `workspace_app_installs` | — | admin | — | — | — | working |
| `replayConnectorEventAction` | — | — | — | admin | — | — | — | **DEAD** |
| `rotateConnectorSecretAction` | — | — | — | admin | — | — | — | **DEAD** |
| `saveEmailConnection` | /app/settings?section=connections | — | — | — | yes | — | — | working |
| `sendEmailConnectionTest` | /app/settings?section=connections | — | — | — | — | — | — | working |
| `testConnectorAction` | — | — | — | admin | — | — | — | **DEAD** |
| `testEmailAccount` | /app/settings?section=connections | — | — | — | — | — | — | working |
| `uninstallWorkspaceApp` | /app/settings?section=connections | `workspace_app_installs` | — | admin | — | — | — | working |

### Configuration

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `changeMemberRole` | /app/settings?section=team | `business_members` | — | — | yes | — | — | working |
| `changePassword` | — | `profiles` | — | member(any) | yes | — | — | **DEAD** |
| `connectProviderToken` | components/integrations/integration-card.tsx · /app/settings?section=connections | — | — | — | — | — | — | working |
| `createLogoUploadUrl` | /app/settings?section=workspace | — | — | — | — | — | — | working |
| `deleteService` | /app/settings?section=workspace | `leads` `services` | — | — | yes | — | — | working |
| `deleteWorkspace` | /app/settings | `subscriptions` `businesses` | — | — | yes | — | — | working |
| `disconnectIntegration` | components/integrations/integration-card.tsx · /app/settings?section=connections | `integrations` `integration_secrets` `integration_objects` `business_settings` | — | — | yes | — | — | working |
| `exportWorkspaceData` | /app/settings | `businesses` `business_settings` `business_members` `services` `leads` `bookings` `messages` | — | — | yes | — | — | working |
| `inviteMember` | /app/settings?section=team | `business_members` `profiles` | — | — | yes | — | — | working |
| `loadAccountPreferences` | app shell (all routes) | — | — | member(any) | — | — | — | working |
| `openBillingPortal` | /app/settings?section=billing | `subscriptions` | — | — | yes | — | — | working |
| `refreshConnectionHealth` | /app/settings?section=connections | — | — | — | — | — | — | working |
| `removeBusinessLogo` | /app/settings?section=workspace | `businesses` | — | — | — | — | — | working |
| `removeMember` | /app/settings?section=team | `business_members` `leads` | — | — | yes | — | — | working |
| `requestOwnPasswordReset` | /affiliates/app/* · app shell (all routes) | `profiles` | — | member(any) | yes | — | — | working |
| `saveBusinessLogo` | /app/settings?section=workspace | `businesses` | — | — | — | — | — | working |
| `saveService` | /app/settings?section=workspace | `services` | — | — | yes | — | — | working |
| `saveWorkspaceSettings` | /app/settings?section=workspace | `businesses` `business_settings` | — | — | yes | — | — | working |
| `startPlanCheckout` | /app/settings?section=billing | `subscriptions` `profiles` | — | — | — | — | — | working |
| `testConnection` | /app/settings?section=connections | `integrations` | — | — | yes | — | — | working |
| `updateBookingSettings` | /app/settings | `integrations` `business_settings` | — | — | yes | — | — | working |
| `updateBusinessProfile` | — | `businesses` | — | — | yes | — | — | **DEAD** |
| `updateMessagingSettings` | /app/settings | `business_settings` | — | — | yes | — | — | working |
| `updateNotificationPreferences` | /affiliates/app/* · app shell (all routes) | `business_settings` | — | — | yes | — | — | working |
| `updateProfile` | /affiliates/app/* · app shell (all routes) | `profiles` | — | member(any) | yes | — | — | working |
| `updateSlackChannel` | /app/settings | `integrations` | — | — | yes | — | — | working |

### Commerce

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `getTokenOverview` | — | — | — | member | — | — | — | **DEAD** |
| `saveAllocation` | /app/settings?section=billing | `customer_usage_allocations` | — | — | yes | — | — | working |
| `saveDailyCaps` | /app/settings?section=billing | `customer_usage_allocations` | — | — | yes | — | — | working |
| `saveOverage` | /app/settings?section=billing | `customer_usage_allocations` | — | — | yes | — | — | working |
| `startTokenTopUp` | /app/settings | `subscriptions` `profiles` `ai_token_purchases` | — | owner | yes | — | — | working |

### Platform

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `createAttachmentUploadUrl` | /app/support · /app/help | — | — | member(any) | — | — | — | working |
| `createSupportTicket` | /app/support · /app/help | `support_tickets` `support_messages` | — | member(any) | yes | — | — | working |
| `getAttachmentUrl` | /app/support · /app/help | `support_attachments` | — | member(any) | — | — | — | working |
| `getMyTicket` | /app/support · /app/help | — | — | member(any) | — | — | — | working |
| `listMyTickets` | /app/support · /app/help | — | — | member(any) | — | — | — | working |
| `markAllNotificationsRead` | app shell (all routes) | `notifications` | — | member(any) | — | — | — | working |
| `markNotificationRead` | app shell (all routes) | `notifications` | — | member(any) | — | — | — | working |
| `readHelpArticle` | /app/support · /app/help | — | — | member(any) | — | — | — | working |
| `readSystemStatus` | /app/support · /app/help | — | — | member(any) | — | — | — | working |
| `replyToTicket` | /admin/* · /app/support · /app/help | `support_tickets` `support_messages` | — | member(any) | yes | — | — | working |
| `searchHelpArticles` | /app/support · /app/help | — | — | member(any) | — | — | — | working |

### Platform ops

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `addInternalNote` | /admin/* | `support_notes` | — | — | yes | — | — | working |
| `adjustAffiliateLedger` | — | `affiliates` | — | — | — | — | — | **DEAD** |
| `adminSignIn` | /admin/* | `profiles` | — | — | yes | — | — | working |
| `adminSignOut` | /admin/* | — | — | — | yes | — | — | working |
| `applyAccountCredit` | /admin/* | `billing_credit_entries` | — | — | yes | — | — | working |
| `approveAffiliate` | /admin/* | `affiliates` `affiliate_commission_plans` | — | — | yes | — | — | working |
| `approveCommission` | /admin/* | `affiliate_commissions` | — | — | yes | — | — | working |
| `archivePolicyVersion` | /admin/* | `compliance_policy_versions` | — | — | yes | — | — | working |
| `assignTicketToMe` | /admin/* | `support_tickets` `support_assignments` | — | — | yes | — | — | working |
| `cancelAtPeriodEnd` | /admin/* · /app/settings?section=billing | — | — | — | yes | — | — | working |
| `cancelJob` | /admin/* | `jobs` | — | — | yes | — | — | working |
| `changePlan` | /admin/* | — | — | — | yes | — | — | working |
| `confirmStepUp` | /admin/* | — | — | — | yes | — | — | working |
| `createPolicyVersion` | — | `compliance_policy_versions` | — | — | yes | — | — | **DEAD** |
| `exportComplianceAudit` | — | `audit_log` | — | — | yes | — | — | **DEAD** |
| `extendTrial` | /admin/* | `subscriptions` | — | — | yes | — | — | working |
| `grantEntitlement` | /admin/* | `business_entitlement_grants` | — | — | yes | — | — | working |
| `markPayoutPaid` | /admin/* | `affiliate_payouts` `affiliate_commissions` | — | — | yes | — | — | working |
| `moveJobToDeadLetter` | /admin/* | `jobs` | — | — | yes | — | — | working |
| `publishPolicyVersion` | /admin/* | `compliance_policy_versions` | — | — | yes | — | — | working |
| `refreshProviderHealth` | /admin/* | — | — | — | yes | — | — | working |
| `reinstateAffiliate` | /admin/* | `affiliates` | — | — | yes | — | — | working |
| `rejectAffiliate` | /admin/* | `affiliates` | — | — | yes | — | — | working |
| `removeSuppression` | /admin/* | `suppression_entries` | — | — | yes | — | — | working |
| `replyToTicket` | /admin/* · /app/support · /app/help | `support_tickets` `support_messages` | — | — | yes | — | — | working |
| `resendOnboardingEmail` | /admin/* | `business_members` `profiles` | `notification.send` | — | yes | — | — | working |
| `retryJob` | /admin/* | `jobs` | — | — | yes | — | — | working |
| `retryPayout` | — | — | — | — | yes | — | — | **DEAD** |
| `reverseCommission` | app/api/webhooks/stripe/route.ts · /admin/* | `affiliate_commissions` | — | — | yes | — | — | working |
| `reverseCredit` | /admin/* | `billing_credit_entries` `subscriptions` | — | — | yes | — | — | working |
| `revertCancellation` | /admin/* | — | — | — | yes | — | — | working |
| `revokeEntitlement` | /admin/* | `business_entitlement_grants` | — | — | yes | — | — | working |
| `runAdminSearch` | /admin/* | — | — | — | — | — | — | working |
| `safeRetryEvent` | /admin/* | `webhook_events` `jobs` | `webhook.replay` | — | yes | — | — | working |
| `sendPayout` | — | — | — | — | yes | — | — | **DEAD** |
| `setAiKillSwitch` | /admin/* | — | — | — | yes | — | — | working |
| `setErrorStatus` | /admin/* | `platform_error_triage` | — | — | yes | — | — | working |
| `setTicketStatus` | /admin/* | `support_tickets` `support_assignments` | — | — | yes | — | — | working |
| `suspendAffiliate` | /admin/* | `affiliates` | — | — | yes | — | — | working |
| `suspendWorkspace` | /admin/* | `businesses` | — | — | yes | — | — | working |
| `triggerIntegrationHealthCheck` | /admin/* | — | `integration.health_check` | — | yes | — | — | working |
| `unsuspendWorkspace` | /admin/* | `businesses` | — | — | yes | — | — | working |
| `updateAgentSettings` | /admin/* | — | — | — | yes | — | — | working |
| `updateAiSettings` | /admin/* | — | — | — | yes | — | — | working |
| `updateFeatureFlag` | /admin/* | `platform_feature_flags` | — | — | yes | — | — | working |
| `updateOutreachSettings` | /admin/* | — | — | — | yes | — | — | working |
| `updatePrivacyRequest` | /admin/* | `privacy_requests` | — | — | yes | — | — | working |
| `updateProviderSettings` | /admin/* | `platform_providers` `platform_setting_changes` | — | — | yes | — | — | working |

### Affiliate programme

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `attachPromoCode` | — | `affiliate_promo_codes` `affiliate_links` | — | — | — | — | — | **DEAD** |
| `completeOnboarding` | /affiliates/app/* · /onboarding | `affiliates` `affiliate_commission_plans` | — | — | yes | — | — | working |
| `createCampaign` | /affiliates/app/* · /app/reactivation/new | `affiliate_campaigns` | — | — | — | — | — | working |
| `createLink` | /affiliates/app/* · /app/reactivation/new | `affiliate_links` `affiliate_campaigns` | — | — | yes | — | — | working |
| `markAffiliateNotificationsRead` | /affiliates/app/* | — | — | — | — | — | — | working |
| `openStripeDashboard` | /affiliates/app/* | `affiliates` | — | — | — | — | — | working |
| `requestPromoCode` | /affiliates/app/* | `affiliate_promo_offers` `affiliate_promo_codes` | — | — | yes | — | — | working |
| `setLinkArchived` | /affiliates/app/* | `affiliate_links` | — | — | — | — | — | working |
| `signUpPartner` | /affiliates/* | `profiles` | — | — | — | — | — | working |
| `startStripeOnboarding` | /affiliates/app/* | — | — | — | — | — | — | working |
| `syncStripeState` | /affiliates/app/* | — | — | — | — | — | — | working |
| `toggleResourceSave` | /affiliates/app/* | `affiliate_resources` `affiliate_resource_saves` | — | — | — | — | — | working |
| `updateAffiliatePreferences` | /affiliates/app/* | `affiliates` | — | — | — | — | — | working |
| `updateAffiliateProfile` | /affiliates/app/* | `affiliates` | — | — | yes | — | — | working |
| `updateLinkUtm` | — | `affiliate_links` | — | — | — | — | — | **DEAD** |
| `updateNotificationPreferences` | /affiliates/app/* · app shell (all routes) | `affiliates` | — | — | yes | — | — | working |
| `updatePaymentDetails` | /affiliates/app/* | `affiliates` | — | — | — | — | — | working |
| `updateProfile` | /affiliates/app/* · app shell (all routes) | `affiliates` | — | — | — | — | — | working |
| `updateTaxInformation` | /affiliates/app/* | `affiliates` | — | — | yes | — | — | working |

### Marketing

| Action | Route / component | Tables | Job / RPC | Role | Audit | Usage | Policy | Status |
|---|---|---|---|---|---|---|---|---|
| `submitSalesEnquiry` | components/marketing/public/contact-sales/sales-form.tsx | — | — | — | — | — | — | working |
<!-- END GENERATED -->

## 4 · Every page has a purpose

Full table in [22 · §6](22-final-target-architecture.md). Summary: **no page is recommended for
deletion.** Every route has a purpose; the failures are in wiring, not information architecture.

| Recommendation | Count | Pages |
|---|---|---|
| KEEP | 19 | Dashboard detail tabs, Agents, Leads, Find Leads (5 routes), Follow-Up, Reactivation, Settings, Help/Support, Admin (8), Affiliates (8), marketing (14), legacy redirects, dev harnesses |
| KEEP + FIX | 5 | `/app` (use the metric registry) · `/app/inbox` (email reply, prospect reply, social tabs) · `/app/leads/import` (**done** — see [24 · R10](24-remediation-log.md)) · `/app/reactivation/new` (server draft) · `/app/analytics` (**partly done** — see [24 · R8](24-remediation-log.md)) |
| MERGE | 1 | Find Leads campaigns — two builders write `outreach_campaigns` |
| SIMPLIFY | 1 | `/app/agents/new` — a four-step wizard for a five-field form |

## 5 · Every entity has a purpose

Full table in [22 · §7](22-final-target-architecture.md). 174 tables:

| | Count |
|---|---|
| Referenced by application code | 159 |
| Unreferenced — **keep**, the gap is the missing writer | 5 (`campaign_learnings`, `search_feedback`, `agent_tool_calls`, `agent_budgets`, `workspace_app_events`) |
| Unreferenced — **safe to delete** after dependency check | 4 (`business_playbooks`, `icp_segments`, `lead_import_mappings`, `ai_prompt_versions`) |
| Unreferenced — **deprecate first**, decide | 5 (`usage_reservations`, `outreach_runs`, `external_entity_links`, `sync_conflicts`, `sync_runs`) |
| Reached only through an RPC, not dead | 1 (`rate_limits`) |

## 6 · Regenerating this document

Three scripts, kept in the session scratchpad rather than the repository because they are analysis
tooling rather than product code. Promote them to `scripts/` if this inventory becomes a standing
artefact:

| Script | What it does |
|---|---|
| `inventory.mjs` | Parses every `"use server"` file, extracts each action's body, resolves callers across all sources, and emits `inventory.json` |
| `render-inventory.mjs` | Turns that JSON into the markdown table above, mapping component paths back to routes |
| `authcheck.mjs` | The authorisation sweep, resolving one level of guard indirection. Now also a permanent test in `tests/wiring.test.ts` |

The heuristics have known limits, stated so the numbers are not over-trusted:

- An action's "body" is the text between its `export` and the next one, so a helper defined
  between two actions is attributed to the first. This inflates table lists slightly; it never
  hides one.
- Route mapping is by component path prefix. A component rendered on two routes shows both; one
  rendered somewhere unexpected shows its path.
- `Usage` and `Policy` are detected by call site, so an action that queues a job which then records
  usage shows `—`. That is deliberate: the question the column answers is "does *this* action
  meter", and the answer for a dispatcher is correctly no.
