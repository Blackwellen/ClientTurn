# CLIENTTURN — Expansion Architecture Bible V4

**Find, Convert, Reactivate & Learn**

**Expansion specification for AI sourcing, manual lead intake, prospects, buying intent, multi-channel outreach, analytics, business learning, support, affiliates, MCP, platform administration, usage control and margin protection.**

Version: V4 Expansion Bible • September 2026 • Status: canonical expansion specification

This document is an additive architecture Bible for the existing simplified ClientTurn V3 product. It preserves the narrow lead-conversion core and extends it with a controlled acquisition layer. Where V4 explicitly changes a V3 surface, V4 takes precedence for that surface. All existing V3 authentication, onboarding, core lead processing, Follow-Up, Qualification, Reactivation, billing and platform foundations remain unless this document says otherwise.

## Document authority and non-goals

ClientTurn must remain simple at the customer surface even when the backend becomes sophisticated. The expansion is accepted only if a normal service business can understand the product without learning CRM, data-enrichment, deliverability or agent terminology.

- No generic CRM, opportunity pipeline, contact graph, task-management suite or no-code workflow builder.
- No uncontrolled autonomous agents. Every agent operates inside a bounded tool, cost, channel, permission and policy envelope.
- No fake performance claims, synthetic testimonials or fabricated benchmarks.
- No mass cold SMS, WhatsApp or social messaging. Cold outreach eligibility is evaluated by the compliance/contactability policy layer.
- No customer-facing LLM token wallet. Customers buy outcomes and allowances; token and provider cost accounting remains internal.
- No dependence on one prospect-data vendor, one mailbox vendor or one LLM provider implementation.
- No scraping or social automation that violates platform terms. Official APIs and permitted public/licensed sources only.
- No provider secret, raw provider cost or cross-tenant information exposed to a normal customer.

# PART I — Final Product Shape

## 1. Product definition

ClientTurn is an acquisition and lead-conversion operating system for service businesses and focused sales teams. It learns what the business sells, can discover suitable prospects, can accept inbound/manual/imported leads, coordinates permitted outreach, qualifies conversations, routes toward the correct conversion goal, reactivates older opportunities, and learns which combinations produce results.

## 1.1 The four internal layers

| Layer | Customer promise | Primary inputs | Primary outputs |
| --- | --- | --- | --- |
| FIND | Find businesses and people that fit what the customer sells. | Business profile, ICP, natural-language searches, intent signals, provider data. | Verified/scored prospects ready for review or permitted outreach. |
| CONVERT | Turn active enquiries and engaged prospects into the desired conversion. | Inbound leads, manual leads, promoted prospects, imports, CRM sync. | Qualified lead, booking, demo, signup, purchase, call, handover, won/lost. |
| REACTIVATE | Recover value from eligible older opportunities. | Existing leads, campaign criteria, suppression rules. | Re-engaged conversations that re-enter Convert. |
| LEARN | Improve targeting, outreach and conversion within bounded controls. | Campaign results, replies, conversions, costs, source and intent performance. | Recommendations, score updates, bounded optimization actions, business learnings. |

## 1.2 Canonical journey

```text
BUSINESS / WEBSITE
        ↓
BUSINESS PROFILE + ICP + CONVERSION GOALS
        ↓
┌──────────────────────── FIND ────────────────────────┐
│ Search → Enrich → Verify → Score → Review → Outreach│
└──────────────────────────┬────────────────────────────┘
                           │ reply / engagement
                           ▼
                        PROSPECT
                           │ promote
                           ▼
META / WEB / MANUAL / IMPORT / PIPEDRIVE ─────→ LEAD
                                                   ↓
                                           FOLLOW-UP
                                                   ↓
                                          QUALIFICATION
                                                   ↓
                                           CONVERSION
                              ┌──────────────┼──────────────┐
                              ↓              ↓              ↓
                           BOOKING          SIGNUP         SALE
                              ↓              ↓              ↓
                              └──────────── WON ────────────┘

OLDER ELIGIBLE LEADS → REACTIVATE → REPLY → CONVERT
```

## 1.3 Prospect vs Lead boundary

This boundary is mandatory. A Prospect is an identified potential buyer who has not yet entered the normal active conversion relationship. A Lead is an inbound/manual/permissioned/enaged record that belongs in the operational Leads inbox. Cold data must not flood the Leads page.

| Object | Meaning | Typical source | Where it lives |
| --- | --- | --- | --- |
| Prospect | Potential buyer discovered or manually entered for outbound evaluation. | ClientTurn Find, compliant import, manual prospect entry. | Find Leads → Prospects. |
| Lead | Active enquiry/conversation or prospect promoted after engagement. | Meta, website, manual warm entry, import, Pipedrive, prospect reply. | Leads. |
| Conversation | Cross-channel thread belonging to a prospect or lead. | Email, SMS, WhatsApp, supported social/API channel. | Prospect/Lead drawer. |
| Campaign | Bounded outbound acquisition operation. | Find Leads. | Find Leads → Campaigns. |
| Reactivation Campaign | Re-engagement of existing eligible leads. | Existing Leads. | Reactivation. |

## 1.4 Final customer navigation

| Navigation | Purpose | Internal views |
| --- | --- | --- |
| Dashboard | What is happening, what needs attention, movement through acquisition/conversion. | Single operational overview. |
| Leads | Warm/inbound/manual operational inbox. | Card/Table + Lead Drawer. |
| Find Leads | AI-assisted prospect discovery, intent, prospects and outbound acquisition. | Discover / Prospects / Intent / Campaigns. |
| Follow-Up | Warm-lead channel sequence and qualification. | Follow-Up / Qualification. |
| Reactivation | Older-lead recovery. | Campaign list + creation wizard + detail. |
| Analytics | Deep acquisition, outreach and conversion analysis. | Overview / Acquisition / Outreach / Conversion. |
| Settings | Workspace and system configuration. | Workspace / Connections / Business Profile / Team / Billing & Usage. |

Hidden operational routes such as Status, Support, import wizards and sourcing-run detail do not become top-level sidebar destinations.

## 1.5 Final admin navigation

| Admin destination | Purpose |
| --- | --- |
| Overview | Platform KPIs, provider health, customer activity, economics alerts. |
| Customers | Tenant support and usage/economics detail. |
| Support | Internal support inbox and ticket operations. |
| Affiliates | Affiliate programme, referrals, commissions, payouts and assets. |
| System | Health, events, errors, jobs and compliance operations. |
| Billing | Subscriptions, invoices, entitlements, credits and adjustments. |
| Usage & Margins | Tenant/provider COGS, contribution margin, anomalies and cost controls. |
| Settings | Provider priority, AI budgets, channel caps, country/compliance policies and platform configuration. |

# PART II — Canonical Page & Surface Register

## 2. Customer page register

| Route | Surface | Goal | Type |
| --- | --- | --- | --- |
| /app | Dashboard | Operational overview | Main |
| /app/leads | Leads | Warm/inbound/manual operational inbox | Main |
| /app/leads/import | Lead Import | CSV/XLSX import, validation, classification and dedupe | Wizard |
| /app/find-leads | Find Leads — Discover | AI search home, business/ICP context, saved search chats | Main/Sub-view |
| /app/find-leads/search/[sessionId] | Search Session | Conversational sourcing workspace and structured search plan | Detail |
| /app/find-leads/runs/[runId] | Sourcing Run | Live process/progress and result diagnostics | Detail |
| /app/find-leads?view=prospects | Find Leads — Prospects | Prospect inbox and review | Sub-view |
| /app/find-leads?view=intent | Find Leads — Intent | Intent categories, monitors and events | Sub-view |
| /app/find-leads?view=campaigns | Find Leads — Campaigns | Outbound campaign list and switching | Sub-view |
| /app/find-leads/campaigns/new | New Acquisition Campaign | Audience, sequence, budget, review | Wizard |
| /app/find-leads/campaigns/[campaignId] | Campaign Detail | Overview, audience, sequence, performance, activity | Detail |
| /app/follow-up | Follow-Up | Warm-lead channel sequence | Main/Sub-view |
| /app/follow-up?view=qualification | Qualification | Questions, rules, service scope and preview | Sub-view |
| /app/reactivation | Reactivation | Existing-lead campaigns | Main |
| /app/reactivation/new | New Reactivation | Audience, message/timing, review | Wizard |
| /app/analytics | Analytics — Overview | Full-funnel performance | Main/Sub-view |
| /app/analytics?view=acquisition | Analytics — Acquisition | Sourcing and intent performance | Sub-view |
| /app/analytics?view=outreach | Analytics — Outreach | Channel and sequence performance | Sub-view |
| /app/analytics?view=conversion | Analytics — Conversion | Lead-to-goal conversion | Sub-view |
| /app/settings | Settings — Workspace | Business/workspace configuration | Main/Sub-view |
| /app/settings?view=connections | Settings — Connections | Meta, Twilio, email, booking, Pipedrive | Sub-view |
| /app/settings?view=business-profile | Settings — Business Profile | Business learning, ICPs, conversion goals and memory | Sub-view |
| /app/settings?view=team | Settings — Team | Members, roles, invites | Sub-view |
| /app/settings?view=billing | Settings — Billing & Usage | Plan, usage, communication allocation and overage | Sub-view |
| /app/status | Status | Customer-facing system/agent/integration status | Hidden utility |
| /app/support | Support | Help, tickets and status link | Hidden utility |

## 2.1 Affiliate portal register

| Route | Page | Purpose |
| --- | --- | --- |
| /affiliates | Affiliate Marketing | Programme explanation and application/login entry. |
| /affiliates/login | Affiliate Login | Affiliate authentication. |
| /affiliates/app | Affiliate Dashboard | Clicks, signups, trials, paid customers, commissions. |
| /affiliates/app/links | Links | Referral links, UTMs, promo codes. |
| /affiliates/app/referrals | Referrals | Attributed customer lifecycle. |
| /affiliates/app/resources | Resources | Brand hub, screenshots, video, copy, education. |
| /affiliates/app/performance | Performance | Channel/campaign affiliate analytics. |
| /affiliates/app/payouts | Payouts | Pending/approved/paid commission and payout details. |
| /affiliates/app/profile | Profile | Payment/contact/tax configuration. |

## 2.2 Admin page register

| Route | Page | Internal views |
| --- | --- | --- |
| /admin | Admin Overview | Overview |
| /admin/customers | Customers | List + customer drawer |
| /admin/support | Support | Inbox / Open / Waiting / Resolved |
| /admin/affiliates | Affiliates | Overview / Affiliates / Referrals / Commissions / Payouts / Resources / Settings |
| /admin/system | System | Health / Events / Errors / Jobs / Compliance |
| /admin/billing | Billing | Subscriptions / Invoices / Credits & Adjustments / Entitlements |
| /admin/economics | Usage & Margins | Customers / Providers / Plans / Anomalies |
| /admin/settings | Platform Settings | Providers / AI & Agents / Outreach / Compliance / Price Book / Feature Flags |

# PART III — Customer Application Specifications

# 3. Application Shell Expansion

## 3.1 Navigation

Preserve the approved ClientTurn shell. Add Find Leads and Analytics without altering the visual language. Top-bar connection health becomes the entry point to /app/status. Support remains behind Help and does not consume sidebar space.

```text
<AppShell>
  <AppSidebar />
  <AppTopBar>
    <GlobalSearch />
    <ConnectionHealthPill />
    <NotificationButton />
    <CopilotButton />
    <UserMenu />
  </AppTopBar>
  <AppContent />
  <GlobalDrawerLayer />
  <CopilotDrawer />
</AppShell>
```

## 3.2 New shell components

| Component | Responsibility |
| --- | --- |
| CopilotButton | Opens ClientTurn Copilot without adding a sidebar destination. |
| CopilotDrawer | Conversational interface over scoped ClientTurn tools. |
| ConnectionHealthPill | Aggregated customer system state; click opens /app/status or compact popover. |
| BackgroundWorkIndicator | Optional subtle indicator when sourcing/intent/campaign jobs are actively running. |
| GlobalSearch | Search leads, prospects, campaigns and supported settings. Results remain tenant-scoped. |

# 4. Dashboard Expansion — `/app`

## 4.1 Goal

Keep Dashboard operational rather than turning it into the analytics module. It must show the health of inbound and outbound acquisition plus immediate conversion movement.

## 4.2 Added components

```text
<DashboardPage>
  <DashboardHeader />
  <HealthStrip />
  <KPIGrid />
  <LeadFunnelCard />
  <NeedsAttentionPanel />
  <RecentLeadsCard />
  <UpcomingBookingsCard />
  <SourcingPerformanceCard />
  <SourcePerformanceCard />
  <FollowUpPerformanceCard />
  <ReactivationPerformanceCard />
</DashboardPage>
```

Add sourcing only where it improves the operational story. Do not add full campaign analytics here.

| Metric/Panel | Definition |
| --- | --- |
| New Prospects | Prospects created in selected period. |
| Sourcing Performance | Found → verified → contacted → replied → promoted to lead → converted. |
| Needs Attention | Includes sourcing failures, mailbox health, provider issues and prospect reviews that require a human. |
| Health Strip | Adds Email and Sourcing health when these capabilities are enabled. |

# 5. Leads — `/app/leads` — Manual Intake Expansion

## 5.1 Goal

Leads remains the primary operational inbox. Manual creation is supported without allowing users to bypass the prospect/lead boundary or contactability policy.

## 5.2 Add Lead split action

```text
<AddLeadSplitButton>
  <AddWarmLeadAction />
  <ImportLeadsAction />
  <AddProspectAction />
  <ImportProspectsAction />
</AddLeadSplitButton>
```

The normal primary button label is “Add lead”. Its menu exposes the additional intake paths. The system never silently treats cold manually-entered data as a permissioned Lead.

# 6. Add Lead Wizard — modal/drawer from `/app/leads`

## 6.1 Goal

Allow staff to enter their own vetted leads from calls, referrals, walk-ins, existing relationships or other legitimate warm sources, and route them into the existing conversion engine.

## 6.2 Wizard structure

```text
<AddLeadWizard>
  <WizardHeader />
  <WizardProgress />
  <ContactStep />
  <EnquiryStep />
  <PermissionStep />
  <RouteAndStartStep />
  <WizardFooter />
</AddLeadWizard>
```

## 6.3 Step 1 — Contact

| Component | Fields / behaviour |
| --- | --- |
| LeadIdentityForm | First name, last name, company/business. |
| LeadContactMethodFields | Email, mobile, telephone. |
| LeadAddressFields | Postcode, address optional. |
| DuplicateCheckBanner | Search existing leads/prospects by normalized email/phone/company before creation. |

## 6.4 Step 2 — Enquiry

| Field | Purpose |
| --- | --- |
| Service | Select an active service or create an allowed one if role permits. |
| Enquiry / interest | Short description of what the person needs. |
| Source | MANUAL, PHONE_CALL, WALK_IN, REFERRAL, EVENT, IMPORT, PIPEDRIVE, OTHER. |
| Source detail | Free text or structured detail; not used to bypass compliance. |
| Estimated value | Optional estimate; clearly not revenue. |
| Conversion goal | Booking, site visit, demo, quote, call, signup, purchase, handover or custom. |
| Notes | Internal operational notes. |

## 6.5 Step 3 — Permission & contactability

This step protects the warm-lead boundary. Users describe the relationship and ClientTurn evaluates which channels can be used.

| Relationship option | Typical treatment |
| --- | --- |
| They contacted us | Warm lead; evaluate configured channels and opt-out state. |
| Existing customer | Existing relationship; channel policy still applies. |
| Referral / introduction | May be warm or review depending evidence and country rules. |
| Requested information | Warm lead where evidence is present. |
| Explicit marketing consent | Store evidence, timestamp, source and scope. |
| Existing business relationship | Store relationship basis; policy engine decides channel. |
| I found this person/company | Treat as Prospect and offer “Add to Find Leads” instead. |
| Other | Require explanation; REVIEW unless policy can classify safely. |

```text
<ContactabilityAssessment>
  <RelationshipTypeSelector />
  <ConsentEvidenceField />
  <ChannelPermissionGrid />
  <ProspectRedirectBanner />
</ContactabilityAssessment>
```

## 6.6 Step 4 — Route & Start

| Control | Behaviour |
| --- | --- |
| Assignee | Workspace member or Unassigned. |
| Initial status | Defaults NEW; controlled transitions only. |
| Needs attention | Manual reason optional; automatic reasons cannot be suppressed here. |
| Start follow-up | Default ON only when at least one permitted channel and automation available. |
| Qualification flow | Use default or selected service flow. |
| Conversion destination | Derived from conversion goal. |

## 6.7 Submit behaviour

1. Re-run normalized-email/phone duplicate checks server-side.
2. Evaluate suppression and contactability server-side.
3. If record should be a Prospect, stop lead creation and return a prospect handoff option.
4. Create lead with manual-source provenance.
5. Create initial activity event and optional assignment event.
6. If follow-up is enabled, invoke the same lead.created orchestration path as an inbound lead.
7. Open the Lead Drawer on success.

# 7. Lead Import Wizard — `/app/leads/import`

## 7.1 Goal

Import existing customer databases safely without polluting Leads with cold prospects or duplicates.

## 7.2 Wizard

```text
Upload → Map → Validate → Classify → Deduplicate → Review → Import
```

```text
<LeadImportPage>
  <ImportHeader />
  <ImportWizardProgress />
  <FileUploadStep />
  <ColumnMappingStep />
  <ValidationStep />
  <ClassificationStep />
  <DedupeStep />
  <ReviewStep />
  <ImportRunProgress />
</LeadImportPage>
```

## 7.3 Supported files

- CSV
- XLSX
- UTF-8 text CSV; delimiter detection
- Maximum file/row limits enforced by plan and server configuration.

## 7.4 Row classification

| Result | Meaning |
| --- | --- |
| IMPORT_AS_LEAD | Relationship/evidence is sufficient for Lead intake. |
| IMPORT_AS_PROSPECT | Cold/unknown relationship; route into Find Leads. |
| REVIEW | Ambiguous relationship, subscriber type, duplicate or permission state. |
| SKIP | Invalid/suppressed/unusable or user-excluded row. |

## 7.5 Import validation flags

- Existing lead
- Existing prospect
- Suppressed contact
- Invalid email
- Invalid phone
- Missing required identity
- Unknown relationship
- Possible cold prospect
- Duplicate within file
- Conflicting source/permission data

## 7.6 Import data model

| Table | Purpose |
| --- | --- |
| lead_imports | Import job metadata, owner, status, counts and file reference. |
| lead_import_rows | Parsed row, normalized fields, validation/classification state. |
| lead_import_mappings | Saved mapping for source templates. |
| lead_source_evidence | Relationship/permission/provenance evidence created during import. |

# 8. Find Leads — `/app/find-leads`

## 8.1 Goal

Give the customer a low-friction AI-assisted acquisition workspace that can learn the business, translate natural-language requirements into a structured search plan, find and verify prospects, monitor intent, coordinate permitted outreach and move engaged prospects into Leads.

## 8.2 Internal views

| View | Purpose |
| --- | --- |
| Discover | Search chats, business/ICP context, saved search strategies, start sourcing run. |
| Prospects | Review, filter, score, approve and inspect sourced prospects. |
| Intent | Define buying-intent categories and monitor signals. |
| Campaigns | Create, switch, pause and optimize outbound acquisition campaigns. |

## 8.3 Shared page tree

```text
<FindLeadsPage>
  <PageHeader />
  <SegmentedViewSwitch />
  <FindLeadsUsageSummary />
  <DiscoverView />
  <ProspectsView />
  <IntentView />
  <CampaignsView />
  <ProspectDrawer />
</FindLeadsPage>
```

# 9. Discover View

## 9.1 First-use experience

The first interaction should be “tell ClientTurn about your business”, not “configure a database query”.

```text
<DiscoverView>
  <AcquisitionProfileSummary />
  <SearchChatLauncher />
  <SavedSearchSessions />
  <RecurringSourcingPanel />
  <RecentSourcingRuns />
</DiscoverView>
```

## 9.2 Website analysis entry

| Component | Behaviour |
| --- | --- |
| BusinessURLField | Defaults to workspace website if known. |
| AnalyseBusinessButton | Queues controlled website analysis; does not block request for long tasks. |
| AnalysisProgress | Shows pages analysed, business profile facts found and verification state. |
| AcquisitionProfileReview | Editable services, target customers, locations, roles, exclusions and conversion goals. |

## 9.3 Acquisition Profile output

| Group | Fields |
| --- | --- |
| Business | Business type, services/products, territories, price/value bands, sales model. |
| ICP | Industries, company size, geography, roles/titles, exclusions. |
| Need/intent | Signals that indicate a likely need. |
| Conversion | Book appointment/site visit/demo, quote, call, signup, purchase, handover. |
| Outreach | Tone, value proposition, proof points, prohibited/unsupported claims. |
| Constraints | Countries, channel permissions, plan limits, provider availability. |

# 10. Search Session — `/app/find-leads/search/[sessionId]`

## 10.1 Goal

Provide a conversational AI sourcing interface where the user can iteratively describe who they want, while ClientTurn always exposes the structured search interpretation before spending provider budget.

## 10.2 Component tree

```text
<SearchSessionPage>
  <SearchSessionHeader />
  <SearchConversationPanel>
    <SearchMessageList />
    <SearchComposer />
    <SearchSuggestionChips />
  </SearchConversationPanel>
  <StructuredSearchPlanPanel>
    <ICPFilterSummary />
    <IntentFilterSummary />
    <ExclusionSummary />
    <ConversionGoalSummary />
    <SearchBudgetControls />
  </StructuredSearchPlanPanel>
  <StartSourcingRunButton />
</SearchSessionPage>
```

## 10.3 Search conversation behaviour

The user may write natural language such as “Find property managers within 40 miles of Bournemouth who manage multiple properties and may need a commercial roofing contractor.” The Search Agent returns an editable structured plan; the system does not call expensive enrichment merely because the model generated a suggestion.

## 10.4 Structured plan

| Dimension | Examples |
| --- | --- |
| Industry/category | Property management, facilities management, hotels. |
| Location | Country, region, city, radius. |
| Company | Employee range, revenue band where licensed data exists, organisation type. |
| Decision maker | Property Manager, Facilities Manager, Operations, Director. |
| Intent | Selected named intent categories and freshness. |
| Exclusions | Competitors, existing customers, opt-outs, prior bad-fit cohorts. |
| Minimum grade | A+, A, B, etc. |
| Result target | Number of verified prospects to produce. |
| Review mode | Auto-contact vs human review before outreach. |
| Conversion goal | Site visit, demo, quote, signup, purchase, etc. |

## 10.5 Search budget controls

| Control | Rule |
| --- | --- |
| Target verified prospects | Cannot exceed remaining plan/overage entitlement. |
| Max provider cost | Derived from plan budget and admin provider cost ceiling. |
| Minimum score | Prevents spending on low-fit contacts. |
| Intent required | Optional/required depending campaign. |
| Auto-contact | Available only when campaign, sender, eligibility and budgets are valid. |
| Review before outreach | When ON, READY prospects wait for approval. |

# 11. Sourcing Run — `/app/find-leads/runs/[runId]`

## 11.1 Goal

Make background AI/provider work understandable, inspectable and resumable without exposing raw internal implementation.

## 11.2 Live process UI

```text
<SourcingRunPage>
  <RunHeader />
  <RunProgressRail />
  <RunCounters />
  <RunBudgetMeter />
  <ProviderActivitySummary />
  <RunResultBreakdown />
  <RunIssuesPanel />
  <RunControls />
</SourcingRunPage>
```

## 11.3 Canonical stages

1. Understanding target
2. Planning search
3. Finding companies
4. Finding contacts
5. Cheap pre-filtering
6. Enriching high-fit records
7. Verifying emails
8. Deduplicating
9. Compliance/contactability classification
10. Scoring and grading
11. Intent matching
12. Preparing outreach or review queue

## 11.4 Run counters

| Counter | Meaning |
| --- | --- |
| Companies found | Unique company candidates before contact enrichment. |
| Contacts found | Unique candidate decision-makers. |
| Emails discovered | Email candidates from licensed/public/permitted sources. |
| Verified | Email/contact records passing configured verification threshold. |
| Duplicates | Matched existing prospect/lead/customer records. |
| Suppressed | Opt-out, invalid, legal, complaint or platform-suppressed. |
| Review required | Ambiguous subscriber/contactability/provider data. |
| Ready | Valid prospect records that meet score/eligibility gates. |

## 11.5 Run controls

- Pause run
- Resume run
- Stop run
- Increase target only if entitlement and overage policy permit
- Open prospects
- Open issues
- Do not allow arbitrary “ignore budget” or “ignore compliance” actions

# 12. Prospects View

## 12.1 Goal

Provide a focused outbound prospect inbox separate from Leads.

## 12.2 Component tree

```text
<ProspectsView>
  <ProspectQuickFilters />
  <ProspectToolbar />
  <ProspectTableOrCardView />
  <ProspectPagination />
  <ProspectDrawer />
</ProspectsView>
```

## 12.3 Quick filters

- All
- A Grade
- Intent
- Ready
- Contacted
- Replied
- Review

## 12.4 Advanced filters

- ICP
- Score/grade
- Industry
- Location
- Company size
- Role/title
- Intent category
- Intent freshness
- Email verification
- Outreach status
- Campaign
- Source provider
- Date
- Contactability eligibility

## 12.5 Prospect columns

| Column | Content |
| --- | --- |
| Prospect | Contact + company. |
| Fit | Grade and explainable score. |
| Intent | Highest current intent badge/freshness. |
| Role | Title and decision-maker classification. |
| Location | Company/contact location. |
| Verification | Verified/unknown/risky. |
| Eligibility | Eligible/Review/Consent required/Suppressed. |
| Campaign | Current acquisition campaign. |
| Outreach | Ready/Active/Replied/etc. |
| Last activity | Latest sourcing/outreach/reply event. |

# 13. Prospect Drawer

## 13.1 Internal views

- Summary
- Research
- Conversation
- Activity

A Prospect Drawer may have four views because Research is a meaningful sourcing-specific concept. Lead Drawer remains three views and is not expanded.

## 13.2 Summary components

- ProspectIdentityBlock
- CompanySummary
- ProspectGradeCard
- IntentSummaryCard
- ContactabilityCard
- VerificationCard
- CampaignAssignment
- ApproveForOutreachButton
- PromoteToLeadButton when appropriate
- SuppressAction

## 13.3 Research components

- ResearchEvidenceList
- SourceProvenanceRow
- CompanyWebsiteSummary
- RoleEvidence
- IntentEvidence
- AIResearchSummary
- RefreshResearchButton subject to budget

## 13.4 Conversation

Cold email and any supported later channel replies remain attached to the Prospect until promotion. On promotion, the conversation_id is retained and the Lead immediately sees the full history.

# 14. Explainable Prospect Scoring

## 14.1 Canonical score

| Factor | Default weight | Example evidence |
| --- | --- | --- |
| Ideal Customer Fit | 30% | Industry, company type/size, service relevance. |
| Role / Authority | 20% | Title relevance and decision influence. |
| Geography | 15% | Inside service/target territory. |
| Need | 15% | Company context likely to need the product/service. |
| Intent | 10% | Fresh observable buying/need signal. |
| Data Quality | 10% | Verified email, authoritative source, entity confidence. |

Weights are versioned and configurable by platform/admin policy. AI produces evidence/features; deterministic code computes the canonical numeric score.

## 14.2 Grades

| Grade | Default score band | Meaning |
| --- | --- | --- |
| A+ | 95–100 | Exceptional match. |
| A | 85–94 | Strong match. |
| B | 70–84 | Good match. |
| C | 55–69 | Possible; normally review or exclude from automated spend. |
| D | 0–54 | Weak; do not spend expensive enrichment/outreach budget by default. |

## 14.3 Score explanation

Every score must expose positive/negative factors, evidence source, freshness and confidence. “AI says 91” is not sufficient.

# 15. Intent View

## 15.1 Goal

Allow customers to define named buying-intent categories and monitor target companies/segments for permitted signals that improve prioritization.

## 15.2 Component tree

```text
<IntentView>
  <IntentOverview />
  <IntentCategoryList />
  <IntentCategoryBuilder />
  <NamedCompanyMonitor />
  <IntentEventFeed />
  <IntentUsagePanel />
</IntentView>
```

## 15.3 Category examples

- Commercial roofing need
- Expansion / new location
- New property acquisition
- Tender / procurement
- Hiring facilities staff
- Renovation project
- New funding
- New construction
- Technology replacement
- Competitor dissatisfaction
- New management
- First-party website buying intent

## 15.4 Intent Category Builder

| Field | Description |
| --- | --- |
| Name | User-facing category name. |
| Description | What business need the category represents. |
| Signal types | Approved source/signal families. |
| Keywords/entities | Optional structured terms and named entities. |
| Freshness window | How long a signal influences scoring. |
| Score impact | Bounded deterministic score contribution. |
| ICP scope | All ICPs or selected ICPs. |
| Auto-add to search | Whether active searches may use it. |
| Monitoring cadence | Daily/weekly or provider-supported cadence; plan constrained. |

## 15.5 Intent sources

Use licensed, connected first-party or public sources whose terms permit the intended use. The architecture must be provider-based and provenance-aware rather than a generic unrestricted web scraper.

- Company websites
- Official registries where permitted
- Tender/procurement notices
- Planning/public project data
- News/search feeds
- Job postings where terms permit
- First-party website events
- Connected CRM activity
- Email replies and conversation intent
- Customer-supplied datasets

# 16. Acquisition Campaigns View

## 16.1 Goal

Coordinate outbound prospect selection, sequencing, budgets and conversion objectives without exposing a generic workflow builder.

## 16.2 Campaign list components

- CampaignList
- CampaignStatusBadge
- CampaignPriorityControl
- CampaignBudgetUsage
- CampaignMiniFunnel
- CampaignSwitchMenu
- NewCampaignButton

## 16.3 States

- DRAFT
- READY
- ACTIVE
- PAUSED
- OPTIMIZING
- COMPLETED
- STOPPED

# 17. New Acquisition Campaign — `/app/find-leads/campaigns/new`

## 17.1 Wizard

```text
Goal → Audience → Intent & Score → Outreach → Budget & Limits → Review & Launch
```

## 17.2 Step 1 — Goal

| Field | Values |
| --- | --- |
| Campaign name | User-defined. |
| Conversion goal | BOOK_APPOINTMENT, BOOK_SITE_VISIT, BOOK_DEMO, REQUEST_QUOTE, PHONE_CALL, DIRECT_SIGNUP, DIRECT_PURCHASE, HUMAN_HANDOVER, CUSTOM. |
| Primary service/product | Workspace service/product. |
| Success event | Mapped conversion event used for optimization. |

## 17.3 Step 2 — Audience

- Select saved search/ICP
- Choose geography/company/role constraints
- Existing prospects vs new sourcing
- Exclusions
- Existing customers/leads suppression
- Named company list optional

## 17.4 Step 3 — Intent & Score

- Minimum grade
- Selected intent categories
- Intent required/optional
- Maximum intent age
- Review threshold
- Eligibility rule preview

## 17.5 Step 4 — Outreach

Cold outreach starts email-first unless policy explicitly permits another channel. Social is manual/API-gated. Warm prospects/leads can transition to configured multi-channel Follow-Up after engagement.

- Connected sender identity
- Cold email sequence
- Message variants
- Reply classification behaviour
- Promotion-to-lead behaviour
- Manual review vs automatic start

## 17.6 Step 5 — Budget & Limits

| Control | Behaviour |
| --- | --- |
| Prospects per month/run | Bounded by sourcing entitlement and cost. |
| Daily contacts | Cannot exceed system/mailbox health cap. |
| Monthly contacts | Campaign cap. |
| Provider cost ceiling | Internal/plan-controlled. |
| Communication allowance | Campaign reservation from tenant allowance. |
| Auto overage | OFF by default; requires explicit customer setting. |
| Auto Optimize | OFF by default for budget-affecting behavior; bounded if enabled. |

## 17.7 Step 6 — Review & Launch

Server-side launch validation re-checks sender health, plan entitlements, suppression, contactability, sequence validity, provider health, domain/mailbox safety and budget.

# 18. Campaign Detail — `/app/find-leads/campaigns/[campaignId]`

## 18.1 Views

- Overview
- Audience
- Sequence
- Performance
- Activity

## 18.2 Overview

- CampaignStateCard
- CampaignGoalCard
- BudgetUsageCard
- ProspectFunnel
- CurrentOptimizationCard
- RecentReplies
- AttentionItems

## 18.3 Campaign switching

Users can Pause, Resume, Duplicate, Archive and change priority. “Switch priority” changes scheduling priority but never bypasses a channel/compliance or budget limit.

## 18.4 Auto Optimize

When enabled, bounded optimization may change send-time windows, message variant allocation, subject variants, prospect grade threshold within configured bounds, role priority, follow-up spacing and campaign priority. It cannot increase paid spend beyond authorized budgets or reduce safety/compliance gates.

# 19. Follow-Up Expansion — `/app/follow-up`

## 19.1 Email as a first-class warm channel

The existing warm-lead SequenceEditor adds Email beside SMS and WhatsApp. Channel policy determines whether a step may use the chosen channel for the current lead.

| Channel | Warm/permissioned lead | Cold prospect default |
| --- | --- | --- |
| Email | Allowed when contactability permits and sender available. | Primary automated cold channel where policy says eligible. |
| SMS | Allowed when policy permits. | Blocked by default for cold prospecting. |
| WhatsApp | Allowed when policy/provider/template requirements permit. | Blocked by default for cold prospecting. |
| Social | Manual/API-gated action where allowed. | Manual/API-gated only; no browser-bot spam. |

## 19.2 Follow-Up component changes

- StepChannelSelect supports EMAIL
- EmailSubjectField appears for Email steps
- EmailTemplateEditor supports plain-text/brand-safe formatting
- SenderIdentitySelect
- ChannelFallbackPreview
- ChannelPolicyWarning
- MessageCostEstimate internal/hidden from normal user except allowance impact

## 19.3 Merge fields

- {{first_name}}
- {{business_name}}
- {{service_name}}
- {{booking_link}}
- {{business_phone}}
- {{company_name}}
- {{conversion_link}}

# 20. Cold Outreach Sequence

## 20.1 Separation from warm Follow-Up

Cold acquisition campaigns use a separate sequence definition. Cold sequences do not appear as a third top-level Follow-Up tab; they are edited inside the acquisition campaign.

## 20.2 Default cold sequence

| Step | Default | Channel |
| --- | --- | --- |
| 1 | Day 0 | Email |
| 2 | Day 3 | Email |
| 3 | Day 7 | Email |
| 4 | Day 14 | Email |

Replies, opt-outs, bounce/complaint states, promotion to Lead, campaign pause, budget exhaustion and sender-health failures stop or suppress subsequent sends.

# 21. Analytics — `/app/analytics`

## 21.1 Why Analytics is now justified

Dashboard remains operational. The expanded product now has enough acquisition, outreach and conversion dimensions that deep analysis no longer fits responsibly on one dashboard.

## 21.2 Internal views

```text
<AnalyticsPage>
  <PageHeader />
  <AnalyticsViewSwitch />
  <OverviewAnalytics />
  <AcquisitionAnalytics />
  <OutreachAnalytics />
  <ConversionAnalytics />
</AnalyticsPage>
```

## 21.3 Overview

Full journey: Prospects discovered → Verified → Contacted → Replies → Leads → Qualified → Converted → Won, with source split by inbound, ClientTurn Sourcing, manual, reactivation and integrations.

## 21.4 Acquisition

- Sourcing runs
- Prospects found
- Verified prospects
- Cost per verified prospect
- A/B grade share
- Intent matches
- Prospect → reply
- Prospect → lead
- Prospect → conversion
- Provider waterfall efficiency

## 21.5 Outreach

- Emails sent
- SMS segments
- WhatsApp messages
- Manual/API social touches
- Delivery rate
- Bounce rate
- Reply rate
- Positive reply rate
- Opt-out rate
- Channel performance
- Campaign performance
- Sequence performance
- Sender/domain health trends

## 21.6 Conversion

- Leads
- Replies
- Qualified
- Booked
- Demo booked
- Quote requested
- Signup
- Purchase
- Won
- Lead → Qualified
- Qualified → Goal
- Lead → Won
- Time to conversion
- Source performance
- Campaign performance
- Service/product performance
- Conversion-goal performance

## 21.7 Metrics truth rule

Every metric has one canonical backend definition. No client component calculates a different definition from the analytics service. Test leads/messages and internal support traffic are excluded.

# 22. Status — `/app/status`

## 22.1 Goal

Give users one diagnostic page that answers whether ClientTurn is working without adding a main-nav destination.

## 22.2 Sections

- Lead sources
- Email mailbox/sender
- SMS
- WhatsApp
- Booking
- Sourcing
- Intent monitors
- Campaigns
- Background agents
- Queue status
- Recent failures
- Last successful sync

## 22.3 Components

- StatusOverview
- StatusGroup
- StatusRow
- RecentFailureList
- BackgroundJobSummary
- IntegrationReconnectAction
- OpenRelevantSettingsAction

# 23. Customer Support — `/app/support`

## 23.1 Views

- Help
- My Tickets
- System Status

## 23.2 Components

- SupportSearch
- HelpArticleList
- NewTicketButton
- TicketList
- SupportTicketDrawer
- TicketConversation
- AttachmentUploader
- TicketStatusBadge

## 23.3 Ticket creation

| Field | Purpose |
| --- | --- |
| Category | Billing, Integration, Lead/Message, Sourcing, Account, Other. |
| Subject | Short issue summary. |
| Description | User explanation. |
| Attachment | Optional; file type/size policy. |
| Context opt-in | Allow ClientTurn to attach current route, workspace and safe diagnostics. |

# 24. Settings Expansion

## 24.1 Final settings views

- Workspace
- Connections
- Business Profile
- Team
- Billing & Usage

# 25. Settings — Connections

## 25.1 Groups

| Group | Connections |
| --- | --- |
| Lead Sources | Meta Lead Ads; website/forms where supported. |
| Communication | Twilio SMS; Twilio WhatsApp; Google Workspace; Microsoft 365; Other mailbox (IMAP+SMTP fallback). |
| Booking / Conversion | Calendly; Google Calendar; conversion webhooks/links where configured. |
| CRM | Pipedrive. |
| Discovery | Platform-managed prospect/enrichment/verification providers shown as capability health, not customer secrets. |

## 25.2 Email setup components

- MailboxProviderSelector
- GoogleOAuthCard
- MicrosoftOAuthCard
- GenericMailboxCard
- SenderIdentityEditor
- DomainHealthPanel
- MailboxHealthPanel
- TestEmailButton
- InboundSyncStatus

# 26. Settings — Business Profile

## 26.1 Goal

Make ClientTurn’s business learning transparent, editable and safe. This is where the customer can inspect what ClientTurn believes about the business rather than relying on hidden LLM memory.

## 26.2 Sections

- Business Learning
- Knowledge Sources
- ICP Profiles
- Conversion Goals
- Outreach Guidance
- Learned Performance

## 26.3 Components

- BusinessProfileSummary
- BusinessMemoryFactList
- MemoryFactEditor
- FactLockToggle
- KnowledgeSourceList
- AddKnowledgeSource
- ICPProfileList
- ICPProfileEditor
- ConversionGoalList
- ConversionGoalEditor
- OutreachGuidanceEditor
- LearnedPerformanceInsights

## 26.4 Memory fact model

| Field | Purpose |
| --- | --- |
| fact_key | Stable semantic key. |
| fact_value | Structured JSON/text value. |
| source | User, website, integration, model inference, performance. |
| confidence | Operational confidence; not a marketing claim. |
| verified_by_user | Customer confirmed. |
| locked | Optimization/agents cannot overwrite. |
| last_verified_at | Freshness check. |
| valid_from/valid_to | Optional temporal validity. |

# 27. Settings — Billing & Usage

## 27.1 Added usage surfaces

- PlanCard
- SourcingAllowanceMeter
- CommunicationAllocationSliders
- ChannelUsageTable
- IntentMonitorUsage
- SearchRunUsage
- AIIncludedLabel
- OverageControl
- MonthlySpendCap
- UsageHistory

## 27.2 Communication allocation

Customers allocate a plan-specific communication allowance between Email, SMS and WhatsApp. ClientTurn converts the allocation into estimated available sends using the current internal provider price book. Raw provider unit costs are not exposed.

```text
<CommunicationAllocation>
  <AllocationSlider channel="email" />
  <AllocationSlider channel="sms" />
  <AllocationSlider channel="whatsapp" />
  <AllocationTotal />
  <EstimatedSendCounts />
  <DailyCapControls />
</CommunicationAllocation>
```

## 27.3 Overage

Automatic overage is OFF by default. Customers may enable it and set a monthly additional-spend ceiling. All actual billable usage remains server-authoritative and idempotent.

# 28. ClientTurn Copilot

## 28.1 Surface

Copilot is a shell-level right drawer opened by the Copilot button; it is not another main page.

## 28.2 Example requests

- Find another 100 companies similar to this month’s converted customers.
- Which leads need attention?
- Why is the Hotels campaign outperforming Property Managers?
- Draft a new permitted email campaign for facilities managers.
- Show prospects with recent expansion intent.
- Pause Campaign B.
- Summarize this lead and recommend the next action.

## 28.3 Tool rule

Copilot calls the same domain services/tools as the UI. It does not write directly to arbitrary tables. High-impact actions use confirmation and permission scopes.

# PART IV — Affiliate Programme

# 29. Affiliate Marketing & Entry — `/affiliates`

## 29.1 Goal

Recruit and enable affiliates without mixing affiliate operations into the customer app.

## 29.2 Components

- AffiliateHero
- ProgrammeBenefits
- CommissionExplanation
- WhoItIsFor
- AffiliateFAQ
- ApplyOrLoginCTA

# 30. Affiliate Dashboard — `/affiliates/app`

## 30.1 Components

- AffiliateHeader
- AffiliateKPIGrid
- RecentReferrals
- CommissionSummary
- TopLinks
- ResourceHighlights
- PayoutStatusCard

## 30.2 Metrics

- Clicks
- Signups
- Trials
- Paid customers
- Conversion rate
- Pending commission
- Approved commission
- Paid commission

# 31. Affiliate Links

## 31.1 Components

- ReferralLinkGenerator
- UTMBuilder
- PromoCodeList
- CampaignLinkTable
- CopyLinkButton
- QRGenerator optional

# 32. Affiliate Referrals

## 32.1 Lifecycle

```text
Click → Signup → Trial → Paid → Renewal → Commission → Payout
```

## 32.2 Columns

- Referral
- Source link/campaign
- Signup date
- Trial status
- Plan
- Paid state
- Commission state
- Attribution expiry

# 33. Affiliate Resources Hub

## 33.1 Goal

Provide a complete brand and sales enablement hub inspired by the capability level of leading affiliate resource portals, but with ClientTurn-owned original structure, copy and assets.

## 33.2 Resource categories

| Category | Assets |
| --- | --- |
| Brand | Logos, symbol, light/dark variants, colour palette, logo rules, typography. |
| Product Screenshots | Dashboard, Leads, Find Leads, Follow-Up, Reactivation, Analytics, Settings. |
| Ad Creatives | Square, portrait, landscape, story/reel covers, editable templates where provided. |
| Video | Short product clips, walkthroughs, feature demos, social snippets. |
| Copy | Social captions, ad copy, email swipe copy, landing copy, short descriptions. |
| Education | Who ClientTurn is for, positioning, plans, feature comparison, FAQs, objection handling. |
| Campaign Packs | Launch, seasonal, industry-specific and feature-specific resource collections. |

## 33.3 Components

- ResourceCategoryNav
- ResourceSearch
- ResourceCard
- ResourcePreviewDrawer
- DownloadAssetAction
- CopyTextAction
- AssetVersionBadge
- CampaignPackCard

# 34. Affiliate Performance

## 34.1 Components

- DateRangePicker
- ClickTrend
- SignupFunnel
- PaidConversionChart
- TopLinkTable
- CampaignPerformanceTable
- CommissionTrend

# 35. Affiliate Payouts

## 35.1 Components

- PayoutBalanceCard
- UpcomingPayoutCard
- PayoutHistoryTable
- PaymentMethodCard
- TaxInfoStatus
- CommissionDetailDrawer

# PART V — Platform Administration Expansion

# 36. Admin Shell

## 36.1 Navigation

- Overview
- Customers
- Support
- Affiliates
- System
- Billing
- Usage & Margins
- Settings

Preserve the approved dark ClientTurn Platform Admin shell. Expanded and collapsed states follow the existing shell specification.

# 37. Admin Overview — `/admin`

## 37.1 Added metrics

- Prospects sourced
- Verified prospects
- Cold emails sent
- Warm emails sent
- SMS segments
- WhatsApp messages
- Prospect → Lead
- Conversions
- Sourcing/provider cost
- Failed background jobs

## 37.2 Components

- AdminKPIGrid
- ProviderHealthPanel
- RecentCustomerActivity
- SystemAlerts
- CustomerEconomicsPanel
- AcquisitionOperationsPanel
- FailedJobsPanel

# 38. Admin Customers — `/admin/customers`

## 38.1 Customer drawer sections

- Account
- Plan & Entitlements
- Connections
- Sourcing
- Messaging
- AI
- Economics
- Recent Jobs/Failures
- Audit

## 38.2 Sourcing data

- Prospects sourced
- Verified prospects
- Search runs
- Intent monitors
- Discovery cost
- Enrichment cost
- Verification cost
- Provider mix
- Reply rate
- Promoted leads
- Conversions

## 38.3 Messaging data

- Email sends
- SMS segments
- WhatsApp messages
- Bounces
- Complaints
- Opt-outs
- Mailbox health
- Domain health

# 39. Admin Support — `/admin/support`

## 39.1 Views

- Inbox
- Open
- Waiting
- Resolved

## 39.2 Component tree

```text
<AdminSupportPage>
  <SupportQueueTabs />
  <SupportSearch />
  <SupportTicketTable />
  <SupportTicketDrawer>
    <TicketConversation />
    <CustomerContextPanel />
    <InternalNotes />
    <TicketEvents />
    <SupportCopilotPanel />
  </SupportTicketDrawer>
</AdminSupportPage>
```

## 39.3 Support Copilot

- Summarize ticket
- Suggest reply
- Show related customer integration failures
- Show recent billing/subscription changes
- Show related background-job errors
- Search approved internal help content

Copilot drafts; a human sends external support responses unless a future explicitly-approved automation policy exists.

# 40. Support Email Ingestion

## 40.1 Preferred architecture

```text
support@clientturn.com
      ↓
Gmail API / Microsoft Graph (preferred)
or IMAP fallback
      ↓
thread resolver
      ↓
existing ticket OR new ticket
      ↓
AI category + summary
      ↓
Admin Support queue
      ↓
Human reply
      ↓
Gmail/Graph or SMTP
```

## 40.2 Threading

- Message-ID
- In-Reply-To
- References
- Provider thread ID where available
- Normalized sender/recipient identities

## 40.3 POP rule

POP is not used as the primary support/customer-mail protocol. IMAP synchronizes inbound mail; SMTP sends in generic-mailbox fallback. Google Workspace and Microsoft 365 use their OAuth APIs where possible.

# 41. Admin Affiliates — `/admin/affiliates`

## 41.1 Views

- Overview
- Affiliates
- Referrals
- Commissions
- Payouts
- Resources
- Settings

## 41.2 Admin actions

- Approve/suspend affiliate
- Set programme/default or affiliate-specific commission
- Create promo codes
- Approve/reverse commission
- Create payout batch
- Mark payout complete
- Upload/publish/version resource
- Archive resource
- Manage attribution windows

# 42. Admin System — `/admin/system`

## 42.1 Views

- Health
- Events
- Errors
- Jobs
- Compliance

## 42.2 Health providers

- Supabase
- Azure OpenAI
- Meta
- Twilio
- Google Workspace
- Microsoft 365
- Calendly
- Google Calendar
- Pipedrive
- Prospect search providers
- Enrichment providers
- Email verification providers
- Optional cold-email infrastructure providers

# 43. Admin System — Jobs

## 43.1 Components

- JobQueueOverview
- JobTypeFilter
- JobTable
- JobDetailDrawer
- RetryJobButton
- CancelJobButton
- DeadLetterPanel
- QueueLagChart

## 43.2 Safety

Retries are idempotent and use stable action keys. Admin cannot blindly retry provider sends if the original state may have succeeded; job handlers must reconcile provider IDs first.

# 44. Admin System — Compliance

## 44.1 Components

- PolicyVersionList
- CountryPolicyMatrix
- ChannelPolicyMatrix
- ReviewQueue
- SuppressionSearch
- ComplianceDecisionDrawer
- PrivacyNoticeQueue
- AuditExport

## 44.2 Purpose

This is an operational policy/control surface, not legal advice. Production policy packs for UK/US and each communication provider must be reviewed and versioned before broad rollout.

# 45. Admin Billing — `/admin/billing`

## 45.1 Views

- Subscriptions
- Invoices
- Credits & Adjustments
- Entitlements

## 45.2 Subscription controls

- View Stripe state
- Change plan through controlled billing action
- Cancel at period end
- Apply account credit
- Grant temporary entitlement
- Set support-approved trial extension
- View billing webhook timeline

# 46. Admin Usage & Margins — `/admin/economics`

## 46.1 Goal

Protect contribution margin per tenant while allowing flexible customer usage.

## 46.2 Views

- Customers
- Providers
- Plans
- Anomalies

## 46.3 Customer economics

| Metric | Meaning |
| --- | --- |
| Subscription revenue | Recurring plan revenue for period. |
| Overage revenue | Metered/add-on revenue. |
| Discovery cost | Search/company data provider cost. |
| Enrichment cost | Contact/company enrichment. |
| Verification cost | Email/phone verification. |
| AI cost | Model calls by deployment/agent. |
| Email cost | Platform infrastructure only; customer mailbox sending often low direct cost. |
| SMS cost | Twilio/provider cost. |
| WhatsApp cost | Provider + applicable template/platform fees. |
| Infrastructure allocation | Shared Supabase/Vercel/email/etc. allocation. |
| Stripe cost | Payment and billing processing. |
| Contribution | Revenue minus tracked/allocated COGS. |
| Margin % | Contribution / revenue. |

## 46.4 Alerts

- Margin below plan threshold
- Sourcing cost anomaly
- AI cost anomaly
- SMS/WhatsApp usage spike
- High verification failure rate
- Provider price changed
- Mailbox bounce/complaint issue
- Overage approaching customer cap

# 47. Admin Platform Settings — `/admin/settings`

## 47.1 Views

- Providers
- AI & Agents
- Outreach
- Compliance
- Price Book
- Feature Flags

## 47.2 Provider controls

- Provider priority
- Failover order
- Country availability
- Estimated unit cost
- Hard cost ceiling
- Rate limits
- Health status
- Feature capability
- Credential secret references

## 47.3 AI controls

- Agent enable/disable
- Model routing policy
- Per-agent token/provider budget
- Prompt version deployment
- Fallback policy
- Evaluation thresholds
- Kill switch

## 47.4 Outreach controls

- Global daily caps
- Mailbox/domain health thresholds
- Cold channel policy
- Campaign concurrency
- Warm/cold sequence defaults
- Social capability flags

# PART VI — AI & Agent Architecture

# 48. Agent design principle

ClientTurn does not run dozens of independent self-directed agents. It uses one shared Agent Runtime with nine bounded profiles plus user-facing/admin copilots. Each profile has an explicit goal, tool allowlist, model router, maximum cost and result schema.

# 49. Canonical agent profiles

| Agent | Primary responsibility | Model bias | Key tools |
| --- | --- | --- | --- |
| Business Intelligence Agent | Understand website, services, market and business facts. | GPT-5.4 mini | Website read, knowledge extraction, profile proposals. |
| ICP Strategy Agent | Build/edit target customer profiles and exclusions. | GPT-5.4 mini | Business profile, conversion history, ICP schema. |
| Search Agent | Translate natural-language intent into provider-efficient structured searches. | Nano → Mini when ambiguous | Search provider planners, budget estimator. |
| Research Agent | Normalize company/contact research and provenance. | GPT-5.4 nano | Provider result normalization, website evidence. |
| Intent Agent | Classify buying/need signals and freshness. | GPT-5.4 nano | Intent sources, evidence schema. |
| Scoring Agent | Turn evidence into explainable score factors. | Nano; Mini for complex evidence | Scoring feature extractor. |
| Outreach Agent | Create bounded, factual, personalized message variants. | GPT-5.4 mini | Business facts, approved proof points, sequence context. |
| Conversion Agent | Interpret replies, answer safely, qualify and propose next action. | Nano/Mini | Conversation, qualification tools, booking links. |
| Optimization Agent | Analyze performance and propose/apply bounded optimizations. | GPT-5.4 mini | Analytics, campaign settings, experiment allocator. |

# 50. Agent Runtime

```text
<AgentRuntime>
  <AgentRouter />
  <AgentContextBuilder />
  <AgentBudgetService />
  <AgentPolicyService />
  <AgentToolRegistry />
  <PromptRegistry />
  <StructuredOutputValidator />
  <AgentExecutionLogger />
  <AgentEvaluationService />
</AgentRuntime>
```

## 50.1 Model environment

```text
AZURE_OPENAI_DEPLOYMENT_DEFAULT=gpt-5.4-mini
AZURE_OPENAI_DEPLOYMENT_FAST=gpt-5.4-nano
```

## 50.2 Routing

Nano handles high-volume classification/extraction and cheap pre-filtering. Mini handles business strategy, complex research synthesis, personalization, multi-turn reasoning and optimization. Deterministic code handles scoring arithmetic, policy, budgets, scheduling, billing, suppression and state transitions.

# 51. Agent run record

| Field | Purpose |
| --- | --- |
| id | Agent execution ID. |
| business_id | Tenant scope. |
| agent_type | Canonical profile. |
| subject_type / subject_id | Search, prospect, campaign, lead, support ticket, etc. |
| deployment | Actual Azure deployment. |
| prompt_key / prompt_version | Reproducibility. |
| input_tokens / cached_tokens / output_tokens | Actual metered usage. |
| tool_calls | Count and references to agent_tool_calls. |
| provider_cost | Non-LLM provider cost triggered by run. |
| budget_before / budget_after | Budget accounting. |
| confidence | Task-specific operational confidence. |
| status / error_code | Execution result. |
| result_json | Validated result. |

# 52. AI budgets and limits

## 52.1 Customer abstraction

Customers see prospect/search/intent/communication allowances, not LLM tokens. Token budgets are an internal safety and margin-control mechanism.

## 52.2 Per-run internal budget

- max_companies_checked
- max_contacts_requested
- target_verified_prospects
- max_search_calls
- max_enrichment_calls
- max_verification_calls
- max_nano_input_tokens
- max_nano_output_tokens
- max_mini_input_tokens
- max_mini_output_tokens
- max_provider_cost
- max_total_cost
- deadline_at

## 52.3 Budget result states

- COMPLETED
- PARTIAL_TARGET_REACHED
- BUDGET_LIMIT_REACHED
- PLAN_LIMIT_REACHED
- PROVIDER_LIMIT_REACHED
- PAUSED
- FAILED

# 53. Cost-efficient sourcing algorithm

```text
candidate company
    ↓
FREE/CHEAP deterministic filters
    ↓
Nano classification
    ↓
fit too low? → stop
    ↓
cheap company enrichment
    ↓
score below enrichment gate? → stop
    ↓
contact discovery/enrichment
    ↓
email verification
    ↓
compliance/contactability
    ↓
final score/grade
    ↓
Mini personalization ONLY when prospect will actually be contacted
```

# 54. Business learning and memory

## 54.1 Memory categories

| Category | Examples | Write policy |
| --- | --- | --- |
| Verified business facts | Services, territories, claims, prices if user-supplied. | User/system source; user can lock. |
| Knowledge sources | Website pages, docs, integrations. | Versioned source records. |
| ICP hypotheses | Target industries/roles/segments. | AI may propose; user or bounded optimization approves/applies. |
| Performance learnings | Best role, source, message, intent, timing. | Derived from actual analytics; expires/recalculates. |
| Negative learnings | Poor-fit cohorts, high bounce sources, low-conversion segments. | Derived with sample-size guardrails. |

## 54.2 Memory safety

- Never let inferred facts silently overwrite user-verified locked facts.
- Every learned item records evidence and recency.
- Performance learning requires minimum sample size.
- Users can inspect/delete/lock business-profile facts.
- Memory is tenant-scoped and never cross-pollinated with another customer’s identifiable information.

# 55. Search chat architecture

## 55.1 Tables

- search_sessions
- search_messages
- search_strategies
- search_strategy_versions
- search_feedback

## 55.2 Search Agent output schema

```text
{
  "icp_profile_id": "...",
  "industries": [],
  "locations": [],
  "company_filters": {},
  "decision_roles": [],
  "intent_categories": [],
  "exclusions": [],
  "minimum_grade": "B",
  "target_verified_prospects": 250,
  "conversion_goal_id": "...",
  "review_before_outreach": false,
  "estimated_cost_band": "WITHIN_PLAN",
  "requires_user_confirmation": true
}
```

A user confirmation is required before a new search plan can trigger provider spend unless it is a previously-approved recurring/autopilot search operating within unchanged bounds.

# 56. Reply classification

## 56.1 Canonical classes

- POSITIVE_INTEREST
- NEUTRAL_QUESTION
- OBJECTION
- NOT_NOW
- WRONG_PERSON
- REFERRAL_TO_OTHER_PERSON
- UNSUBSCRIBE
- COMPLAINT
- BOUNCE/AUTO_RESPONSE
- HUMAN_REQUEST
- UNKNOWN

## 56.2 Rule

Deterministic unsubscribe/suppression patterns run before AI. AI classification assists with semantic intent; low confidence becomes REVIEW. A positive or meaningful neutral response may promote the Prospect to a Lead and start the normal Convert engine.

# 57. Optimization Agent

## 57.1 Inputs

- Campaign conversion metrics
- Reply classification
- Source/provider quality
- Prospect grades
- Intent categories
- Send times
- Message variants
- Channel outcomes
- Cost per outcome

## 57.2 Allowed bounded changes

- Send time inside safe windows
- Message/subject variant allocation
- Campaign priority
- Prospect grade threshold within customer bounds
- Role priority
- Follow-up spacing
- Channel preference for warm leads where policy permits

## 57.3 Forbidden autonomous changes

- Increase customer paid spend above authorization
- Disable suppression
- Lower legal/compliance thresholds
- Cold SMS/WhatsApp/social outside policy
- Change verified business facts
- Create unsupported product claims
- Activate a new provider without admin/customer authorization

# PART VII — Sourcing, Enrichment, Intent & Provenance

# 58. Provider abstraction

No customer flow depends directly on one vendor. Adapters expose capabilities and estimated cost so the orchestrator can choose the cheapest sufficient operation.

| Interface | Examples of capability |
| --- | --- |
| CompanySearchProvider | Company/domain search by industry/location/size. |
| ContactDiscoveryProvider | Decision-maker/contact discovery. |
| CompanyEnrichmentProvider | Firmographic enrichment. |
| ContactEnrichmentProvider | Role/contact enrichment. |
| EmailVerificationProvider | Mailbox risk/deliverability verification. |
| IntentProvider | Third-party/public/first-party intent signals. |
| WebsiteIntelligenceProvider | Fetch permitted public website pages and extract business facts. |

# 59. Enrichment waterfall

## 59.1 Cost order

1. Existing ClientTurn/customer data
2. Pipedrive/imported CRM records
3. Customer/company public website and generic corporate addresses where appropriate
4. Official/public data whose use is permitted
5. Cheap company enrichment
6. High-cost contact enrichment only after fit gate
7. Email verification
8. Additional expensive enrichment only if score/intent justifies it

## 59.2 Free/low-cost checks

- Syntax normalization
- Domain normalization
- MX lookup
- Disposable-domain detection
- Existing lead/prospect/customer duplicate lookup
- Suppression lookup
- Company-domain match
- Generic corporate-address detection
- Known provider result cache

“Publicly available” is not treated as synonymous with “unrestricted marketing use”. Source terms, privacy rules and contactability policy remain separate checks.

# 60. Company and contact deduplication

## 60.1 Company keys

- Normalized primary domain
- Legal/company registration ID where available
- Normalized name + postcode/location
- Provider entity IDs

## 60.2 Contact keys

- Normalized email
- Normalized E.164 phone
- Provider person IDs
- Name + company + role heuristic only for review, not silent destructive merge

## 60.3 Merge policy

Prefer field-level provenance rather than overwriting. Conflicting high-confidence identities go to REVIEW. Existing customer/lead records always take precedence over creating a new cold prospect.

# 61. Data provenance

## 61.1 Mandatory provenance fields

| Field | Purpose |
| --- | --- |
| provider | Adapter/provider responsible. |
| source_type | Website, registry, licensed provider, CRM, import, etc. |
| source_url / provider_entity_id | Traceability where available. |
| obtained_at | When data entered ClientTurn. |
| field_name / value | Field-level evidence. |
| confidence | Operational confidence. |
| verified_at | Verification time. |
| cost | Attributed provider cost. |
| policy_tags | Allowed/review/restricted data-use metadata. |

# 62. Intent engine

## 62.1 Event model

| Field | Purpose |
| --- | --- |
| intent_category_id | Named user/platform category. |
| company_id / prospect_id | Matched entity. |
| signal_type | Tender, expansion, job post, website event, etc. |
| source | Provider/source family. |
| source_url | Evidence location where retained/permitted. |
| observed_at | When observed. |
| expires_at | When no longer influences scoring. |
| confidence | Classifier/source confidence. |
| evidence_summary | Short grounded description. |
| score_impact | Versioned deterministic contribution. |

## 62.2 Monitoring

Recurring monitors are scheduled, plan-limited and budgeted. Duplicate signals are collapsed; stale signals automatically stop contributing to current score.

# PART VIII — Unified Communication Architecture

# 63. Channel model

| Channel | Use | Provider architecture |
| --- | --- | --- |
| EMAIL | Cold eligible B2B and warm lead communication. | Customer mailbox via Gmail API / Microsoft Graph; generic IMAP+SMTP fallback; optional dedicated cold infrastructure adapter later. |
| SMS | Warm/permissioned lead and operational communication. | Twilio/provider adapter. |
| WHATSAPP | Warm/permissioned lead where templates/provider policy allow. | Twilio WhatsApp/provider adapter. |
| SOCIAL | Manual/API-gated outreach and replies. | Official platform APIs only; no uncontrolled browser automation. |

# 64. Unified conversation model

Prospects and Leads share a conversation abstraction. Promotion preserves the same conversation_id so historical cold email and later warm SMS/WhatsApp are visible in one thread.

```text
conversation
  ├─ email outbound
  ├─ email reply
  ├─ promote prospect → lead
  ├─ SMS qualification question
  ├─ WhatsApp reply
  └─ booking link
```

# 65. Email architecture

## 65.1 Platform vs customer email

| Email family | Recommended transport |
| --- | --- |
| Platform authentication/security/billing notifications | Resend or equivalent transactional provider. |
| Customer warm email | Customer connected mailbox. |
| Eligible cold B2B email | Customer connected mailbox or dedicated permitted outbound adapter. |
| Support mailbox | ClientTurn-owned Gmail/Microsoft mailbox via API, or IMAP+SMTP fallback. |

Resend remains platform transactional infrastructure; cold outreach must use a provider/mailbox architecture whose policy permits the use case.

## 65.2 Generic mailbox fallback

IMAP receives/synchronizes inbound mail. SMTP sends outbound mail. POP is not used as the main synchronization protocol because it is unsuitable for a continuously threaded multi-device support/outreach system.

# 66. Sender identities and branded email

## 66.1 Sender identity fields

- Display name
- Email address
- Reply-to
- Business signature
- Business postal/contact footer fields where policy requires
- Brand logo optional for warm HTML emails
- Plain-text preference for cold sequence
- Mailbox connection
- Domain

## 66.2 DNS / health

- SPF visibility
- DKIM visibility
- DMARC visibility
- Mailbox connection health
- Bounce rate
- Complaint rate where provider supplies it
- Daily sent count
- Provider throttling
- Domain pause state

ClientTurn automatically pauses or reduces risky cold sending based on configured health thresholds; the user cannot override a platform hard safety limit.

# 67. Channel Policy Service

```text
ChannelPolicyService.canSend({
  business,
  contact,
  channel,
  relationship,
  country,
  campaignType,
  sender,
  now
})
```

## 67.1 Possible results

- ALLOWED
- BLOCKED_OPT_OUT
- BLOCKED_NO_PERMISSION
- BLOCKED_COLD_CHANNEL
- BLOCKED_SUBSCRIBER_TYPE
- BLOCKED_COUNTRY_POLICY
- BLOCKED_PROVIDER
- BLOCKED_DAILY_LIMIT
- BLOCKED_MONTHLY_LIMIT
- BLOCKED_COST_BUDGET
- BLOCKED_QUIET_HOURS
- BLOCKED_INVALID_CONTACT
- BLOCKED_DOMAIN_HEALTH
- BLOCKED_BUSINESS_STATE
- REVIEW_REQUIRED

# 68. Contactability and subscriber classification

## 68.1 Fields

- subscriber_type: CORPORATE / SOLE_TRADER / PARTNERSHIP / INDIVIDUAL / UNKNOWN
- relationship_type
- consent_status
- consent_evidence
- lawful/policy basis tag
- outreach_eligibility: ELIGIBLE / CONSENT_REQUIRED / REVIEW / SUPPRESSED
- country/policy pack
- last_evaluated_at
- policy_version

This document defines the software architecture, not legal advice. UK and US production policy packs, platform/provider terms and privacy-notice handling must be reviewed by qualified counsel before broad automated outreach.

# 69. Global suppression

## 69.1 Scope

Suppression is checked before every send, regardless of Lead/Prospect/campaign source.

| Field | Purpose |
| --- | --- |
| business_id | Tenant-specific suppression; optional platform/global scope via separate policy table. |
| email / phone / social identifier | Normalized destination. |
| channel | EMAIL / SMS / WHATSAPP / SOCIAL / ALL. |
| reason | OPT_OUT / COMPLAINT / INVALID / BOUNCE / LEGAL / MANUAL / PROVIDER. |
| source | Message, import, support action, provider webhook, admin. |
| created_at | Enforcement timestamp. |
| expires_at | Normally null for opt-out unless valid policy says otherwise. |

# 70. Social outreach

## 70.1 Initial scope

Social is initially a manual/API-gated channel. ClientTurn may provide the profile link, suggested message and “Mark contacted” workflow. Automatic sending requires an official platform API, authorized customer account and allowed use case.

## 70.2 Components

- SocialContactTask
- OpenProfileAction
- SuggestedMessage
- CopyMessageAction
- MarkContactedAction
- SocialReplyCapture if API permits

# 71. Communication allocation and limits

## 71.1 Plan allowance model

Each subscription has a hidden internal communication cost pool and customer-facing allocation. Sliders distribute the pool among Email, SMS and WhatsApp. The UI shows estimated send counts based on current price-book costs and safety caps.

## 71.2 Enforcement order

1. Check suppression/contactability
2. Check plan entitlement
3. Check customer allocation
4. Check campaign daily/monthly cap
5. Check sender/mailbox/domain/provider health
6. Check quiet hours
7. Check customer overage permission/cap
8. Reserve usage
9. Send idempotently
10. Reconcile actual provider usage/cost

# PART IX — Conversion Goals & Promotion

# 72. Conversion Goal system

## 72.1 Canonical goal types

- BOOK_APPOINTMENT
- BOOK_SITE_VISIT
- BOOK_DEMO
- REQUEST_QUOTE
- PHONE_CALL
- DIRECT_SIGNUP
- DIRECT_PURCHASE
- HUMAN_HANDOVER
- CUSTOM

## 72.2 Conversion goal fields

| Field | Purpose |
| --- | --- |
| type | Canonical conversion type. |
| name | User-facing goal name. |
| service_scope | All/selected services/products. |
| destination_type | Calendly, Google Calendar, URL, webhook, call, team handover. |
| destination_value | Validated URL/provider config. |
| success_event | Event that marks conversion. |
| qualification_required | Whether qualification precedes goal. |
| active | Availability. |

# 73. Prospect → Lead promotion

## 73.1 Triggers

- Meaningful positive/neutral reply
- Manual Promote to Lead
- Inbound booking/demo/signup event tied to prospect
- Supported social response
- Qualified handoff signal

## 73.2 Promotion transaction

1. Lock prospect and conversation.
2. Re-check existing lead by email/phone/company/contact.
3. Merge into existing lead when safe or create new Lead.
4. Set lead source CLIENTTURN_SOURCING with sourcing/campaign references.
5. Retain conversation_id and provenance.
6. Stop cold outreach run.
7. Apply warm contactability/channel policy.
8. Start normal qualification/follow-up only when appropriate.
9. Write promotion activity/audit event.

# 74. Multi-conversion product profiles

## 74.1 Service-trade example

```text
Prospect/Lead → location/problem qualification → BOOK_SITE_VISIT → WON
```

## 74.2 SaaS example

```text
Prospect/Lead → company/use-case qualification → BOOK_DEMO or DIRECT_SIGNUP → WON/ACTIVE CUSTOMER
```

## 74.3 Direct sale

```text
Prospect/Lead → qualification → DIRECT_PURCHASE link/event → WON
```

# PART X — Canonical Data Architecture

# 75. Tenant principle

Every customer-owned table carries business_id unless the object is globally platform-owned. RLS membership predicates remain mandatory. Service-role access is reserved for verified webhooks, workers and platform administration.

# 76. New table families

| Family | Tables |
| --- | --- |
| Manual intake | lead_imports, lead_import_rows, lead_import_mappings, lead_source_evidence |
| Business intelligence | business_profiles, business_memory_facts, business_knowledge_sources, business_learning_events, business_playbooks |
| ICP & conversion | icp_profiles, icp_segments, conversion_goals |
| Search | search_sessions, search_messages, search_strategies, search_strategy_versions, search_feedback |
| Sourcing | sourcing_runs, sourcing_run_queries, sourcing_run_results, sourcing_run_issues |
| Prospects | prospect_companies, prospects, prospect_data_sources, prospect_enrichments, prospect_verifications, prospect_scores, prospect_score_factors |
| Intent | intent_categories, intent_monitors, intent_events, prospect_intent_matches |
| Outreach | outreach_campaigns, outreach_campaign_versions, outreach_sequences, outreach_steps, outreach_runs, outreach_recipient_runs |
| Communication | conversations, messages, mailbox_connections, sender_identities, domain_health_snapshots, mailbox_health_snapshots |
| Compliance | contact_permissions, contactability_results, suppression_entries, compliance_decisions, privacy_notice_events |
| Optimization | campaign_experiments, campaign_variants, campaign_learnings, optimization_actions |
| AI | agent_runs, agent_tool_calls, agent_budgets, prompt_versions, ai_cost_events |
| Support | support_tickets, support_messages, support_notes, support_assignments |
| Affiliates | affiliates, affiliate_links, affiliate_clicks, affiliate_attributions, affiliate_referrals, affiliate_commissions, affiliate_payouts, affiliate_resources, affiliate_campaigns, affiliate_promo_codes |
| MCP & integrations | mcp_clients, mcp_scopes, mcp_audit_logs, external_connections, external_entity_links, sync_runs, sync_conflicts |
| Usage/economics | usage_events, cost_events, provider_price_book, business_cost_daily, business_margin_monthly, plan_entitlements, customer_usage_allocations |

## 76.1 `business_profiles`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant FK unique |
| website_url | text | Canonical site |
| business_type | text | Structured classification |
| sales_model | text | Service/SaaS/etc. |
| summary | text | Approved business summary |
| profile_version | int | Incrementing |
| analysis_status | text | State |
| last_analysed_at | timestamptz | Freshness |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

## 76.2 `business_memory_facts`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| fact_key | text | Semantic key |
| value_json | jsonb | Structured value |
| source_type | text | USER/WEBSITE/INTEGRATION/PERFORMANCE/AI |
| source_id | uuid/text | Evidence ref |
| confidence | numeric | Operational confidence |
| verified_by_user | bool | User confirmed |
| locked | bool | Protected from auto update |
| valid_from | timestamptz | Optional |
| valid_to | timestamptz | Optional |
| last_verified_at | timestamptz | Freshness |
| created_at | timestamptz | Audit |

## 76.3 `icp_profiles`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| name | text | User name |
| description | text | Meaning |
| industries | jsonb | Structured values |
| company_filters | jsonb | Size/type/etc. |
| locations | jsonb | Geo criteria |
| roles | jsonb | Decision roles |
| exclusions | jsonb | Negative criteria |
| default_intent_category_ids | uuid[] | Intent defaults |
| active | bool | State |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

## 76.4 `conversion_goals`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| name | text | Display |
| type | text | Canonical type |
| service_scope | jsonb | All/selected |
| destination_type | text | Calendar/url/webhook/etc. |
| destination_config | jsonb | Encrypted/reference-safe config |
| success_event | text | Canonical event |
| qualification_required | bool | Rule |
| active | bool | State |
| created_at | timestamptz | Audit |

## 76.5 `search_sessions`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| user_id | uuid | Owner/creator |
| title | text | Generated/editable title |
| icp_profile_id | uuid | Optional |
| status | text | ACTIVE/ARCHIVED |
| latest_strategy_version_id | uuid | Pointer |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

## 76.6 `search_messages`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| session_id | uuid | FK |
| role | text | USER/ASSISTANT/SYSTEM_EVENT |
| content | text | Conversation content |
| structured_data | jsonb | Optional plan change |
| agent_run_id | uuid | Traceability |
| created_at | timestamptz | Audit |

## 76.7 `search_strategies`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| session_id | uuid | FK |
| version | int | Version |
| strategy_json | jsonb | Validated structured plan |
| estimated_cost_minor | bigint | Internal estimate |
| estimated_provider_calls | jsonb | Plan |
| status | text | DRAFT/APPROVED/ARCHIVED |
| approved_by | uuid | User |
| approved_at | timestamptz | Time |
| created_at | timestamptz | Audit |

## 76.8 `sourcing_runs`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| search_strategy_id | uuid | Plan |
| campaign_id | uuid | Optional campaign |
| status | text | State |
| target_verified | int | Target |
| max_total_cost_minor | bigint | Budget |
| spent_cost_minor | bigint | Accumulated |
| budget_state | text | Within/near/limit |
| current_stage | text | Process stage |
| counts_json | jsonb | Progress counters |
| started_at | timestamptz | Run start |
| completed_at | timestamptz | Run end |
| created_at | timestamptz | Audit |

## 76.9 `prospect_companies`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| name | text | Company |
| domain | citext | Normalized domain |
| website_url | text | URL |
| industry | text | Classification |
| company_size | text/int | If known |
| location_json | jsonb | Location |
| external_ids | jsonb | Provider IDs |
| dedupe_key | text | Unique-ish key |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

## 76.10 `prospects`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| company_id | uuid | Company FK |
| first_name | text | Contact |
| last_name | text | Contact |
| role_title | text | Role |
| role_classification | text | Authority class |
| email | citext | Contact |
| phone_e164 | text | Optional |
| status | text | Prospect lifecycle |
| grade | text | A+/A/B/C/D |
| score | numeric | Canonical score |
| verification_status | text | Email/contact verification |
| subscriber_type | text | Policy classification |
| outreach_eligibility | text | ELIGIBLE/etc. |
| conversation_id | uuid | Cross-channel history |
| promoted_to_lead_id | uuid | Nullable |
| source_run_id | uuid | Origin |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

## 76.11 `prospect_data_sources`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| prospect_id | uuid | FK |
| field_name | text | Field supported |
| value_json | jsonb | Observed value |
| provider | text | Source provider |
| source_type | text | Type |
| source_url | text | Optional |
| provider_entity_id | text | Optional |
| confidence | numeric | Confidence |
| obtained_at | timestamptz | Time |
| verified_at | timestamptz | Optional |
| cost_minor | bigint | Attributed cost |
| policy_tags | jsonb | Use restrictions |

## 76.12 `prospect_scores`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| prospect_id | uuid | FK |
| score_version | text | Scoring policy version |
| total_score | numeric | 0-100 |
| grade | text | A+/A/B/C/D |
| factor_json | jsonb | Factor totals |
| explanation | text | Grounded summary |
| agent_run_id | uuid | Evidence extractor |
| created_at | timestamptz | Time |

## 76.13 `intent_categories`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| name | text | Category |
| description | text | Meaning |
| signal_types | jsonb | Allowed sources/signals |
| keywords_entities | jsonb | Optional |
| freshness_days | int | Expiry |
| score_impact | numeric | Bounded |
| icp_scope | jsonb | Scope |
| active | bool | State |
| created_at | timestamptz | Audit |

## 76.14 `intent_monitors`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| intent_category_id | uuid | FK |
| monitor_type | text | ICP/NAMED_COMPANIES |
| target_json | jsonb | Targets |
| cadence | text | Schedule |
| next_run_at | timestamptz | Due |
| status | text | ACTIVE/PAUSED/etc. |
| monthly_budget_minor | bigint | Budget |
| created_at | timestamptz | Audit |

## 76.15 `intent_events`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| intent_category_id | uuid | FK |
| company_id | uuid | Nullable |
| prospect_id | uuid | Nullable |
| signal_type | text | Type |
| source | text | Provider |
| source_url | text | Evidence |
| observed_at | timestamptz | Time |
| expires_at | timestamptz | Freshness expiry |
| confidence | numeric | Confidence |
| evidence_summary | text | Grounded summary |
| score_impact | numeric | Applied impact |

## 76.16 `outreach_campaigns`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| name | text | Campaign |
| status | text | Lifecycle |
| conversion_goal_id | uuid | Goal |
| icp_profile_id | uuid | Audience |
| minimum_grade | text | Threshold |
| intent_filter_json | jsonb | Intent |
| auto_optimize | bool | Bounded optimization |
| priority | int | Scheduling |
| daily_contact_cap | int | Cap |
| monthly_contact_cap | int | Cap |
| max_cost_minor | bigint | Budget |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

## 76.17 `outreach_sequences`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| campaign_id | uuid | FK |
| version | int | Version |
| status | text | DRAFT/PUBLISHED/ARCHIVED |
| created_at | timestamptz | Audit |
| published_at | timestamptz | Time |

## 76.18 `outreach_steps`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| sequence_id | uuid | FK |
| position | int | Order |
| delay_seconds | bigint | Delay |
| channel | text | EMAIL initially cold |
| subject_template | text | Email subject |
| body_template | text | Body |
| enabled | bool | State |
| created_at | timestamptz | Audit |

## 76.19 `conversations`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| lead_id | uuid | Nullable |
| prospect_id | uuid | Nullable |
| status | text | OPEN/CLOSED/etc. |
| last_message_at | timestamptz | Ordering |
| created_at | timestamptz | Audit |

## 76.20 `messages`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| conversation_id | uuid | FK |
| lead_id | uuid | Nullable |
| prospect_id | uuid | Nullable |
| channel | text | EMAIL/SMS/WHATSAPP/SOCIAL |
| direction | text | INBOUND/OUTBOUND |
| provider | text | Adapter |
| provider_message_id | text | Idempotency/reconciliation |
| subject | text | Email optional |
| body | text | Content |
| delivery_state | text | State |
| scheduled_at | timestamptz | Optional |
| sent_at | timestamptz | Optional |
| delivered_at | timestamptz | Optional |
| failed_at | timestamptz | Optional |
| reply_to_message_id | uuid | Thread |
| created_at | timestamptz | Audit |

## 76.21 `mailbox_connections`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| provider | text | GOOGLE/MICROSOFT/IMAP_SMTP |
| account_email | citext | Mailbox |
| secret_ref | text | Vault/key reference; no raw secret |
| status | text | Connection state |
| sync_cursor | text | Provider cursor |
| last_sync_at | timestamptz | Health |
| created_at | timestamptz | Audit |

## 76.22 `sender_identities`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| mailbox_connection_id | uuid | Mailbox |
| display_name | text | Brand |
| email | citext | Sender |
| reply_to | citext | Optional |
| signature_text | text | Signature |
| postal_footer | text | Policy data |
| cold_enabled | bool | Only if eligible |
| warm_enabled | bool | State |
| active | bool | State |

## 76.23 `contactability_results`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| subject_type | text | LEAD/PROSPECT |
| subject_id | uuid | Entity |
| channel | text | Channel |
| country | text | Policy country |
| subscriber_type | text | Classification |
| relationship_type | text | Relationship |
| result | text | ALLOWED/BLOCKED/REVIEW |
| reason_code | text | Machine code |
| policy_version | text | Version |
| evidence_json | jsonb | Inputs |
| evaluated_at | timestamptz | Time |

## 76.24 `suppression_entries`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| email | citext | Nullable |
| phone_e164 | text | Nullable |
| social_identifier | text | Nullable |
| channel | text | EMAIL/SMS/WHATSAPP/SOCIAL/ALL |
| reason | text | Reason |
| source | text | Origin |
| created_at | timestamptz | Enforced |
| expires_at | timestamptz | Usually null |

## 76.25 `agent_runs`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| agent_type | text | Profile |
| subject_type | text | Context entity |
| subject_id | uuid | Nullable |
| deployment | text | Azure deployment |
| prompt_key | text | Prompt |
| prompt_version | text | Version |
| input_tokens | bigint | Usage |
| cached_tokens | bigint | Usage |
| output_tokens | bigint | Usage |
| provider_cost_minor | bigint | Triggered cost |
| budget_before_minor | bigint | Budget |
| budget_after_minor | bigint | Budget |
| confidence | numeric | Optional |
| status | text | Result |
| result_json | jsonb | Validated output |
| created_at | timestamptz | Audit |

## 76.26 `support_tickets`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Customer |
| created_by_user_id | uuid | Nullable for email |
| category | text | Type |
| subject | text | Title |
| status | text | OPEN/WAITING/RESOLVED |
| priority | text | Priority |
| assigned_admin_id | uuid | Nullable |
| email_thread_key | text | Inbound thread linkage |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

## 76.27 `affiliates`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | Affiliate account |
| status | text | APPLIED/ACTIVE/SUSPENDED |
| commission_plan_id | uuid | Plan |
| payment_profile_json | jsonb | Sensitive; access restricted |
| approved_at | timestamptz | Time |
| created_at | timestamptz | Audit |

## 76.28 `affiliate_referrals`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| affiliate_id | uuid | Affiliate |
| business_id | uuid | Referred tenant |
| attribution_id | uuid | Source |
| signup_at | timestamptz | Lifecycle |
| trial_at | timestamptz | Lifecycle |
| paid_at | timestamptz | Lifecycle |
| plan_key | text | Plan |
| status | text | Lifecycle |

## 76.29 `mcp_clients`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| name | text | Client integration |
| oauth_client_id | text | Identifier |
| status | text | Active/revoked |
| created_by | uuid | Owner |
| created_at | timestamptz | Audit |

## 76.30 `provider_price_book`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| provider | text | Provider |
| product | text | SKU/capability |
| region | text | Region |
| currency | text | ISO |
| unit | text | Per token/send/lookup/etc. |
| unit_cost_minor | numeric | Cost |
| effective_from | timestamptz | Start |
| effective_to | timestamptz | End |
| metadata | jsonb | Details |

## 76.31 `customer_usage_allocations`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | PK |
| business_id | uuid | Tenant |
| billing_period | date | Month/period |
| email_percent | numeric | 0-100 |
| sms_percent | numeric | 0-100 |
| whatsapp_percent | numeric | 0-100 |
| overage_enabled | bool | Default false |
| overage_cap_minor | bigint | Customer cap |
| daily_caps_json | jsonb | User lower caps |
| updated_at | timestamptz | Audit |

# 77. Key indexes and constraints

- prospect_companies unique/business-aware normalized domain index where domain is present.
- prospects indexes on business_id + status, grade, score, campaign/outreach state, email and company_id.
- messages indexes on business_id + conversation_id + created_at and provider_message_id unique per provider scope.
- sourcing_runs indexes on business_id + status + created_at and current_stage.
- intent_events indexes on business_id + category + observed_at, company_id and prospect_id.
- outreach_campaigns indexes on business_id + status + priority.
- suppression_entries normalized destination indexes; enforce efficient lookup before every send.
- agent_runs indexes on business_id + agent_type + created_at and subject_type/subject_id.
- support_tickets indexes on status + priority + updated_at and business_id.
- usage/cost tables partition or roll up when volume justifies it.
- All external provider IDs used for webhook/event idempotency receive appropriate unique constraints.

# PART XI — Background Execution, Supabase Cron & Queues

# 78. 24/7 execution model

ClientTurn runs continuously through scheduled dispatchers and durable queues. Cron schedules checks/dispatch; it does not perform long provider/AI work synchronously.

```text
Supabase Cron / pg_cron
        ↓
dispatch due work
        ↓
Supabase Queue / pgmq style durable queue
        ↓
worker / Edge Function / backend worker
        ↓
provider call / AI / send
        ↓
event + usage + cost ledger
        ↓
next job / result
```

# 79. Queue families

- sourcing_jobs
- enrichment_jobs
- verification_jobs
- intent_jobs
- scoring_jobs
- outreach_jobs
- message_jobs
- reply_jobs
- optimization_jobs
- sync_jobs
- support_jobs
- analytics_rollup_jobs

# 80. Job envelope

```text
{
  "job_id": "uuid",
  "business_id": "uuid",
  "job_type": "...",
  "subject_type": "...",
  "subject_id": "uuid",
  "attempt": 1,
  "scheduled_at": "...",
  "idempotency_key": "...",
  "budget_context_id": "...",
  "trace_id": "..."
}
```

# 81. Cron schedule families

| Schedule | Purpose |
| --- | --- |
| Every minute | Dispatch due messages/outreach and short retry queues. |
| Every 5 minutes | Integration health checks where provider rate allows; stuck-job reconciliation. |
| Hourly | Usage/cost anomaly rollups; campaign optimization eligibility. |
| Daily | Intent monitors, business/profile freshness checks, mailbox/domain health snapshots, daily analytics rollup. |
| Weekly | Recurring sourcing runs configured weekly; affiliate reports; long-horizon learning jobs. |
| Monthly/billing period | Usage reconciliation, margin snapshots, entitlement resets and affiliate commission accrual. |

All actual schedules are configuration-driven; avoid one cron job per customer where a batched dispatcher can efficiently find due records.

# 82. Job safety

- Atomic claim/lease semantics
- Stable idempotency keys
- Max attempts and exponential backoff
- Dead-letter state
- Reconciliation before retrying externally-visible sends
- Budget reservation before expensive calls
- Budget release/reconcile after actual provider result
- Cancellation checks before each step
- Tenant and policy revalidation at execution time

# PART XII — Integrations & MCP

# 83. Google Workspace

## 83.1 Use

- OAuth mailbox connection
- Send warm/eligible cold email
- Read replies
- Thread mapping
- Mailbox history/sync cursor
- Support mailbox if ClientTurn uses Google Workspace

## 83.2 Security

Use minimum OAuth scopes required by the actual feature set, encrypt/secret-store refresh credentials, record connection ownership and revoke cleanly.

# 84. Microsoft 365

- OAuth through Microsoft identity
- Microsoft Graph send/read/thread/change notifications where supported
- Same sender identity, policy and usage layers as Google
- Provider-specific data stays behind EmailProvider interface

# 85. Generic IMAP + SMTP

Fallback for custom mailboxes when OAuth APIs are unavailable. IMAP handles inbound synchronization; SMTP handles sending. Store credentials in a secret vault/reference, never tenant-readable database plaintext. POP is not a primary ClientTurn mode.

# 86. Twilio

- SMS warm/permissioned sends
- WhatsApp where enabled
- Inbound webhook verification
- Delivery receipts
- Opt-out/suppression hooks
- Cost usage events
- Provider health

# 87. Pipedrive

## 87.1 Connection

Use normal OAuth/API integration for data synchronization. MCP is not the core CRM sync mechanism.

## 87.2 Sync options

- Import people
- Import organisations
- Import leads
- Import deals where mapped
- Push ClientTurn qualified leads
- Push conversion/booking events
- Push won/lost where configured

## 87.3 Data model

- external_connections
- external_entity_links
- sync_runs
- sync_conflicts

# 88. ClientTurn MCP Server

## 88.1 Goal

Expose ClientTurn as a scoped tool server usable by MCP-compatible assistants such as Claude/OpenAI/Gemini ecosystems without giving those assistants direct database access.

## 88.2 Authentication

- OAuth 2.1/OIDC-style user authorization appropriate to the implementation
- Tenant scopes
- Per-tool permissions
- Short-lived access tokens
- Revocation
- Audit all tool calls

## 88.3 Read tools

- search_leads
- get_lead
- search_prospects
- get_prospect
- get_business_profile
- list_campaigns
- get_campaign
- get_dashboard_metrics
- get_analytics
- get_status

## 88.4 Write tools

- create_lead
- update_lead
- start_sourcing_run
- approve_prospect
- pause_campaign
- resume_campaign
- assign_lead
- mark_qualified
- mark_won
- mark_lost

## 88.5 Approval-gated tools

- send_message
- launch_campaign
- increase_budget
- bulk_approve
- change_overage_cap

The MCP adapter calls normal domain services. It cannot bypass RLS/policy/budget/confirmation logic.

# 89. Meta / Website / Booking integrations

Existing V3 Meta Lead Ads, Calendly and Google Calendar architecture remains. Add source provenance and conversion-goal mapping so acquisition analytics can compare inbound and sourced performance using one canonical event model.

# PART XIII — Security, Compliance & Governance

# 90. Security boundaries

- Provider secrets server-only and vault-backed.
- RLS on every tenant table.
- Service role only in verified server/webhook/worker paths.
- Agent tools scoped by business and user role.
- MCP scopes cannot exceed the authorizing user/business permissions.
- Support staff access is audited.
- Affiliate data separated from customer data.
- Raw provider costs admin-only.

# 91. CompliancePolicyEngine

## 91.1 Inputs

- Country/region
- Recipient/subscriber type
- Channel
- Relationship type
- Campaign type
- Consent/evidence
- Suppression
- Provider/platform policy
- Business category restrictions
- Policy version

## 91.2 Output

- ALLOW
- BLOCK
- REVIEW
- REQUIRE_CONSENT
- REQUIRE_PRIVACY_NOTICE
- REQUIRE_TEMPLATE
- REQUIRE_MANUAL_ACTION

## 91.3 Versioning

Every decision stores policy_version and evidence snapshot so later audits can reconstruct why a send was permitted or blocked.

# 92. UK/US rollout guardrail

Initial rollout should focus on compliant business-to-business use cases and permissioned/warm leads, with country/channel/subscriber-specific policy packs. Consumer/homeowner cold automation should remain disabled until policy, data sourcing, consent and provider terms are explicitly validated. This is an engineering/product guardrail, not legal advice.

# 93. Privacy and data retention

- Minimize stored sourced personal data.
- Retain provenance and suppression even when marketing data is deleted where necessary for enforcement/legal obligations.
- Support data subject deletion/access workflows.
- Define prospect retention windows for never-contacted/unengaged records.
- Do not retain raw model prompts containing unnecessary personal data indefinitely.
- Support provider/source deletion propagation where required.

# 94. Prompt injection / untrusted content

Web pages, prospect data, emails and social messages are untrusted content. Agents must treat external text as data, not instructions. Tool permissions and policy are enforced outside model prompts.

# 95. Audit

- Manual lead creation/import
- Prospect approval/suppression
- Campaign launch/pause/budget changes
- Message sends
- Agent high-impact actions
- MCP writes
- Admin support/customer access
- Billing/entitlement changes
- Affiliate commission adjustments
- Compliance overrides/reviews

# PART XIV — Commercial Model, Usage & Profitability

# 96. Pricing principle

Plans sell useful capacity, not raw tokens. Sourcing allowance and communication allowance are separate because data/enrichment cost behaves differently from messaging cost. All included quantities remain feature-configurable so provider-cost changes do not require code changes.

# 97. Provisional plan architecture

The following is a commercial architecture baseline, not a promise that must be published unchanged. Final verified-prospect allowances must be confirmed against selected data-provider COGS before launch.

| Feature | Starter | Growth | Pro |
| --- | --- | --- | --- |
| Monthly price | £99 | £199 | £399 |
| Verified sourced prospects / month (provisional) | 100 | 500 | 2,000 |
| Active saved/recurring search capacity | 2 | 10 | Higher / policy-bounded |
| Intent monitors | 2 | 15 | 50 |
| Users | 1 | 3 | 10 |
| Find Leads | Core | Full | Autopilot + higher limits |
| AI business/ICP learning | Included | Included | Included + advanced optimization |
| Cold eligible email | 1 connected sender | Multiple senders subject to policy | Higher sender/campaign limits |
| Warm SMS/WhatsApp/Email | Included allowance | Higher allowance | Highest allowance |
| Auto Optimize | Recommendations | Bounded optional | Bounded advanced |
| Analytics | Core overview | Full | Full + deeper cohorts |
| Priority support | Standard | Enhanced | Priority |

# 98. Internal COGS budgets

Each plan has adjustable internal COGS ceilings. Exact values are admin configuration, but plan design should target strong contribution margins rather than “unlimited” provider usage.

| Budget family | Starter design principle | Growth | Pro |
| --- | --- | --- | --- |
| Prospect sourcing/enrichment | Small capped pool | Larger capped pool | Largest pool, still finite |
| Communication | Finite cost pool allocated by sliders | Higher | Higher |
| AI | Small internal budget; Nano-first | Higher | Higher |
| Shared infra | Allocated monthly | Allocated | Allocated |
| Overage | OFF by default | OFF by default | OFF by default |

## 98.1 Margin guardrails

| Contribution margin | Internal state |
| --- | --- |
| ≥75% | Healthy target |
| 65–74.9% | Watch / investigate mix |
| 55–64.9% | Warning / recommend plan or limits |
| <55% | Critical economics alert; admin investigation |

Do not automatically degrade a customer solely because a calculated margin percentage fell; enforce the entitlements and cost limits they agreed to, then alert admin and correct plan/provider economics.

# 99. Provider price book

All variable costs are effective-dated. Model/provider code never contains a permanent hardcoded price.

- Azure model tokens
- Prospect search lookup
- Company/contact enrichment
- Verification
- Twilio SMS
- WhatsApp provider/platform fees
- Email infrastructure where applicable
- Pipedrive/add-on provider costs if incurred
- Stripe/payment processing
- Shared infrastructure allocation

# 100. Usage ledger

## 100.1 Customer-facing metrics

- Verified prospects
- Search runs
- Intent monitors
- Emails sent
- SMS segments
- WhatsApp messages
- Social manual/API touches
- Warm leads sourced/promoted
- Active campaigns

## 100.2 Internal metrics

- Nano/Mini tokens
- Provider lookups
- Enrichment units
- Verification units
- Cost by provider
- Cost by agent
- Cost by campaign
- Cost by tenant

# 101. Communication allocation sliders

The user chooses percentages summing to 100%. Estimated sends update dynamically. Allocation does not override eligibility: a cold prospect still cannot use SMS simply because the customer allocated 50% to SMS.

## 101.1 Example UI behaviour

```text
Email      60%   ~ estimated sends based on live internal cost + safe mailbox caps
SMS        25%   ~ estimated segments
WhatsApp   15%   ~ estimated messages

Total     100%
```

## 101.2 User caps

- Daily email cap
- Daily SMS cap
- Daily WhatsApp cap
- Campaign daily cap
- Monthly additional usage cap

User caps can reduce but never increase above platform/provider/domain/plan hard maximums.

# 102. Acquisition cost efficiency

The orchestration layer measures cost per verified prospect, cost per reply, cost per promoted Lead and cost per conversion by provider/campaign/ICP. Optimization prefers lower-cost providers only when quality/reliability remains acceptable.

# PART XV — Analytics, Learning & Benchmarking

# 103. Learning feedback loop

```text
Prospect features + Intent + Message + Timing + Channel
                       ↓
                     Outcome
                       ↓
          analytics + minimum sample checks
                       ↓
              campaign learning
                       ↓
        recommendation / bounded optimization
                       ↓
                 future selection
```

# 104. Top performer benchmarking

## 104.1 Customer-local benchmark

Always available: compare a campaign against the customer’s own historical campaigns and baselines.

## 104.2 Cross-customer benchmark

Later only: anonymous/aggregated cohorts with minimum cohort sizes, no identifiable customer data and no cross-tenant prompt/context leakage.

## 104.3 Benchmark dimensions

- ICP
- Industry
- Company size
- Role
- Intent category
- Channel
- Sequence step
- Message variant
- Conversion goal

# 105. Experimentation

## 105.1 Controlled experiments

- Subject lines
- Opening message variants
- CTA variants
- Send times
- Follow-up spacing
- Role priority
- Intent threshold
- Grade threshold

## 105.2 Guardrails

- Minimum sample size
- No changing multiple variables without experiment tracking
- No winner promotion on tiny sample
- Cost and complaint/bounce guardrails
- Customer Auto Optimize permission

# PART XVI — Events, APIs & Domain Services

# 106. New event catalog

## 106.Manual intake

- lead.manual_created
- lead.import_started
- lead.import_completed
- lead.import_row_review

## 106.Search/Sourcing

- search.session_created
- search.strategy_approved
- sourcing.run_started
- sourcing.stage_completed
- sourcing.run_paused
- sourcing.run_completed
- sourcing.budget_exhausted

## 106.Prospect

- prospect.discovered
- prospect.enriched
- prospect.verified
- prospect.scored
- prospect.approved
- prospect.suppressed
- prospect.promoted

## 106.Intent

- intent.monitor_created
- intent.event_detected
- intent.event_expired

## 106.Outreach

- campaign.created
- campaign.launched
- campaign.paused
- campaign.optimized
- outreach.step_due
- outreach.sent
- outreach.stopped

## 106.Email

- mailbox.connected
- mailbox.degraded
- email.sent
- email.delivered
- email.bounced
- email.replied
- email.complaint

## 106.Conversion

- conversion.goal_reached
- lead.promoted_from_prospect

## 106.AI

- agent.run_started
- agent.run_completed
- agent.run_failed
- agent.budget_blocked

## 106.Support

- support.ticket_created
- support.reply_received
- support.reply_sent
- support.ticket_resolved

## 106.Affiliate

- affiliate.applied
- affiliate.approved
- affiliate.click
- affiliate.referral_paid
- affiliate.commission_created
- affiliate.payout_completed

## 106.MCP

- mcp.client_authorized
- mcp.tool_called
- mcp.tool_approved
- mcp.client_revoked

# 107. Domain service boundaries

| Service | Responsibility |
| --- | --- |
| ManualLeadService | Manual wizard validation, duplicate/contactability and lead creation. |
| ImportService | File parsing, mapping, validation, classification and import. |
| BusinessProfileService | Business facts, knowledge sources, memory and profile versioning. |
| SearchPlanningService | Search sessions and structured plans. |
| SourcingOrchestrator | Provider waterfall, run state, budgets. |
| ProspectService | Prospect lifecycle, dedupe, detail and approval. |
| IntentService | Categories, monitors, events and scoring contribution. |
| ScoringService | Deterministic score calculation from extracted features. |
| CampaignService | Acquisition campaign lifecycle and versions. |
| OutreachScheduler | Due recipients/steps and safe execution. |
| ChannelPolicyService | Can-send decision. |
| EmailService | Mailbox/provider abstraction, threading, health. |
| LeadPromotionService | Prospect → Lead transactional promotion. |
| ConversionGoalService | Goal routing and success event mapping. |
| AgentRuntime | Bounded AI execution. |
| OptimizationService | Experiment/learning/recommendation actions. |
| UsageService | Entitlements, allocations and reservations. |
| CostService | Provider price book and cost events. |
| SupportService | Ticket/email threading and admin support. |
| AffiliateService | Attribution, commission and payout lifecycle. |
| MCPGatewayService | OAuth scopes, tools, approvals and audit. |

# PART XVII — Build Order

| Phase | Scope |
| --- | --- |
| Phase 0 — V3 stabilization | Freeze existing shell, Leads, Follow-Up, Reactivation, billing and data contracts; add migration test harness. |
| Phase 1 — Manual Leads | Add Lead wizard, contactability, manual provenance, duplicate checks. |
| Phase 2 — Imports | CSV/XLSX mapping, validation, lead/prospect classification and safe import. |
| Phase 3 — Business Profile | Website analysis, business memory, ICP and conversion goals. |
| Phase 4 — Core Prospect Model | Prospect/company/provenance/dedupe/verification/score tables and Prospects UI. |
| Phase 5 — Search Sessions | Conversational search UI and structured strategy approval. |
| Phase 6 — Sourcing Orchestrator | Provider interfaces, waterfall, run budgets, live run UI. |
| Phase 7 — Intent | Categories, monitors, events, score integration. |
| Phase 8 — Email Mailboxes | Google/Microsoft integrations, IMAP+SMTP fallback, sender/domain health, unified conversation. |
| Phase 9 — Cold Campaigns | Campaign wizard, cold email sequence, scheduler, reply classification, prospect promotion. |
| Phase 10 — Warm Email | Add Email to Follow-Up channel selection and policy/fallback. |
| Phase 11 — Usage & Margins | Allocation sliders, provider price book, COGS ledgers, admin economics. |
| Phase 12 — Analytics | Overview/Acquisition/Outreach/Conversion with canonical metrics. |
| Phase 13 — Optimization | Experiments, learnings, bounded Auto Optimize. |
| Phase 14 — Status & Support | Customer status/support and admin support email integration. |
| Phase 15 — Pipedrive | OAuth sync, entity links and conflicts. |
| Phase 16 — MCP | Remote MCP gateway, tools, permissions, approvals and audit. |
| Phase 17 — Affiliates | Affiliate portal, resources, tracking, commissions, payouts and admin. |
| Phase 18 — Social assisted outreach | Manual/API-gated social tasks; automate only where official APIs and policy allow. |
| Phase 19 — Hardening | Load, security, RLS, provider failure, queue chaos, cost-abuse and compliance tests. |

# PART XVIII — QA & Acceptance

# 108. Functional acceptance scenarios

| Scenario | Acceptance result |
| --- | --- |
| Manual warm lead | User adds a referred lead, contactability permits email/SMS, lead enters normal Follow-Up and appears in Leads. |
| Manual cold person | User says “I found this company”; wizard routes to Prospect instead of silently creating a warm Lead. |
| Import mixed file | Rows are split across Lead, Prospect, Review and Skip with dedupe/suppression. |
| AI search | User describes ICP naturally; structured plan appears; no provider spend until approved. |
| Budgeted sourcing | Run stops gracefully when target or budget reached; progress/cost counters reconcile. |
| Prospect reply | Cold email reply stops cold sequence, promotes to Lead when appropriate and preserves conversation. |
| Intent | Fresh signal raises bounded score contribution and expires later. |
| Warm multichannel | Email/SMS/WhatsApp sequence executes only through ChannelPolicyService. |
| Opt-out | Suppression blocks every future channel/campaign path that policy says must be blocked. |
| Mailbox health | High bounce/connection issue pauses affected sends and surfaces status/admin alert. |
| Auto optimize | Only allowed bounded variables change; budgets and policy remain intact. |
| Support email | Incoming email opens/threads ticket and admin reply returns through same thread. |
| MCP action | External assistant can read scoped data; high-impact write requires approval and audit. |
| Affiliate | Click → signup → paid attribution produces commission and payout lifecycle. |

# 109. Security tests

- Cross-tenant prospect/search/campaign access denied
- Manual lead business_id spoof denied
- MCP token cannot access another business
- Support admin access audited
- Provider credentials not returned to browser
- CSV formula injection neutralized in exports/previews
- Prompt injection in websites/emails cannot invoke unauthorized tools
- Queue payload tampering cannot bypass business/policy lookup
- Webhook replay does not duplicate message/conversion/commission

# 110. Cost-abuse tests

- One tenant cannot launch infinite search runs
- One search cannot exceed provider/tool/token budget
- Mini model is not used on every low-fit candidate
- Automatic overage remains off without explicit setting
- Campaign cannot reserve more communication budget than available
- Retries do not double-charge/send
- Provider price changes flow through effective-dated price book
- Affiliate/self-referral abuse rules and duplicate attribution tested

# 111. Background failure tests

- Sourcing provider outage
- Enrichment provider outage with failover
- Verification provider outage
- Azure outage
- Gmail/Graph token expiry
- Twilio outage
- Queue worker crash after provider success before DB acknowledgement
- Cron missed interval
- Duplicate job delivery
- Dead-letter recovery
- Campaign paused while jobs already queued

# 112. UI acceptance

- New pages use approved ClientTurn app/admin shells.
- Find Leads remains understandable without data-industry terminology.
- No page exposes raw LLM tokens or provider unit costs to customers.
- Sourcing-run progress clearly shows work and issues.
- Prospect vs Lead is visually obvious.
- Analytics does not duplicate Dashboard.
- Status and Support remain hidden utilities, not sidebar bloat.
- Mobile/tablet have intentional layouts.
- All long-running operations have resume/partial/error states.

# PART XIX — Product Guardrails

# 113. Explicitly allowed expansion

- More licensed data providers behind existing provider interfaces
- Additional official intent sources
- Additional CRM integrations
- Additional conversion goal adapters
- Additional country policy packs
- Additional MCP read/write tools subject to permissions
- Additional affiliate campaign resource packs

# 114. Explicitly rejected early additions

- Generic CRM deal pipeline
- Unbounded workflow canvas
- Cold consumer SMS/WhatsApp/social blasting
- Browser-bot Instagram/Facebook spam
- Unlimited sourcing or messaging
- Raw provider/database configuration for normal customers
- Autonomous AI spend increases
- Customer-facing token economy
- Hidden AI memory the user cannot inspect
- Separate Email/AI/Intent sidebar modules
- Provider-specific architecture that cannot be swapped

# 115. Final canonical V4 definition

ClientTurn V4 is a focused acquisition and conversion platform with one clean customer experience: Dashboard shows operations; Leads handles active enquiries; Find Leads discovers and warms new opportunities; Follow-Up coordinates warm conversion; Reactivation recovers old value; Analytics explains the full journey; Settings controls the business, connections and usage. A bounded Learn layer continuously improves targeting and messaging from real outcomes without turning the product into a black-box autonomous agent.

# APPENDIX A — Final Customer Navigation & Sub-Views

```text
Dashboard

Leads
  - Card View
  - Table View
  - Lead Drawer: Summary / Conversation / Activity
  - Add Lead Wizard
  - Import Wizard

Find Leads
  - Discover
    - Saved Search Chats
    - Search Session
    - Sourcing Run
  - Prospects
    - Prospect Drawer: Summary / Research / Conversation / Activity
  - Intent
    - Category Builder
    - Named Company Monitors
  - Campaigns
    - Campaign Builder
    - Campaign Detail: Overview / Audience / Sequence / Performance / Activity

Follow-Up
  - Follow-Up
  - Qualification

Reactivation
  - Campaigns
  - New Campaign Wizard
  - Campaign Detail

Analytics
  - Overview
  - Acquisition
  - Outreach
  - Conversion

Settings
  - Workspace
  - Connections
  - Business Profile
  - Team
  - Billing & Usage

Hidden
  - Status
  - Support
```

# APPENDIX B — Final Admin Navigation

```text
Overview
Customers
Support
  - Inbox
  - Open
  - Waiting
  - Resolved
Affiliates
  - Overview
  - Affiliates
  - Referrals
  - Commissions
  - Payouts
  - Resources
  - Settings
System
  - Health
  - Events
  - Errors
  - Jobs
  - Compliance
Billing
  - Subscriptions
  - Invoices
  - Credits & Adjustments
  - Entitlements
Usage & Margins
  - Customers
  - Providers
  - Plans
  - Anomalies
Settings
  - Providers
  - AI & Agents
  - Outreach
  - Compliance
  - Price Book
  - Feature Flags
```

# APPENDIX C — Canonical Lifecycle Enums

| Domain | Canonical values |
| --- | --- |
| Lead | NEW, CONTACTED, RESPONDED, QUALIFIED, BOOKED, WON, LOST |
| Qualification | PENDING, QUALIFIED, NOT_QUALIFIED, REVIEW |
| Prospect | DISCOVERED, ENRICHING, VERIFIED, READY, APPROVED, OUTREACH_ACTIVE, REPLIED, CONVERTED, DISQUALIFIED, SUPPRESSED, BOUNCED, UNSUBSCRIBED |
| Sourcing Run | QUEUED, RUNNING, PAUSED, COMPLETED, PARTIAL, CANCELLED, FAILED |
| Acquisition Campaign | DRAFT, READY, ACTIVE, PAUSED, OPTIMIZING, COMPLETED, STOPPED |
| Outreach Recipient | PENDING, SCHEDULED, ACTIVE, REPLIED, STOPPED, BOUNCED, SUPPRESSED, COMPLETED |
| Mailbox | CONNECTED, DEGRADED, ACTION_REQUIRED, DISCONNECTED |
| Support Ticket | OPEN, WAITING_CUSTOMER, WAITING_INTERNAL, RESOLVED, CLOSED |
| Affiliate | APPLIED, ACTIVE, SUSPENDED, REJECTED |
| Commission | PENDING, APPROVED, REVERSED, PAYABLE, PAID |

# APPENDIX D — Build Quality Rule

Every page and backend feature in this Bible must be implemented with the same production bar as the approved ClientTurn shell and core V3 pages: explicit loading/empty/error/permission states, responsive behaviour, RLS tests, structured audit, idempotent external actions, provider fallback where appropriate, accurate usage/cost ledgers, no fake data, and browser-level visual QA before completion.
