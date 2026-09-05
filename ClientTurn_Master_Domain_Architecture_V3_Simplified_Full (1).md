# CLIENTTURN — Master Domain Architecture V3
**Build architecture • Web application • Next.js + Supabase • Deterministic automation • No AI / No ML**

**CLIENTTURN**

**Master Domain, Page, Sub-Tab, Component, Data, Backend, Integration, RLS, QA & Release Architecture**

**Simplified commercial V1 • UK home-service businesses • Full-depth build-ready specification**

This V3 keeps the simplified ClientTurn customer experience while documenting it with the same architecture discipline as the supplied Gigvora master architecture: canonical surface register first, followed by detailed domain/page integration, component naming, data ownership, backend/realtime contracts, security and QA. The user interface stays deliberately small even though the implementation is production-grade.

| Architecture decision | Canonical rule |
| --- | --- |
| Primary customer navigation | Dashboard, Leads, Follow-Up, Reactivation, Settings — exactly five primary customer destinations in V1. |
| Product value chain | Receive lead → respond → follow up → qualify → book/handover → report outcome. |
| Qualification | Deterministic questions, explicit rules and REVIEW fallback. No AI/ML or natural-language inference. |
| Bookings | Booking is a lead outcome surfaced on Dashboard and Lead Detail, not a standalone scheduling module. |
| Analytics | Operational/conversion reporting is embedded in Dashboard and Reactivation; no separate Analytics destination. |
| Integrations | Provider configuration lives in Settings → Connections; no separate Integrations destination. |
| Lead detail | Lead is the canonical operational object. Use one reusable Lead Detail drawer/sheet instead of profile/item route sprawl. |
| Editing | Inline for low-risk fields; drawers/dialogs for bounded config; wizards only for multi-step setup/launch. |
| Backend | Next.js server application + Supabase + durable background worker. Provider secrets remain server-side. |
| Realtime | Selective Supabase Realtime for leads/messages/attention/booking/health; reporting usually refetches aggregates. |
| Mobile | Responsive web is first-class and purpose-authored. Tables become cards/sheets where needed. |
| Platform admin | Admin Overview, Customers, System only; System contains Health, Events, Errors. |
| AI / ML | Explicitly excluded from product, backend decisions and qualification logic. |

# 0. Architecture Rules & Product Shape
## 0.1 Product definition
ClientTurn is a narrow lead-to-booking SaaS for UK home-service businesses that already receive enquiries, initially through Meta Lead Ads. It does not generate leads and must not become a full CRM, general marketing suite, project-management product, quote/invoice system or arbitrary workflow builder.

```text
META / CONNECTED LEAD
        ↓
NEW LEAD RECORD
        ↓
FIRST RESPONSE
        ↓
FOLLOW-UP UNTIL A STOP CONDITION
        ↓
DETERMINISTIC QUALIFICATION
        ↓
QUALIFIED / REVIEW / NOT QUALIFIED
        ↓
BOOKING LINK OR HUMAN HANDOVER
        ↓
BOOKED / WON / LOST
        ↓
SOURCE + OUTCOME REPORTING
```

## 0.2 Simplified customer experience rule
> **Dashboard tells me what is happening. Leads is where I work. Follow-Up controls what ClientTurn does. Reactivation works older leads. Settings configures the workspace.**

- No standalone Qualification module: Qualification is the second tab inside Follow-Up.
- No standalone Bookings module: booking status and booking data are embedded in Dashboard and Lead Detail.
- No standalone Analytics module: reporting is embedded where the decision is made.
- No standalone Integrations module: provider setup is Settings → Connections.
- No large Notification Centre: operational attention is surfaced in Top Bar, Dashboard and Leads.
- No customer/user/business public profile pages.
- No full CRM contacts/accounts/opportunities/pipeline.
- No workflow canvas, projects, tasks, documents, social content, quoting, invoicing or accounting.

## 0.3 Runtime topology
| Layer | Responsibility | Initial deployment |
| --- | --- | --- |
| Web | Next.js App Router, React, TypeScript, SSR/server components where useful. | Vercel |
| Server application | Server actions, route handlers, authorization, validation, integration orchestration. | Vercel |
| Auth | Sessions, verification and password recovery. | Supabase Auth |
| Database | Canonical tenant, lead, message, automation, campaign, integration and billing state. | Supabase PostgreSQL |
| RLS | Tenant and role isolation. | Supabase PostgreSQL |
| Realtime | Lead/message/status/attention/booking/health refresh where useful. | Supabase Realtime |
| Storage | Business logos and controlled CSV imports. | Supabase Storage |
| Background work | Scheduled follow-up, sends, campaign pacing, webhook work and health checks. | Durable managed or DB-backed worker |
| Lead source | Meta Lead Ads OAuth, forms and webhook ingestion. | Meta |
| Messaging | SMS and optional WhatsApp. | Twilio / Meta WhatsApp adapter |
| Booking | Existing booking destination. | Calendly first; limited Google Calendar optional |
| Billing | Subscriptions and customer portal. | Stripe |
| Transactional email | Welcome, invites, failure/support/billing notifications. | Resend |
| Product telemetry | Activation and usage telemetry. | PostHog |
| Error monitoring | Client/server/provider failures. | Sentry |

## 0.4 Roles
| Role | Purpose | Core authority |
| --- | --- | --- |
| Owner | Workspace owner. | Full workspace configuration, team and billing. |
| Admin | Operational administrator. | Leads + follow-up + connections + team within owner protections. |
| Member | Lead operator. | Work leads/conversations/statuses; no billing/provider configuration. |
| Platform Admin | ClientTurn operator. | Privileged support/system operations through server-only admin layer. |

## 0.5 Product surface budget
| Area | Canonical V1 shape |
| --- | --- |
| Public | Landing + Privacy + Terms + Cookies. |
| Authentication | Signup + Login + Forgot Password + Reset Password + verification state. |
| Onboarding | One route, five wizard steps. |
| Customer application | Five primary destinations. |
| Lead detail | One drawer/sheet with Summary, Conversation, Activity. |
| Follow-Up | One route with Follow-Up and Qualification tabs. |
| Reactivation | List + three-step wizard + one campaign drawer. |
| Settings | One route with Workspace, Connections, Team, Billing. |
| Admin | Overview + Customers + System; System has Health, Events, Errors. |

# PART I — Canonical Page & Surface Register
The register intentionally names every meaningful tab, drawer, wizard step and action surface. Documentation depth must not be mistaken for navigation depth: only the primary routes appear as top-level product destinations.

## 01. Public Website, Marketing & Conversion
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 01.01 | Main Landing Page | / | Main public page | Public |
| 01.02 | Privacy Policy | /privacy | Legal page | Public |
| 01.03 | Terms of Service | /terms | Legal page | Public |
| 01.04 | Cookie Policy | /cookies | Legal page | Public |

## 02. Authentication, Account Entry & Profile
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 02.01 | Sign Up | /signup | Auth page | Public |
| 02.02 | Sign In | /login | Auth page | Public |
| 02.03 | Forgot Password | /forgot-password | Auth page | Public |
| 02.04 | Reset Password | /reset-password | Auth page | Public |
| 02.05 | Email Verification | Auth callback/state | Auth state | Public / Customer |
| 02.06 | Profile & Account Menu | Global popover/dialog | Account surface | Customer |

## 03. Onboarding & Activation
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 03.01 | Setup Wizard | /onboarding | Wizard | Customer |
| 03.02 | Your Business | ?step=business | Wizard step | Customer |
| 03.03 | Connect Leads | ?step=connect | Wizard step | Customer |
| 03.04 | Follow-Up | ?step=follow-up | Wizard step | Customer |
| 03.05 | Qualify & Book | ?step=qualify-book | Wizard step | Customer |
| 03.06 | Test & Go Live | ?step=go-live | Wizard step | Customer |

## 04. Application Shell & Shared Interaction
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 04.01 | Authenticated App Shell | /app/* | Shell | Customer |
| 04.02 | Primary Sidebar | Global | Shell surface | Customer |
| 04.03 | Top Bar | Global | Shell surface | Customer |
| 04.04 | Attention Menu | Global | Popover | Customer |
| 04.05 | Mobile Navigation | Global mobile | Shell surface | Customer |
| 04.06 | Global Page States | Global | State surface | Customer |

## 05. Dashboard & Operational Overview
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 05.01 | Dashboard | /app | Main app page | Customer |
| 05.02 | Funnel Drilldown | Inline interaction | Filtered drilldown | Customer |
| 05.03 | Needs Attention | Inline panel | Operational panel | Customer |
| 05.04 | Recent Leads | Inline panel | Operational panel | Customer |
| 05.05 | Upcoming Bookings | Inline panel | Operational panel | Customer |
| 05.06 | Source Performance | Inline section | Reporting section | Customer |
| 05.07 | Follow-Up Performance | Inline section | Reporting section | Customer |
| 05.08 | Reactivation Performance | Inline section | Reporting section | Customer |

## 06. Leads, Conversations & Lead Detail
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 06.01 | Leads | /app/leads | Main app page | Customer |
| 06.02 | All | Quick filter | Filter state | Customer |
| 06.03 | Active | Quick filter | Filter state | Customer |
| 06.04 | Needs Attention | Quick filter | Filter state | Customer |
| 06.05 | Qualified | Quick filter | Filter state | Customer |
| 06.06 | Booked | Quick filter | Filter state | Customer |
| 06.07 | Lead Detail | ?lead={id} / drawer | Detail drawer | Customer |
| 06.08 | Summary | Drawer tab | Detail tab | Customer |
| 06.09 | Conversation | Drawer tab | Detail tab | Customer |
| 06.10 | Activity | Drawer tab | Detail tab | Customer |
| 06.11 | Manual Send | Dialog/sheet | Action surface | Customer |
| 06.12 | Status / Handover Actions | Drawer actions | Action surface | Customer |

## 07. Follow-Up & Qualification
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 07.01 | Follow-Up | /app/follow-up | Main app page | Customer |
| 07.02 | Follow-Up | Tab | Configuration tab | Customer |
| 07.03 | Qualification | Tab | Configuration tab | Customer |
| 07.04 | Sequence Editor | Inline panel | Editor | Customer |
| 07.05 | Message Step Editor | Drawer/dialog | Editor | Customer |
| 07.06 | Stop Conditions | Inline panel | Configuration panel | Customer |
| 07.07 | Quiet Hours | Inline panel | Configuration panel | Customer |
| 07.08 | Booking Reminder | Inline panel | Configuration panel | Customer |
| 07.09 | Questions | Qualification section | Configuration section | Customer |
| 07.10 | Question Editor | Drawer/dialog | Editor | Customer |
| 07.11 | Qualification Result Logic | Qualification section | Configuration section | Customer |

## 08. Reactivation Campaigns
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 08.01 | Reactivation | /app/reactivation | Main app page | Customer |
| 08.02 | New Reactivation | /app/reactivation/new | Wizard | Customer |
| 08.03 | Audience | Wizard step | Wizard step | Customer |
| 08.04 | Message & Timing | Wizard step | Wizard step | Customer |
| 08.05 | Review & Launch | Wizard step | Wizard step | Customer |
| 08.06 | Campaign Detail | ?campaign={id} / drawer | Detail drawer | Customer |
| 08.07 | CSV Import | Audience step panel/dialog | Import workflow | Customer |

## 09. Settings, Connections, Team & Billing
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 09.01 | Settings | /app/settings | Main settings page | Customer |
| 09.02 | Workspace | Tab | Settings tab | Customer |
| 09.03 | Connections | Tab | Settings tab | Customer |
| 09.04 | Team | Tab | Settings tab | Customer |
| 09.05 | Billing | Tab | Settings tab | Owner |
| 09.06 | Business Details | Workspace section | Settings section | Owner/Admin |
| 09.07 | Services | Workspace section | Settings section | Owner/Admin |
| 09.08 | Service Editor | Drawer | Detail editor | Owner/Admin |
| 09.09 | Meta Lead Ads | Connection card/drawer | Integration config | Owner/Admin |
| 09.10 | SMS | Connection card/drawer | Integration config | Owner/Admin |
| 09.11 | WhatsApp | Connection card/drawer | Integration config | Owner/Admin |
| 09.12 | Calendly | Connection card/drawer | Integration config | Owner/Admin |
| 09.13 | Google Calendar | Connection card/drawer | Integration config | Owner/Admin |
| 09.14 | Invite Team Member | Dialog | Team action | Owner/Admin |
| 09.15 | Manage Subscription | Stripe portal | Billing action | Owner |

## 10. Platform Administration & Support
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 10.01 | Admin Overview | /admin | Admin dashboard | Platform Admin |
| 10.02 | Customers | /admin/customers | Admin page | Platform Admin |
| 10.03 | Customer Support Detail | ?customer={id} / drawer | Admin detail | Platform Admin |
| 10.04 | System | /admin/system | Admin page | Platform Admin |
| 10.05 | Health | Tab | Admin tab | Platform Admin |
| 10.06 | Events | Tab | Admin tab | Platform Admin |
| 10.07 | Errors | Tab | Admin tab | Platform Admin |
| 10.08 | Retry Event / Job | Row action/dialog | Admin action | Platform Admin |
| 10.09 | Suspend Workspace | Confirm dialog | Admin action | Platform Admin |

## 11. Supabase PostgreSQL Data Architecture
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 11.01 | Tenant & Identity Schema | Technical register | Technical register | Technical |
| 11.02 | Lead & Messaging Schema | Technical register | Technical register | Technical |
| 11.03 | Follow-Up & Qualification Schema | Technical register | Technical register | Technical |
| 11.04 | Booking & Reactivation Schema | Technical register | Technical register | Technical |
| 11.05 | Integration & Webhook Schema | Technical register | Technical register | Technical |
| 11.06 | Billing, Usage, Audit & Suppression | Technical register | Technical register | Technical |

## 12. Backend Services, Integrations, Webhooks & Workers
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 12.01 | Next.js Server Application | Technical surface | Technical surface | Technical |
| 12.02 | Meta Lead Ingestion | Technical flow | Integration service | Technical |
| 12.03 | Messaging Adapter | Technical flow | Integration service | Technical |
| 12.04 | Booking Adapter | Technical flow | Integration service | Technical |
| 12.05 | Stripe Billing Adapter | Technical flow | Integration service | Technical |
| 12.06 | Webhook Inbox | Technical flow | Event service | Technical |
| 12.07 | Background Worker / Queue | Technical flow | Worker service | Technical |
| 12.08 | Health & Observability | Technical surface | Operations service | Technical |

## 13. Security, RLS, Audit & Compliance
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 13.01 | RLS Policy Register | Technical register | Security register | Technical |
| 13.02 | Role & Mutation Matrix | Technical register | Security register | Technical |
| 13.03 | Service Role Boundary | Technical register | Security register | Technical |
| 13.04 | Opt-Out & Suppression | Technical register | Compliance register | Technical |
| 13.05 | Audit Event Register | Technical register | Audit register | Technical |
| 13.06 | Secret / Provider Token Rules | Technical register | Security register | Technical |

## 14. Design System, Components, States & Responsive
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 14.01 | Design Tokens | Internal register | Design register | Technical |
| 14.02 | Global Components | Internal register | Component register | Technical |
| 14.03 | Lead Components | Internal register | Component register | Technical |
| 14.04 | Follow-Up Components | Internal register | Component register | Technical |
| 14.05 | Wizard Components | Internal register | Component register | Technical |
| 14.06 | Admin Components | Internal register | Component register | Technical |
| 14.07 | Loading / Empty / Error / Permission States | Internal register | State register | Technical |
| 14.08 | Responsive & Accessibility Rules | Internal register | UX register | Technical |
| 14.09 | Marketing 3D / Motion System | Internal register | Marketing component register | Technical |

## 15. QA, Testing, Performance & Release Readiness
| ID | Page / Surface | Route / State | Category | Audience |
| --- | --- | --- | --- | --- |
| 15.01 | Route & Surface Test Register | Internal register | QA register | Technical |
| 15.02 | RLS / Cross-Tenant Test Register | Internal register | QA register | Technical |
| 15.03 | Webhook / Idempotency Test Register | Internal register | QA register | Technical |
| 15.04 | Messaging / Automation Test Register | Internal register | QA register | Technical |
| 15.05 | Responsive / Accessibility Test Register | Internal register | QA register | Technical |
| 15.06 | Performance / Observability Register | Internal register | QA register | Technical |
| 15.07 | Commercial V1 Release Gate | Internal workflow | Release workflow | Technical |

# PART II — Detailed Domain Integration Register
This section maps the simplified surfaces to named components, primary data, realtime behaviour and server boundaries before the page-by-page specifications. It follows the same build-ready principle as the reference architecture while preserving ClientTurn’s much smaller scope.

## 01. Public Website, Marketing & Conversion
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 01.01 | Main Landing Page | / | MarketingHeader, CinematicHero, FeatureStoryWorld, IntegrationConstellation, IndustryRail, PricingGrid, FAQAccordion, FinalCTA, MarketingFooter | marketing_sessions, marketing_events | Client telemetry / no tenant realtime | Public SSR + progressive WebGL |
| 01.02–01.04 | Legal pages | /privacy /terms /cookies | LegalLayout, LegalHeader, LegalBody, CookieControls | Static legal content | HTTP/static | Public server/static |

## 02. Authentication, Account Entry & Profile
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 02.01 | Sign Up | /signup | AuthLayout, SignupForm, NameFields, BusinessNameField, EmailField, PasswordField, TermsCheckbox, SubmitButton | Supabase Auth, profiles, businesses, business_members | HTTP/session | Server action provisions tenant |
| 02.02 | Sign In | /login | AuthLayout, LoginForm, ForgotPasswordLink | Supabase Auth, onboarding_sessions | Session | Supabase Auth + server redirect |
| 02.03–02.05 | Recovery / verification | Auth routes/state | ForgotPasswordForm, ResetPasswordForm, VerificationState | Supabase Auth | Auth callback | Provider-managed reset + server routing |
| 02.06 | Profile & Account Menu | Global | ProfileMenu, EditNameDialog, PasswordResetAction, SignOutAction | profiles, auth session | HTTP | Own profile only |

## 03. Onboarding & Activation
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 03.01 | Setup Wizard | /onboarding | OnboardingShell, OnboardingStepper, AutosaveIndicator, ValidationSummary | onboarding_sessions + bounded config | Health refresh | Owner/admin server actions |
| 03.02 | Your Business | ?step=business | BusinessFields, HoursEditor, ServiceListEditor | businesses, business_settings, services | HTTP | Validated server action |
| 03.03 | Connect Leads | ?step=connect | MetaConnectCard, PageSelector, FormSelector, FieldMappingPanel, ConnectionTest | integrations, integration_objects, field_mappings | Health refresh | OAuth/server-only tokens |
| 03.04 | Follow-Up | ?step=follow-up | ChannelSetup, OpeningMessageEditor, SequencePreview, QuietHoursEditor, SendTestMessage | integrations, automation_* | Delivery/test refresh | Messaging adapter server-side |
| 03.05 | Qualify & Book | ?step=qualify-book | QuestionListEditor, InlineRuleEditor, BookingModeSelector, CalendlyConfig, HumanHandoverOption | qualification_*, services, integrations | HTTP | Validated server action |
| 03.06 | Test & Go Live | ?step=go-live | ActivationChecklist, SyntheticLeadForm, TestRunTimeline, ActivateButton | test leads/messages/runs, onboarding_sessions | Realtime test events | Internal test lead service + activation transaction |

## 04. Application Shell & Shared Interaction
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 04.01 | Authenticated App Shell | /app/* | AppShell, Sidebar, TopBar, MainContent, GlobalToaster | profiles, business_members, subscriptions | Attention/health refresh | Server layout auth/membership |
| 04.02–04.05 | Navigation & attention | Global | Sidebar, NavItem, ConnectionHealthPill, AttentionPopover, MobileNavSheet | integrations, needs-attention aggregate | Selective realtime/refetch | Read-only aggregate + server routing |
| 04.06 | Global states | Global | PageSkeleton, EmptyState, ErrorState, PermissionState, PlanLimitState, ConnectionRequiredState | n/a | n/a | Chosen from canonical server/query state |

## 05. Dashboard & Operational Overview
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 05.01 | Dashboard | /app | DashboardHeader, DateRangeControl, HealthStrip, KPIGrid, FunnelCard, NeedsAttentionPanel, RecentLeadsTable, UpcomingBookingsCard, SourcePerformanceTable, FollowUpPerformanceCard, ReactivationPerformanceCard | leads, messages, bookings, lead_sources, campaigns, integrations | Lead/attention/booking realtime; metric refetch | Server aggregate queries |
| 05.02–05.08 | Dashboard drilldowns/sections | Inline | FunnelStage, PerformanceTable, MetricDefinitionTooltip, CampaignSummaryRows | Same canonical operational data | Refetch on invalidation | Links/drilldowns resolve to authorized Leads filters |

## 06. Leads, Conversations & Lead Detail
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 06.01 | Leads | /app/leads | PageHeader, LeadQuickFilters, LeadFilterBar, LeadSearch, LeadsTable, LeadsPagination, LeadDrawerHost | leads, lead_sources, services, members | Realtime inserts/status + server pagination | Tenant-scoped server query |
| 06.07 | Lead Detail | ?lead={id} | LeadDetailDrawer, LeadHeader, LeadActions, LeadDetailTabs | lead + conversations/messages/qualification/bookings | Realtime message/status | Authorized id+business query |
| 06.08 | Summary | Drawer tab | ContactDetailsCard, ServiceAndSourceCard, QualificationSummary, BookingSummary, AssignmentControl | lead/source/answers/booking | Event refresh | Whitelisted mutations |
| 06.09 | Conversation | Drawer tab | ConversationThread, MessageBubble, DeliveryState, MessageComposer, HandoverBanner | conversations, messages, message_events | Realtime | Manual sends server-side |
| 06.10 | Activity | Drawer tab | LeadTimeline, TimelineEvent, ActorBadge | audit + derived events | Event refresh | Read-only |
| 06.11–06.12 | Manual / status actions | Dialog/actions | ManualMessageDialog, AssignMenu, HumanTakeoverAction, ResumeAutomationAction, OutcomeActions | leads, automation_runs, messages, audit_log | Realtime status/delivery | Controlled audited server actions |

## 07. Follow-Up & Qualification
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 07.01 | Follow-Up | /app/follow-up | PageHeader, FollowUpTabs, FollowUpStatus, PublishControls | automation_* + qualification_* | HTTP/event refresh | Owner/admin configuration |
| 07.02 | Follow-Up tab | Tab | SequenceEditor, SequenceStepList, StopConditionsPanel, QuietHoursPanel, BookingReminderPanel, MessagePreview | automation_versions, automation_steps, business_settings | HTTP | Draft/publish server actions |
| 07.03 | Qualification tab | Tab | QuestionList, AddQuestionButton, QualificationResultLogic, ServiceScopeSummary, QualificationPreview | qualification_questions/options/rules, services | HTTP | Deterministic rule validation |
| 07.04–07.08 | Follow-Up editors | Inline/drawer | MessageStepEditor, DelayInput, ChannelSelector, TemplateEditor, MergeFieldMenu, StopConditionList, AllowedWindowEditor | automation/config | HTTP | Server validation |
| 07.09–07.11 | Qualification editors | Section/drawer | QuestionEditor, ResponseTypeSelect, OptionEditor, RuleEditor, ServiceScopeSelector, ResultRouteCards | qualification config | HTTP | Server validation; no AI inference |

## 08. Reactivation Campaigns
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 08.01 | Reactivation | /app/reactivation | PageHeader, ReactivationSummary, CampaignTable, NewCampaignButton, CampaignDrawerHost | campaigns, campaign_contacts | Event refresh | Tenant-scoped server list |
| 08.02 | New Reactivation | /app/reactivation/new | WizardShell, WizardStepper, DraftStatus, BackContinue | campaign draft, imports | HTTP | Owner/admin launch |
| 08.03 | Audience | Wizard step | AudienceSourceSelector, AudienceFilters, EligibilityPreview, SuppressionBreakdown, CSVImportPanel | leads, suppressions, imports | Preview refetch | Server segment + eligibility |
| 08.04 | Message & Timing | Wizard step | CampaignMessageEditor, OptionalFollowUpEditor, SendModeControl, ScheduleDateTime, MessagePreview | campaign draft | HTTP | Template/channel validation |
| 08.05 | Review & Launch | Wizard step | AudienceSummary, SuppressionSummary, EstimatedMessageCount, LaunchButton | campaign + planned contacts | HTTP | Final eligibility + expansion job |
| 08.06 | Campaign Detail | ?campaign={id} | CampaignDetailDrawer, CampaignMetrics, AudienceSummary, DeliverySummary, CampaignActivity | campaigns, campaign_contacts, messages, leads | Event refresh | Scoped read/actions |

## 09. Settings, Connections, Team & Billing
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 09.01 | Settings | /app/settings | PageHeader, SettingsTabs, SettingsContent | workspace + integrations + members + subscription | Health/event refresh | Role-aware tab queries |
| 09.02 | Workspace | Tab | BusinessDetailsCard, BusinessHoursCard, ServiceTable, ServiceDrawerHost | businesses, business_settings, services | HTTP | Owner/admin mutations |
| 09.03 | Connections | Tab | ConnectionGrid, ConnectionCard, ConnectionDrawerHost | integrations, integration_objects, field_mappings | Health refresh | OAuth/provider server actions |
| 09.04 | Team | Tab | TeamTable, InviteMemberDialog, RoleSelect, RemoveMemberAction | business_members, profiles | HTTP | Owner/admin with owner protections |
| 09.05 | Billing | Tab | PlanCard, SubscriptionStatus, UsageMeters, UpgradeActions, ManageBillingButton | subscriptions, usage_events | Stripe event refresh | Owner + Stripe portal |
| 09.09–09.13 | Provider drawers | Connection drawers | MetaConnectFlow, SMSProviderStatus, WhatsAppProviderStatus, CalendlyConfig, GoogleOAuthAction | integrations/objects/mappings | Health refresh | Secrets server-only |

## 10. Platform Administration & Support
| ID | Page / Surface | Route / State | Core components | Primary data | Realtime / refresh | Server boundary |
| --- | --- | --- | --- | --- | --- | --- |
| 10.01 | Admin Overview | /admin | AdminShell, AdminKPIGrid, ProviderHealthPanel, RecentCustomers, FailedJobsPanel | businesses, subscriptions, integrations, jobs | Event refresh | Platform-admin server authorization |
| 10.02 | Customers | /admin/customers | CustomerSearch, CustomerFilters, CustomerTable, CustomerDrawerHost | businesses, memberships, subscriptions, integrations, usage | HTTP/event refresh | Platform-admin only |
| 10.03 | Customer Support Detail | ?customer={id} | CustomerSupportDrawer, BusinessSummary, MemberSummary, PlanUsageSummary, ConnectionSummary, RecentActivity, RecentErrors | canonical customer/system data | Event refresh | Privileged server read |
| 10.04 | System | /admin/system | AdminPageHeader, SystemTabs | webhook_events, jobs, integrations, errors | Event refresh | Platform-admin only |
| 10.05 | Health | Tab | ProviderHealthGrid, QueueHealthCard, IntegrationIssueTable, BillingHealthCard | integrations, jobs, subscription summaries | Periodic/event refresh | Normalized health |
| 10.06 | Events | Tab | EventFilterBar, EventTable, EventDetailDrawer, RetryAction | webhook_events, jobs | Periodic/event refresh | Redacted payloads + safe retry |
| 10.07 | Errors | Tab | ErrorFilterBar, ErrorTable, ErrorDetailDrawer, SentryLink | normalized errors/jobs/integrations | Periodic/event refresh | No secrets/full PII |

## 11. Canonical PostgreSQL table families
| Family | Tables | Rule |
| --- | --- | --- |
| Identity & tenant | profiles, businesses, business_members, business_settings, services, onboarding_sessions | Every tenant-owned row carries business_id where applicable. |
| Qualification | qualification_questions, qualification_options, qualification_rules, qualification_answers | Deterministic only; REVIEW for uncertain/manual answers. |
| Leads & messaging | leads, lead_sources, lead_assignments, conversations, messages, message_events | Lead/message are canonical transactional records. |
| Follow-Up | automation_definitions, automation_versions, automation_steps, automation_runs | Published versioning; no arbitrary workflow graph. |
| Booking | bookings | Outcome attached to lead; external provider remains scheduling authority. |
| Reactivation | campaigns, campaign_contacts, imports, contact_suppressions | Eligibility rechecked before every send. |
| Integrations | integrations, integration_objects, field_mappings, webhook_events | Provider secrets server-only; webhook idempotency required. |
| Platform/billing | jobs, usage_events, subscriptions, audit_log, marketing_sessions, marketing_events | Stripe/webhook state authoritative where applicable; audit append-only. |

## 12. Core backend event families
| Event | Producer | Consumers | Delivery / idempotency |
| --- | --- | --- | --- |
| lead.created | Meta/lead ingestion | Lead UI, automation engine, dashboard | Provider external-id dedupe + transactional creation. |
| message.outbound_queued | Automation/manual send | Worker, conversation UI | Stable send/idempotency key. |
| message.received | Messaging webhook | Conversation, automation stop, qualification, attention | Provider message-id/event dedupe. |
| qualification.result_changed | Deterministic evaluator | Lead state, booking/handover, dashboard | Transactional + audit. |
| booking.created/updated | Booking provider/manual flow | Lead, dashboard, automation stop | External booking event idempotent. |
| campaign.launched | Reactivation server action | Campaign expansion worker, audit | Campaign-state idempotency. |
| integration.health_changed | Worker/provider error | Top bar, Settings, Admin | At-least-once; UI refetches canonical health. |
| subscription.updated | Stripe webhook | Entitlements, Settings, Admin | Stripe event idempotency. |
| admin.event_retried | Platform admin | Worker/event processor, audit | Only explicitly retryable/idempotent records. |

## 13. RLS & role summary
| Capability | Owner | Admin | Member | Platform Admin |
| --- | --- | --- | --- | --- |
| View leads/conversations | Yes | Yes | Yes | Support view through privileged server layer |
| Manual lead/message actions | Yes | Yes | Yes unless later restricted | Only explicit audited support actions |
| Publish Follow-Up / Qualification | Yes | Yes | No | No customer config mutation |
| Configure provider connections | Yes | Yes | No | Health/support only |
| Manage team | Yes | Yes with owner protections | No | No |
| Billing portal | Yes | No by default | No | Support visibility only |
| Suspend workspace | No | No | No | Yes, audited |

## 14. Canonical component families
| Family | Named components |
| --- | --- |
| Shell | AppShell, Sidebar, TopBar, PageHeader, AttentionPopover, MobileNavSheet, GlobalToaster |
| Data | DataTable, FilterBar, QuickFilterChips, StatusBadge, HealthBadge, Pagination |
| Dashboard | KPIGrid, FunnelCard, NeedsAttentionPanel, RecentLeadsTable, UpcomingBookingsCard, PerformanceTable |
| Lead | LeadDetailDrawer, LeadDetailTabs, ContactDetailsCard, QualificationSummary, BookingSummary, ConversationThread, MessageComposer, LeadTimeline |
| Follow-Up | FollowUpTabs, SequenceEditor, SequenceStep, MessageStepEditor, StopConditionsPanel, QuietHoursEditor, BookingReminderPanel |
| Qualification | QuestionList, QuestionEditor, OptionEditor, RuleEditor, ServiceScopeSelector, QualificationPreview |
| Wizard | WizardShell, WizardStepper, AutosaveIndicator, ValidationSummary, ReviewSummary |
| Reactivation | CampaignTable, EligibilityPreview, SuppressionBreakdown, CSVImportPanel, CampaignDetailDrawer |
| Settings | SettingsTabs, ConnectionGrid, ConnectionCard, ConnectionDrawer, ServiceTable, ServiceDrawer, TeamTable, InviteMemberDialog, PlanCard, UsageMeter |
| Admin | AdminShell, CustomerTable, CustomerSupportDrawer, ProviderHealthGrid, EventTable, EventDetailDrawer, ErrorTable, RetryConfirmDialog |
| States | Skeleton, EmptyState, ErrorState, PermissionState, PlanLimitState, ConnectionRequiredState, ConfirmDialog |
| Marketing 3D | ClientTurnWebGLWorld, CinematicCameraRig, MasterEnergyRail3D, HDRLightingRig, LeadNode3D, MessageCard3D, QualificationStack3D, BookingCalendar3D, ReactivationArchive3D, ControlCentre3D, StoryScrollController |

## 15. Canonical release-quality rule
- Every customer/admin route implements loading, empty/no-results, error, permission and mobile states as applicable.
- Every consequential mutation performs server-side membership/role/entitlement checks.
- Every browser-accessible tenant table has RLS and automated Business A / Business B isolation tests.
- Every external webhook is verified, captured idempotently and slow work is queued.
- Every outbound send path shares the same opt-out/suppression guard.
- Every major provider failure is visible in the customer health state and/or platform admin diagnostics.
- No fake testimonials, customer logos, performance statistics or revenue proof appear in marketing/product demos.

# PART III — Full Page-by-Page Product Specifications

# 6. Main Landing Page — `/`

## 6.1 Goal

Explain ClientTurn in one journey and drive qualified visitors into signup.

The landing page should answer:

1. What does ClientTurn do?
2. Who is it for?
3. What happens after a lead arrives?
4. What if the lead does not reply?
5. How does qualification work?
6. How does booking or handover work?
7. What happens to old leads?
8. What tools does it connect to?
9. What does it cost?
10. How do I start?

## 6.2 Page component tree

```text
<ClientTurnMarketingPage>
  <MarketingHeader />
  <CinematicHero />
  <SpeedToLeadStory />
  <FollowUpStory />
  <QualificationStory />
  <BookingHandoverStory />
  <ReactivationStory />
  <ControlVisibilityStory />
  <IntegrationConstellation />
  <IndustriesRail />
  <PricingSection />
  <FAQSection />
  <FinalCTASection />
  <MarketingFooter />
</ClientTurnMarketingPage>
```

## 6.3 Header

### Components

- `MarketingHeader`
- `BrandLockup`
- `AnchorNav`
- `LoginLink`
- `PrimaryCTA`
- `MobileMenuButton`
- `MobileMarketingDrawer`

### Navigation

- How It Works
- Reactivation
- Industries
- Pricing
- FAQ
- Login
- Start Free

No mega menu.

## 6.4 Cinematic hero

### Components

- `CinematicHero`
- `HeroCopy`
- `HeroPrimaryCTA`
- `HeroSecondaryCTA`
- `ClientTurnWebGLWorld`
- `HeroLeadNode`
- `HeroMessageNode`
- `HeroQualificationNode`
- `HeroBookingNode`
- `HeroOutcomeNode`
- `MasterEnergyRail`

### Copy direction

Eyebrow:

> For businesses running paid lead campaigns

Headline:

> Turn leads into booked clients.

Support:

> Follow up faster, qualify enquiries and move the right opportunities toward booking.

Primary:

`Start Free`

Secondary:

`See How It Works`

No fake results.

## 6.5 Speed-to-Lead story

### Components

- `SpeedToLeadStory`
- `NewEnquiryCard3D`
- `ResponseRouter3D`
- `WaitingState3D`
- `ResponseSentCard3D`
- `StoryCopyBlock`

Headline:

> Respond while the lead is fresh.

Supporting sentence:

> New enquiries can enter your follow-up immediately.

## 6.6 Follow-Up story

### Components

- `FollowUpStory`
- `SequenceRail3D`
- `SequenceStep3D`
- `ReplyReceivedCard3D`
- `StopStateChip3D`
- `StoryCopyBlock`

Visual steps:

- Immediately
- +10 min
- +2 hours
- +1 day
- +3 days

On reply, future steps visually stop.

Headline:

> Follow up without chasing.

## 6.7 Qualification story

### Components

- `QualificationStory`
- `QualificationMachine3D`
- `QualificationCriterion3D`
- `QualifiedRoute3D`
- `ReviewRoute3D`
- `NotFitRoute3D`

Example criteria:

- Service
- Area
- Timing
- Requirements

Headline:

> Qualify with your own rules.

No AI claims.

## 6.8 Booking & handover story

### Components

- `BookingHandoverStory`
- `QualifiedLead3D`
- `BookingRouter3D`
- `Calendar3D`
- `BookingConfirmedCard3D`
- `HumanHandoverCard3D`

Headline:

> Book it. Or hand it over.

## 6.9 Reactivation story

### Components

- `ReactivationStory`
- `DormantLeadStack3D`
- `EligibilityScanner3D`
- `SuppressionState3D`
- `ReactivatedLead3D`
- `ReplyState3D`

Headline:

> Work the leads you already have.

No fake uplift, recovered revenue or success-rate claims.

## 6.10 Control & visibility story

### Components

- `ControlVisibilityStory`
- `LeadListPanel3D`
- `ConversationPanel3D`
- `QualificationPanel3D`
- `BookingPanel3D`
- `NeedsAttentionPanel3D`
- `IntegrationHealthPanel3D`
- `ControlHub3D`

Headline:

> See the whole journey.

## 6.11 Integrations

### Components

- `IntegrationConstellation`
- `IntegrationNode`
- `IntegrationConnector`
- `IntegrationLabel`

Show:

- Meta Lead Ads
- SMS
- WhatsApp
- Calendly
- Google Calendar

Do not present Stripe or Resend as customer-facing product integrations.

## 6.12 Industries

### Components

- `IndustriesRail`
- `IndustryItem`
- `IndustryContextLine`

Industries are presented with concise outcome copy rather than huge cards.

## 6.13 Pricing

### Components

- `PricingSection`
- `PricingCard`
- `PlanFeatureList`
- `RecommendedPlanBadge`
- `PricingCTA`

Plans:

### Starter — £79/month
- Up to 100 new leads
- 1 user
- SMS
- Standard follow-up
- One booking destination
- Core dashboard

### Growth — £149/month
- Up to 500 new leads
- 3 users
- SMS + WhatsApp where configured
- Reactivation
- Multiple qualification questions
- Source reporting

### Pro — £249/month
- Up to 1,500 new leads
- Up to 10 users
- Higher usage
- More advanced routing
- Priority support

## 6.14 FAQ

### Components

- `FAQSection`
- `FAQAccordion`
- `FAQItem`

Required questions:

- Does ClientTurn generate leads?
- Do I need to change my Meta ads?
- What happens when someone replies?
- Can I use my own questions?
- Can I use SMS and WhatsApp?
- Can I connect Calendly?
- Can I reactivate older leads?
- Does ClientTurn replace my CRM?
- Can someone opt out?
- Can I cancel?

## 6.15 Final CTA

### Components

- `FinalCTASection`
- `FinalCTAVisual`
- `PrimaryCTA`
- `SecondaryCTA`

Headline:

> Turn more enquiries into clients.

## 6.16 Landing page data/telemetry

Capture only:

- UTM source/medium/campaign
- referrer
- CTA source
- signup attribution
- key marketing interaction events

Use PostHog.

Do not build a marketing CMS in V1.

---

# PART IV — Authentication & Activation Specifications

# 7. Sign Up — `/signup`

## 7.1 Components

```text
<AuthPage>
  <AuthBrandPanel />
  <AuthCard>
    <SignupForm>
      <NameFields />
      <BusinessNameField />
      <EmailField />
      <PasswordField />
      <TermsCheckbox />
      <SubmitButton />
    </SignupForm>
    <AuthSwitchLink />
  </AuthCard>
</AuthPage>
```

## 7.2 Fields

- First name
- Last name
- Business name
- Work email
- Password
- Terms acceptance

## 7.3 Submit behavior

1. Create Supabase user.
2. Create `profiles`.
3. Create `businesses`.
4. Create owner membership.
5. Store acquisition attribution.
6. Enter verification state if required.
7. Redirect to `/onboarding`.

---

# 8. Sign In — `/login`

## Components

- `AuthPage`
- `AuthBrandPanel`
- `AuthCard`
- `LoginForm`
- `EmailField`
- `PasswordField`
- `ForgotPasswordLink`
- `SubmitButton`
- `AuthSwitchLink`

Redirect:

- incomplete activation → `/onboarding`
- activated workspace → `/app`

---

# 9. Password Recovery

## 9.1 `/forgot-password`

Components:

- `AuthCard`
- `ForgotPasswordForm`
- `EmailField`
- `SuccessState`

## 9.2 `/reset-password`

Components:

- `AuthCard`
- `ResetPasswordForm`
- `PasswordField`
- `PasswordConfirmField`
- `SubmitButton`

Use Supabase Auth.

No custom token system.

---

# 10. Onboarding — `/onboarding`

## 10.1 Goal

Get a new business to a real working test lead with as little setup friction as possible.

## 10.2 Component tree

```text
<OnboardingPage>
  <OnboardingShell>
    <OnboardingHeader />
    <WizardProgress />
    <WizardViewport />
    <WizardFooterActions />
  </OnboardingShell>
</OnboardingPage>
```

Shared components:

- `OnboardingShell`
- `WizardProgress`
- `WizardStepTitle`
- `WizardHelpText`
- `WizardBackButton`
- `WizardContinueButton`
- `WizardSaveExitButton`
- `WizardErrorBanner`
- `WizardSuccessBanner`

## 10.3 Step 1 — Your Business

Combines business setup and services.

### Components

- `BusinessDetailsForm`
- `BusinessHoursEditor`
- `ServiceAreaField`
- `ServicesInlineList`
- `ServiceInlineCard`
- `AddServiceButton`

### Fields

Business:
- Business name
- Industry
- Website
- Phone
- Timezone
- Business hours
- Service-area description

Service:
- Name
- Active
- Average value
- Optional internal description

Default service templates may be suggested by industry but are editable.

## 10.4 Step 2 — Connect Leads

### Components

- `MetaConnectCard`
- `MetaOAuthButton`
- `MetaPageSelector`
- `MetaFormSelector`
- `LeadFieldMapping`
- `ConnectionHealthState`

### Flow

Connect Meta → select page → select form(s) → map fields → verify.

Required mappings:

- name
- phone
- email where available
- form id
- source metadata

## 10.5 Step 3 — Follow-Up

Combines messaging channel setup and initial sequence.

### Components

- `MessagingChannelSelector`
- `SenderSetupCard`
- `OpeningMessageEditor`
- `FollowUpSequenceMiniEditor`
- `QuietHoursEditor`
- `OptOutWordingField`
- `TestMessageButton`

### Default sequence

- Immediately
- +10 minutes
- +2 hours
- +1 day
- +3 days

Customer may edit text and timings within permitted limits.

## 10.6 Step 4 — Qualify & Book

Combines deterministic qualification and booking destination.

### Components

- `QualificationQuestionList`
- `QualificationQuestionCard`
- `AddQuestionButton`
- `RuleInlineEditor`
- `BookingModeSelector`
- `CalendlySetupCard`
- `GoogleCalendarSetupCard`
- `HumanHandoverOption`

Supported question types:

- Yes/No
- Single choice
- Number
- Postcode
- Timing
- Free text

Default routing:

- QUALIFIED → booking/handover
- REVIEW → needs attention
- NOT QUALIFIED → stop

No routing-builder UI.

## 10.7 Step 5 — Test & Go Live

### Components

- `ActivationChecklist`
- `TestLeadPanel`
- `TestLeadRunButton`
- `ActivationHealthRow`
- `GoLiveButton`
- `ActivationSuccessState`

Checklist:

- business configured
- service exists
- Meta healthy
- outbound messaging healthy
- follow-up configured
- qualification configured
- booking or handover configured
- test lead successful

Test lead runs through the same internal processing path as a real lead but is excluded from analytics.

---

# PART V — Customer Application Specifications

# 11. Application Shell

## 11.1 Navigation

Desktop sidebar:

- Dashboard
- Leads
- Follow-Up
- Reactivation
- Settings

Bottom:

- Help
- Profile

## 11.2 Component tree

```text
<AppShell>
  <DesktopSidebar />
  <MobileAppHeader />
  <MobileNavDrawer />
  <AppTopBar />
  <AppContent />
  <GlobalLeadDrawer />
  <GlobalDialogLayer />
  <ToastViewport />
</AppShell>
```

## 11.3 Components

- `AppShell`
- `DesktopSidebar`
- `SidebarNavItem`
- `SidebarFooter`
- `MobileAppHeader`
- `MobileNavDrawer`
- `AppTopBar`
- `IntegrationHealthPill`
- `NeedsAttentionButton`
- `ProfilePopover`
- `ToastViewport`
- `ConfirmDialog`
- `PermissionState`
- `PlanLimitState`

## 11.4 Notification strategy

No standalone notification tray in V1.

Operational attention is surfaced through:

- Dashboard `NeedsAttentionPanel`
- Leads quick filter
- `NeedsAttentionButton`
- email notification preferences
- integration health

---

# 12. Dashboard — `/app`

## 12.1 Goal

Answer three questions quickly:

1. What is happening?
2. What needs attention?
3. Is ClientTurn producing movement through the funnel?

## 12.2 Page component tree

```text
<DashboardPage>
  <DashboardHeader />
  <HealthStrip />
  <KPIGrid />
  <LeadFunnelCard />
  <NeedsAttentionPanel />
  <RecentLeadsCard />
  <UpcomingBookingsCard />
  <SourcePerformanceCard />
  <FollowUpPerformanceCard />
  <ReactivationPerformanceCard />
</DashboardPage>
```

## 12.3 Header

### Components

- `DashboardHeader`
- `BusinessGreeting`
- `DateRangePicker`
- `ActivationHealthBadge`

## 12.4 Health strip

Components:

- `HealthStrip`
- `HealthItem`

Show:

- Meta connection
- Messaging
- Booking destination
- Follow-up published

Only surface warnings that require action.

## 12.5 KPIs

Components:

- `KPIGrid`
- `StatCard`

Metrics:

- New Leads
- Contacted
- Replies
- Qualified
- Bookings
- Booking Rate

Optional:
- Estimated Pipeline

Always label as **Estimated Pipeline**.

## 12.6 Funnel

Components:

- `LeadFunnelCard`
- `FunnelStage`
- `FunnelConnector`

Stages:

Leads → Contacted → Responded → Qualified → Booked → Won

Clicking a stage opens `/app/leads` with the relevant status filter.

No separate funnel page.

## 12.7 Needs Attention

Components:

- `NeedsAttentionPanel`
- `AttentionItem`
- `AttentionEmptyState`

Examples:

- Lead requested a person
- Message failed
- Meta disconnected
- Booking destination missing
- Form mapping problem
- Usage limit reached

## 12.8 Recent Leads

Components:

- `RecentLeadsCard`
- `CompactLeadTable`
- `LeadStatusBadge`

Maximum 10 rows.

Click opens Lead Drawer.

## 12.9 Upcoming Bookings

Components:

- `UpcomingBookingsCard`
- `BookingListItem`
- `ExternalBookingLink`

This replaces a standalone Bookings module.

## 12.10 Source performance

Components:

- `SourcePerformanceCard`
- `SourcePerformanceTable`

Columns:

- Source
- Leads
- Replies
- Qualified
- Booked

This replaces the standalone Sources analytics tab.

## 12.11 Follow-Up performance

Components:

- `FollowUpPerformanceCard`
- `PerformanceMetricRow`

Show:

- first response latency
- replies after first message
- replies after follow-up
- message failure rate
- opt-out rate

## 12.12 Reactivation performance

Components:

- `ReactivationPerformanceCard`
- `CampaignPerformanceMiniTable`

Show recent campaigns only.

Detailed campaign data lives in Reactivation detail.

---

# 13. Leads — `/app/leads`

## 13.1 Goal

Be the primary operational inbox without becoming a CRM.

## 13.2 Page component tree

```text
<LeadsPage>
  <PageHeader />
  <LeadQuickFilters />
  <LeadsToolbar />
  <LeadFilterPopover />
  <LeadsTable />
  <LeadsPagination />
  <LeadDrawer />
</LeadsPage>
```

## 13.3 Quick filters

Components:

- `LeadQuickFilters`
- `QuickFilterChip`

Canonical quick filters:

- All
- Active
- Needs Attention
- Qualified
- Booked

No nine-status tab bar.

## 13.4 Advanced filters

Components:

- `LeadsToolbar`
- `LeadSearchInput`
- `LeadFilterButton`
- `LeadFilterPopover`
- `ActiveFilterChip`

Filter fields:

- Status
- Service
- Source
- Meta form
- Campaign
- Assigned user
- Date
- Needs attention

Status options:

- NEW
- CONTACTED
- RESPONDED
- QUALIFIED
- BOOKED
- WON
- LOST

## 13.5 Leads table

Components:

- `LeadsTable`
- `LeadTableRow`
- `LeadIdentityCell`
- `LeadStatusBadge`
- `LeadSourceBadge`
- `LeadAssigneeCell`
- `RowActionMenu`
- `LeadsPagination`

Columns:

- Lead
- Service
- Source
- Status
- Assigned
- Created
- Last Activity

Row click opens Lead Drawer.

## 13.6 Lead Drawer

### Component tree

```text
<LeadDrawer>
  <LeadDrawerHeader />
  <LeadDrawerNav />
  <LeadSummarySection />
  <LeadConversationSection />
  <LeadActivitySection />
</LeadDrawer>
```

Only three internal views:

1. Summary
2. Conversation
3. Activity

### Summary components

- `LeadDrawerHeader`
- `LeadStatusSelect`
- `LeadIdentityBlock`
- `LeadContactActions`
- `LeadOverviewGrid`
- `LeadSourceSummary`
- `QualificationSummaryCard`
- `BookingSummaryCard`
- `LeadAssignmentControl`
- `LeadManualActions`

Summary fields:

- Name
- Phone
- Email
- Service
- Postcode
- Source
- Meta form
- Campaign/ad metadata where available
- Assignee
- Status
- Needs attention
- Qualification result
- Booking state

### Conversation components

- `LeadConversationSection`
- `ConversationThread`
- `MessageBubble`
- `DeliveryStatus`
- `MessageComposer`
- `ChannelSelector`
- `SendBookingLinkButton`
- `HumanTakeoverToggle`

### Activity components

- `LeadActivitySection`
- `ActivityTimeline`
- `ActivityEvent`

Events:

- lead created
- first message
- follow-up
- reply
- qualification answer
- qualification result
- handover
- booking
- won/lost
- opt-out
- assignment change

## 13.7 Manual actions

- Send SMS
- Send WhatsApp
- Call
- Send booking link
- Mark qualified
- Mark not qualified
- Mark review
- Assign
- Human takeover
- Resume follow-up
- Mark won
- Mark lost

No broad bulk message action.

---

# 14. Follow-Up — `/app/follow-up`

## 14.1 Goal

Put all day-to-day automation and qualification configuration in one understandable place.

## 14.2 Page structure

Two internal views only:

- Follow-Up
- Qualification

### Components

- `FollowUpPage`
- `PageHeader`
- `SegmentedViewSwitch`
- `FollowUpView`
- `QualificationView`

No separate Automations and Qualification modules.

---

## 14.3 Follow-Up view

### Component tree

```text
<FollowUpView>
  <FollowUpStatusCard />
  <SequenceEditor />
  <StopConditionStrip />
  <QuietHoursCard />
  <BookingReminderCard />
  <TestFollowUpPanel />
</FollowUpView>
```

### Sequence components

- `SequenceEditor`
- `SequenceStepCard`
- `StepDelayControl`
- `StepChannelSelect`
- `MessageTemplateEditor`
- `MergeFieldMenu`
- `StepEnabledToggle`
- `AddSequenceStepButton`
- `SequenceValidationBanner`
- `PublishSequenceButton`

Canonical flow:

1. Immediately
2. +10 minutes
3. +2 hours
4. +1 day
5. +3 days

The user may edit the sequence without being exposed to a visual workflow builder.

### Merge fields

- `{{first_name}}`
- `{{business_name}}`
- `{{service_name}}`
- `{{booking_link}}`
- `{{business_phone}}`

Unknown token blocks publish.

## 14.4 Stop conditions

Components:

- `StopConditionStrip`
- `StopConditionChip`

System conditions:

- Replied
- Booked
- Won
- Lost
- Opted out
- Human takeover
- Automation paused
- Subscription inactive
- Messaging unavailable

These are visible but not turned into a routing-builder UI.

## 14.5 Quiet hours

Components:

- `QuietHoursCard`
- `TimeWindowField`
- `TimezoneLabel`

Outside the allowed window, the next send is shifted to the next valid time.

## 14.6 Booking reminders

Components:

- `BookingReminderCard`
- `BookingReminderToggle`
- `ReminderTimingField`
- `ReminderTemplateField`

This is a compact secondary configuration, not its own automation product.

---

# 15. Qualification View

## 15.1 Goal

Let the business define what a good enquiry looks like without exposing a complex rules engine.

## 15.2 Component tree

```text
<QualificationView>
  <QualificationIntroCard />
  <QualificationQuestionList />
  <QualificationPreview />
</QualificationView>
```

## 15.3 Question components

- `QualificationQuestionList`
- `QualificationQuestionCard`
- `QuestionTypeSelect`
- `QuestionRequiredToggle`
- `QuestionServiceScope`
- `QuestionOptionsEditor`
- `RuleInlineEditor`
- `QuestionDragHandle`
- `AddQuestionButton`
- `QualificationPreview`

Supported types:

- Free text
- Yes/No
- Single choice
- Number
- Postcode
- Timing

## 15.4 Inline rules

Examples:

### Yes/No

```text
Are you the property owner?

Yes → continue
No → not qualified
```

### Postcode

```text
Postcode
Allowed prefixes: BH1, BH2, BH3, BH4
```

### Timing

```text
When would you like the work?

ASAP → continue
Within 30 days → continue
Researching only → review
```

No separate Routing Rules page.

No separate Qualification Criteria tab.

No complex formula builder.

## 15.5 Canonical result

- PENDING
- QUALIFIED
- NOT_QUALIFIED
- REVIEW

Routing:

```text
QUALIFIED
→ booking or handover

REVIEW
→ needs attention

NOT_QUALIFIED
→ stop normal qualification flow
```

## 15.6 Service scope

Each question supports:

- All services
- Selected services

This replaces a dedicated service-specific rules editor.

---

# 16. Reactivation — `/app/reactivation`

## 16.1 Goal

Recover value from older eligible leads without turning ClientTurn into a marketing automation suite.

## 16.2 Page component tree

```text
<ReactivationPage>
  <PageHeader />
  <ReactivationSummary />
  <CampaignFilters />
  <CampaignTable />
  <ReactivationDetailDrawer />
</ReactivationPage>
```

## 16.3 Components

- `ReactivationSummary`
- `CampaignStatusCard`
- `CampaignSearchInput`
- `CampaignFilterPopover`
- `CampaignTable`
- `CampaignTableRow`
- `CampaignStatusBadge`
- `CreateReactivationButton`
- `ReactivationDetailDrawer`

Columns:

- Campaign
- Audience
- Sent
- Replies
- Qualified
- Booked
- Status
- Created

Statuses:

- DRAFT
- SCHEDULED
- RUNNING
- PAUSED
- COMPLETED
- CANCELLED

---

# 17. New Reactivation — `/app/reactivation/new`

Three steps only.

## 17.1 Wizard component tree

```text
<ReactivationWizard>
  <WizardProgress />
  <AudienceStep />
  <MessageTimingStep />
  <ReviewLaunchStep />
  <WizardFooterActions />
</ReactivationWizard>
```

## 17.2 Step 1 — Audience

Components:

- `AudienceSourceSelector`
- `ExistingLeadSegmentBuilder`
- `CSVImportDropzone`
- `CSVValidationSummary`
- `AudienceFilterGroup`
- `EligibilitySummary`
- `SuppressionSummary`

Sources:

- existing ClientTurn leads
- CSV import

Filters:

- older than X days
- status
- service
- source
- no reply
- lost
- not booked

Suppression:

- opted out
- invalid number
- active conversation
- recent cooldown
- booked
- won
- deleted/suppressed

## 17.3 Step 2 — Message & Timing

Components:

- `CampaignMessageEditor`
- `OptionalFollowUpEditor`
- `SendModeControl`
- `ScheduleDateTimeField`
- `QuietHoursSummary`
- `MessagePreviewCard`

Options:

- send now
- schedule

One initial message.

Optional one follow-up only.

## 17.4 Step 3 — Review & Launch

Components:

- `CampaignReviewSummary`
- `EligibleCount`
- `SuppressedCount`
- `SuppressionReasonList`
- `EstimatedMessageCount`
- `FinalMessagePreview`
- `LaunchCampaignButton`

Do not launch if no eligible contacts.

## 17.5 Campaign Detail Drawer

Components:

- `ReactivationDetailDrawer`
- `CampaignOverviewSection`
- `CampaignAudienceSummary`
- `CampaignMessageSummary`
- `CampaignResultSummary`
- `CampaignContactTable`
- `PauseCampaignButton`
- `CancelCampaignButton`

No separate campaign analytics page.

---

# 18. Settings — `/app/settings`

## 18.1 Goal

Keep all workspace configuration in one place without seven separate settings tabs.

## 18.2 Four canonical sections

1. Workspace
2. Connections
3. Team
4. Billing

### Page component tree

```text
<SettingsPage>
  <SettingsHeader />
  <SettingsSectionNav />
  <SettingsContent />
</SettingsPage>
```

Components:

- `SettingsHeader`
- `SettingsSectionNav`
- `SettingsSection`
- `SettingsSaveBar`

---

# 19. Settings — Workspace

Combines business and services.

## Components

- `WorkspaceSettingsForm`
- `BusinessIdentityCard`
- `BusinessHoursEditor`
- `ServiceAreaField`
- `ServicesTable`
- `ServiceRow`
- `ServiceEditorDrawer`
- `LogoUploader`

Fields:

- Business name
- Logo
- Industry
- Website
- Phone
- Timezone
- Business hours
- Service-area description

Services table:

- Service
- Average value
- Active
- Edit

Service Drawer:

- name
- description
- average value
- active

No separate service-specific qualification editor here.

---

# 20. Settings — Connections

Replaces the standalone Integrations page.

## Component tree

```text
<ConnectionsSettings>
  <ConnectionHealthSummary />
  <ConnectionsGrid />
  <ConnectionSetupDrawer />
</ConnectionsSettings>
```

Components:

- `ConnectionHealthSummary`
- `ConnectionsGrid`
- `ConnectionCard`
- `ConnectionStatusBadge`
- `ConnectButton`
- `ReconnectButton`
- `TestConnectionButton`
- `ConnectionSetupDrawer`

Connections:

- Meta Lead Ads
- SMS
- WhatsApp
- Calendly
- Google Calendar

Each provider gets one card.

Provider-specific configuration opens a drawer.

No user-facing Email Notifications integration.

---

# 21. Settings — Team

## Components

- `TeamSettings`
- `TeamTable`
- `TeamMemberRow`
- `InviteMemberButton`
- `InviteMemberDialog`
- `RoleSelect`
- `RemoveMemberDialog`

Roles:

- Owner
- Admin
- Member

No custom permissions editor.

---

# 22. Settings — Billing

## Components

- `BillingSettings`
- `CurrentPlanCard`
- `UsageMeters`
- `SubscriptionStatusBadge`
- `UpgradePlanButton`
- `ManageBillingButton`
- `InvoiceSummary`

Display:

- current plan
- subscription state
- billing period
- lead usage
- message usage
- user usage
- upgrade
- Stripe portal

Stripe remains authoritative.

---

# 23. Profile Popover

No profile page.

Components:

- `ProfilePopover`
- `ProfileIdentity`
- `AccountPreferencesDialog`
- `PasswordResetAction`
- `SignOutButton`

Account preferences:

- First name
- Last name
- Email
- password reset
- notification preferences

Notification preferences may include:

- human handover
- new booking
- integration failure
- campaign complete
- daily summary

---

# PART VI — Platform Administration Specifications

# 24. Admin Shell

## Components

```text
<AdminShell>
  <AdminSidebar />
  <AdminTopBar />
  <AdminContent />
  <AdminGlobalDrawerLayer />
</AdminShell>
```

Navigation:

- Overview
- Customers
- System

No additional admin domains in V1.

---

# 25. Admin Overview — `/admin`

## 25.1 Goal

Give the platform operator a concise operational and commercial snapshot.

## Component tree

```text
<AdminOverviewPage>
  <AdminOverviewHeader />
  <AdminKPIGrid />
  <ProviderHealthPanel />
  <RecentCustomersPanel />
  <ActionRequiredPanel />
  <FailedJobsPanel />
</AdminOverviewPage>
```

## Components

- `AdminOverviewHeader`
- `AdminKPIGrid`
- `AdminStatCard`
- `ProviderHealthPanel`
- `ProviderHealthRow`
- `RecentCustomersPanel`
- `RecentCustomerRow`
- `ActionRequiredPanel`
- `FailedJobsPanel`

Metrics:

- Active customers
- Trials
- MRR mirror
- New signups
- Leads processed today
- Messages today
- Bookings today
- Failed jobs

No extra dashboard pages.

---

# 26. Admin Customers — `/admin/customers`

## Component tree

```text
<AdminCustomersPage>
  <PageHeader />
  <CustomerFilters />
  <CustomerTable />
  <CustomerSupportDrawer />
</AdminCustomersPage>
```

## Components

- `CustomerSearchInput`
- `CustomerFilterPopover`
- `CustomerTable`
- `CustomerTableRow`
- `CustomerPlanBadge`
- `CustomerHealthBadge`
- `CustomerSupportDrawer`

Columns:

- Business
- Owner
- Plan
- Subscription
- Lead usage
- Message usage
- Connection health
- Joined
- Last activity

Filters:

- Trial
- Active
- Past due
- Cancelled
- Connection issue

---

# 27. Customer Support Drawer

Single scrollable support view.

## Components

- `CustomerSupportDrawer`
- `CustomerBusinessSummary`
- `CustomerMembersSummary`
- `CustomerPlanUsageSummary`
- `CustomerConnectionsSummary`
- `CustomerRecentEvents`
- `CustomerRecentErrors`
- `ResendOnboardingAction`
- `RunHealthCheckAction`
- `SuspendWorkspaceAction`

No tab explosion.

Do not show raw tokens.

Support impersonation is deferred from V1 unless operationally required later.

---

# 28. Admin System — `/admin/system`

Three internal views only:

1. Health
2. Events
3. Errors

## Component tree

```text
<AdminSystemPage>
  <SystemHeader />
  <SystemViewSwitch />
  <SystemHealthView />
  <SystemEventsView />
  <SystemErrorsView />
</AdminSystemPage>
```

---

# 29. System — Health

Combines provider health, integration failures and jobs.

## Components

- `SystemHealthView`
- `SystemHealthCards`
- `ProviderHealthTable`
- `QueueHealthTable`
- `DegradedWorkspacesTable`
- `HealthRefreshButton`

Show:

- Meta
- Twilio SMS
- WhatsApp
- Calendly
- Google Calendar
- Stripe
- background jobs

---

# 30. System — Events

Combines former Webhooks, Messaging and Billing Events tabs.

## Components

- `SystemEventsView`
- `EventTypeFilter`
- `EventProviderFilter`
- `OperationalEventTable`
- `OperationalEventRow`
- `EventStatusBadge`
- `EventDetailDrawer`
- `SafeRetryButton`

Filter types:

- Meta
- Webhook
- SMS
- WhatsApp
- Calendly
- Stripe
- Billing
- Job

Columns:

- Provider
- Type
- Business
- Status
- Attempts
- Received
- Last error

---

# 31. System — Errors

## Components

- `SystemErrorsView`
- `ErrorSeverityFilter`
- `ErrorAreaFilter`
- `ErrorTable`
- `ErrorRow`
- `ErrorDetailDrawer`
- `SentryReferenceLink`

Columns:

- Area
- Business
- Message
- Severity
- Time
- Reference

No separate errors domain.

---

# PART VII — Supabase Data Architecture

# 32. Canonical Tenant Principle

Every tenant-owned operational table carries:

```sql
business_id uuid not null
```

Even where inferable through joins.

Benefits:

- simpler RLS
- simpler support queries
- clearer indexing
- safer analytics
- easier audit

---

# 33. Canonical Tables

## Identity & workspace

- `profiles`
- `businesses`
- `business_members`
- `business_settings`
- `services`

## Qualification

- `qualification_questions`
- `qualification_options`
- `qualification_rules`
- `qualification_answers`

## Leads & messaging

- `leads`
- `lead_sources`
- `lead_assignments`
- `conversations`
- `messages`
- `message_events`
- `contact_suppressions`

## Follow-up

- `automation_definitions`
- `automation_versions`
- `automation_steps`
- `automation_runs`

## Booking

- `bookings`

## Reactivation

- `campaigns`
- `campaign_contacts`
- `imports`

## Integrations

- `integrations`
- `integration_objects`
- `field_mappings`
- `webhook_events`

## Platform

- `jobs`
- `usage_events`
- `subscriptions`
- `audit_log`

The simplified UI does **not** require the backend to collapse into five tables.

---

# 34. Core Lead Status Model

Canonical:

- NEW
- CONTACTED
- RESPONDED
- QUALIFIED
- BOOKED
- WON
- LOST

Flags:

- `needs_attention`
- `automation_active`
- `human_takeover`
- `opted_out`
- `is_test`

Qualification result is stored separately:

- PENDING
- QUALIFIED
- NOT_QUALIFIED
- REVIEW

---

# 35. Core Indexes

```text
business_members(user_id, business_id)

leads(business_id, created_at desc)
leads(business_id, status, created_at desc)
leads(business_id, assigned_user_id, status)

messages(business_id, conversation_id, created_at)
messages(provider_message_id)

webhook_events(provider, external_event_id) UNIQUE

automation_runs(state, next_run_at)

campaign_contacts(campaign_id, state)

bookings(business_id, starts_at)

usage_events(business_id, occurred_at, metric)
```

Use `timestamptz`.

Store UTC.

Convert using workspace timezone.

---

# PART VIII — Backend & Integration Architecture

# 36. Recommended Next.js Tree

```text
app/
  (marketing)/
    page.tsx
    privacy/
    terms/
    cookies/

  (auth)/
    login/
    signup/
    forgot-password/
    reset-password/

  onboarding/
    page.tsx

  app/
    layout.tsx
    page.tsx
    leads/
    follow-up/
    reactivation/
      page.tsx
      new/
    settings/

  admin/
    layout.tsx
    page.tsx
    customers/
    system/

  api/
    webhooks/
      meta/
      twilio/
      whatsapp/
      stripe/
      calendly/

    integrations/
      meta/
      calendar/

    messages/
    reactivation/
    billing/

components/
  marketing/
  auth/
  onboarding/
  app-shell/
  dashboard/
  leads/
  follow-up/
  qualification/
  reactivation/
  settings/
  admin/
  ui/

lib/
  supabase/
  auth/
  permissions/
  integrations/
  messaging/
  meta/
  billing/
  jobs/
  analytics/
  validation/
  audit/

types/
```

Default to Server Components.

Use Client Components only where interactivity requires them.

---

# 37. Integration Adapters

## Meta

Functions:

- connect
- callback
- list pages
- list forms
- subscribe
- fetch lead
- normalize lead
- verify webhook

## Messaging

Common contract:

```ts
interface MessagingProvider {
  sendMessage(input): Promise<SendResult>
  verifyWebhook(request): Promise<boolean>
  parseInbound(request): Promise<InboundMessage[]>
  parseStatus(request): Promise<MessageStatusEvent[]>
}
```

Providers:

- Twilio SMS
- WhatsApp provider

## Booking

- Calendly link + optional webhook
- Google Calendar optional conservative integration

## Billing

- Stripe Checkout
- Stripe Customer Portal
- Stripe webhooks
- entitlement mirror

## Transactional email

Resend:

- welcome
- invite
- human handover
- connection failure
- campaign completion
- billing support

---

# 38. Webhook Architecture

Every external event enters `webhook_events`.

Fields:

- provider
- external_event_id
- business_id nullable
- event_type
- payload_hash
- status
- attempts
- received_at
- processed_at
- last_error

Unique:

```text
(provider, external_event_id)
```

Duplicate event:

- return success
- do not repeat business action

---

# 39. Background Jobs

Required types:

- `lead.process`
- `message.send`
- `automation.advance`
- `message.process_inbound`
- `booking.sync`
- `campaign.expand`
- `campaign.send`
- `integration.health_check`
- `usage.aggregate`
- `retention.cleanup`

Worker rules:

- atomic claim
- retry safe
- current-state validation before external action
- capped retries
- permanent failure state
- admin visibility

---

# PART IX — Deterministic Business Logic

# 40. New Lead Processing

```text
IF workspace active
AND plan permits
AND lead not duplicate
AND contact not suppressed
AND messaging healthy

THEN
  create conversation
  create automation run
  queue first message
```

Record:

- created time
- queued time
- sent time
- delivered time

---

# 41. Follow-Up Logic

Default:

- 0 min
- 10 min
- 2 hr
- 1 day
- 3 days

Before every send:

- reload lead
- reload automation run
- reload subscription
- reload messaging health

Stop if:

- replied
- booked
- won
- lost
- opted out
- human takeover
- paused
- subscription inactive
- channel unavailable

No stale scheduled job may bypass current state.

---

# 42. Qualification Logic

Evaluation order:

1. Required questions complete?
2. Active service?
3. Service area valid?
4. Explicit hard fail?
5. Accepted values?
6. Manual review needed?
7. Result.

Logic:

```text
IF hard fail
  → NOT_QUALIFIED

ELSE IF missing required
  → PENDING

ELSE IF uncertain/manual
  → REVIEW

ELSE
  → QUALIFIED
```

Free text that cannot be reliably interpreted:

- store answer
- mark REVIEW where required
- hand to human

Do not pretend to understand it.

---

# 43. Human Handover

Set `human_takeover = true` when:

- user manually takes over
- lead requests a person
- answer cannot be matched reliably
- messaging failure needs manual action
- business configuration requires review

Effect:

- stop automated follow-up
- mark needs attention
- notify configured team member/owner

---

# 44. Booking Logic

Recommended V1:

Calendly-first.

When lead qualifies:

- if booking destination configured → send booking link
- if handover-only → mark needs attention
- if no valid destination → mark needs attention

Calendly webhook:

- create/update booking
- set lead BOOKED
- stop follow-up

No full scheduling engine.

---

# 45. Reactivation Eligibility

Eligible if:

```text
belongs to workspace
AND opted_out = false
AND valid contact
AND not WON
AND not BOOKED
AND no conflicting active automation
AND no active conversation conflict
AND outside cooldown
AND matches selected audience
```

Re-evaluate immediately before send.

---

# PART X — RLS, Security & Compliance

# 46. RLS Core Rule

All browser-accessible tenant tables use RLS.

Create helpers:

```sql
is_business_member(target_business_id uuid)

has_business_role(
  target_business_id uuid,
  allowed_roles text[]
)
```

Never trust UI visibility as security.

---

# 47. Browser Mutation Rules

Browser may not directly create provider-backed messages.

Manual send goes through server mutation.

Protected fields:

- provider ids
- ingestion ownership
- webhook status
- billing entitlement
- system timestamps where server-owned

---

# 48. Service Role Boundary

Service role only in:

- verified webhooks
- background worker
- trusted admin operation
- controlled maintenance

Never:

- browser
- public env
- localStorage
- client bundle
- user-visible network payload

---

# 49. Suppression

`contact_suppressions`

Fields:

- business_id
- normalized_contact
- channel
- reason
- source
- created_at

Recognized opt-out keywords such as STOP/UNSUBSCRIBE:

- suppress contact/channel
- stop automation
- stop reactivation sends
- audit event

Keep deterministic.

---

# 50. Audit

Audit at least:

- team invite/remove
- role change
- connection connect/disconnect
- follow-up publish
- reactivation launch/cancel
- manual lead status
- human takeover
- opt-out override attempt
- billing plan
- workspace suspension
- admin support actions

Audit log is append-only for ordinary users.

---

# PART XI — Shared UI Component Contract

# 51. Global UI Components

## Layout

- `AppShell`
- `PageHeader`
- `SectionHeader`
- `ResponsiveContainer`
- `SplitPane`
- `Drawer`
- `Sheet`
- `Dialog`

## Navigation

- `DesktopSidebar`
- `SidebarNavItem`
- `MobileNavDrawer`
- `SegmentedViewSwitch`
- `SettingsSectionNav`

## Data

- `DataTable`
- `TableHeader`
- `TableRow`
- `Pagination`
- `SearchInput`
- `FilterPopover`
- `QuickFilterChip`
- `ActiveFilterChip`

## Feedback

- `Toast`
- `InlineAlert`
- `ErrorState`
- `EmptyState`
- `Skeleton`
- `LoadingButton`
- `ConfirmationDialog`

## Status

- `StatusBadge`
- `HealthBadge`
- `PlanBadge`
- `AttentionBadge`
- `DeliveryStatus`

## Forms

- `FormField`
- `TextField`
- `TextArea`
- `SelectField`
- `SwitchField`
- `TimeField`
- `DateTimeField`
- `MultiSelect`
- `TagInput`

## Product-specific

- `LeadDrawer`
- `ConversationThread`
- `MessageComposer`
- `SequenceEditor`
- `QualificationQuestionCard`
- `RuleInlineEditor`
- `ConnectionCard`
- `CampaignTable`
- `ReactivationWizard`
- `ServiceEditorDrawer`
- `CustomerSupportDrawer`

---

# 52. Design Rules

- Bright, clean authenticated SaaS UI.
- Dense enough for daily work.
- Moderate radii.
- Thin neutral borders.
- Clear typography hierarchy.
- One primary accent.
- Green only for success/healthy.
- Amber for warning/review.
- Red for failed/action required.
- Tables on desktop.
- Sheets/cards on smaller screens.
- Primary action top-right.
- No decorative dashboard clutter.
- No giant empty cards.
- No unnecessary tabs.
- No nested sidebars.
- No page for a concept that can be safely handled in a drawer.
- No drawer for a concept that can be safely edited inline.

---

# PART XII — Responsive Product Rules

# 53. Desktop

- Fixed sidebar.
- Full data tables.
- Right-side drawers.
- Dashboard multi-column grid.
- Follow-Up sequence full width.
- Reactivation audience builder side-by-side where space permits.

# 54. Tablet

- Collapsible sidebar.
- Reduced columns.
- Drawers may become wider sheets.
- Tables preserve essential columns.
- Secondary metadata moves into expandable row content.

# 55. Mobile

- Bottom/side nav drawer.
- Dashboard stacks vertically.
- Leads become mobile list cards.
- Lead Drawer becomes full-screen sheet.
- Follow-Up sequence becomes single-column.
- Qualification questions become stacked cards.
- Reactivation wizard stays one column.
- Settings sections use top segmented navigation or compact selector.
- No horizontal page overflow.

---

# PART XIII — Build Order

# 56. Phase 0 — Foundation

Build:

- Next.js
- TypeScript
- Supabase
- migrations
- Auth
- Vercel
- Sentry
- PostHog
- shared UI
- RLS helpers
- automated RLS tests

Exit:

User can sign up and access an isolated workspace.

---

# 57. Phase 1 — Marketing & Auth

Build:

- landing page
- legal
- signup
- login
- password recovery
- acquisition attribution

Exit:

Traffic can create a workspace.

---

# 58. Phase 2 — App Shell + Leads

Build:

- app shell
- Dashboard skeleton
- Leads
- Lead Drawer
- conversation UI
- status model
- seeded fixtures

Exit:

A business can manually operate a lead.

---

# 59. Phase 3 — Onboarding + Meta + SMS

Build:

- five-step onboarding
- Meta connection
- form mapping
- webhook inbox
- lead ingestion
- Twilio SMS
- delivery
- inbound replies
- test lead

Exit:

Real Meta lead appears and receives first configured message.

---

# 60. Phase 4 — Follow-Up

Build:

- sequence definitions
- default steps
- editor
- scheduler
- quiet hours
- stop logic
- retry logic
- compact booking reminder

Exit:

No-response sequence works and stops on reply.

---

# 61. Phase 5 — Qualification

Build:

- questions
- options
- inline rules
- answers
- deterministic result
- REVIEW state
- handover

Exit:

Lead can move from reply to QUALIFIED without AI.

---

# 62. Phase 6 — Booking

Build:

- Calendly first
- booking link
- optional webhook
- Dashboard booking summary
- Lead Drawer booking summary

Google Calendar later if needed.

Exit:

Qualified lead can book and ClientTurn records it.

---

# 63. Phase 7 — Billing

Build:

- Stripe plans
- checkout
- webhook
- portal
- entitlements
- usage

Exit:

Subscription governs access.

---

# 64. Phase 8 — Reactivation

Build:

- campaign list
- 3-step wizard
- CSV import
- suppression
- pacing
- detail drawer
- campaign results

Exit:

Old eligible leads can be safely re-contacted.

---

# 65. Phase 9 — Dashboard Reporting + Admin

Build:

- source performance
- follow-up performance
- reactivation summary
- admin overview
- customers
- system health/events/errors

Exit:

Customer and operator can diagnose product performance.

---

# 66. Phase 10 — Launch Hardening

Required:

- cross-tenant tests
- RLS tests
- webhook replay
- duplicate lead/message tests
- queue failure tests
- provider disconnect tests
- Stripe state tests
- opt-out tests
- rate limiting
- backups
- error alerts
- production domain
- email delivery
- legal review
- support process
- performance tests
- mobile QA

---

# PART XIV — Acceptance Criteria

# 67. Commercial V1 Acceptance Matrix

| Area | Must be true |
|---|---|
| Landing | Visitor understands offer and reaches signup |
| Signup | User creates workspace |
| Onboarding | Setup completes in five steps and resumes |
| RLS | Tenant isolation holds |
| Meta | Correct form maps to correct business |
| Idempotency | Duplicate webhook does not duplicate lead |
| SMS | First message sends automatically |
| Reply | Inbound reply resolves correctly |
| Follow-Up | Due steps send correctly |
| Stop logic | Reply/booking/opt-out stops sequence |
| Qualification | Rules produce deterministic result |
| Review | Ambiguous answer becomes REVIEW |
| Booking | Qualified lead gets valid booking/handover path |
| Dashboard | Funnel and source data reconcile |
| Reactivation | Suppression runs before send |
| Billing | Stripe entitlement controls access |
| Admin | Failure can be diagnosed |
| Mobile | Core workflow usable |
| Security | Provider secrets never reach browser |

---

# 68. KPI Definitions

## Activation

Activated when:

- Meta connected
- form selected
- messaging healthy
- test lead passed
- follow-up published

## Speed to lead

```text
first outbound sent_at - lead created_at
```

## Reply rate

```text
leads with inbound reply / contacted leads
```

## Qualification rate

```text
qualified leads / responded leads
```

## Booking rate

```text
booked leads / total leads
```

Also optionally:

```text
booked leads / qualified leads
```

Label denominator clearly.

## Reactivation response rate

```text
reactivated contacts replied / delivered campaign contacts
```

## Estimated pipeline

```text
sum(service.average_value for selected qualified/booked leads)
```

Always label:

**Estimated Pipeline**

Never revenue.

---

# PART XV — Product Expansion Guardrails

# 69. Allowed Later Additions

Only after customer demand:

- generic website lead webhook
- Zapier/Make outbound events
- basic CRM push
- agency multi-workspace
- more calendar providers
- call tracking
- simple assignment rules
- richer source reporting
- optional booking-detail page if genuinely needed
- optional full analytics module if dashboard becomes insufficient

# 70. Explicitly Rejected Early Additions

- full CRM
- separate contacts module
- companies/accounts
- tasks
- projects
- quoting
- invoicing
- accounting
- social posting
- ad creation
- document management
- visual workflow canvas
- proprietary calendar
- voice bot
- AI agent
- ML scoring
- contact centre
- large notification centre
- custom role builder
- admin impersonation unless operationally required

---

# 71. Final Canonical V2 Definition

ClientTurn V1 consists of:

- **1 major landing page**
- **3 legal pages**
- **4 auth pages**
- **1 five-step onboarding wizard**
- **5 primary customer destinations**
- **1 reusable Lead Drawer**
- **1 three-step Reactivation wizard**
- **4 Settings sections**
- **3 platform-admin routes**
- **1 Customer Support Drawer**
- **3 System views**
- Supabase PostgreSQL
- Supabase Auth
- strict RLS
- Meta Lead Ads
- SMS
- optional WhatsApp
- Calendly first
- optional Google Calendar
- Stripe
- Resend
- deterministic follow-up
- deterministic qualification
- reactivation
- source-to-booking reporting
- no AI
- no ML
- no full CRM
- no workflow-builder complexity

The daily customer experience should be explainable in one sentence:

> **Dashboard shows what is happening, Leads is where you work, Follow-Up controls what ClientTurn does, Reactivation works old leads, and Settings configures the workspace.**

That is the canonical V1 product boundary.

Anything that makes this explanation materially harder should be treated as scope creep.
# APPENDIX A — Final Simplified Navigation & Sub-Tab Map
| Primary area | Route | Sub-tabs / major internal surfaces | Explicitly not a separate module |
| --- | --- | --- | --- |
| Dashboard | /app | Funnel drilldown; Needs Attention; Recent Leads; Upcoming Bookings; Source/Follow-Up/Reactivation performance sections | Analytics, Bookings |
| Leads | /app/leads | Quick filters: All, Active, Needs Attention, Qualified, Booked. Lead Drawer tabs: Summary, Conversation, Activity. | Contacts, CRM profiles, Booking profile, Qualification profile |
| Follow-Up | /app/follow-up | Tabs: Follow-Up, Qualification. Follow-Up panels: sequence, stop conditions, quiet hours, booking reminder. Qualification: questions + inline rules + result logic. | Automations module, Qualification module, Workflow Builder |
| Reactivation | /app/reactivation | Campaign list; 3-step wizard: Audience, Message & Timing, Review & Launch; Campaign Detail drawer. | General Campaigns/Marketing Automation |
| Settings | /app/settings | Workspace, Connections, Team, Billing. | Integrations module, separate Services page, separate Account page |
| Admin | /admin, /admin/customers, /admin/system | System tabs: Health, Events, Errors. Customer Support detail drawer. | Separate Webhooks/Messaging/Billing Events admin modules |

# APPENDIX B — Explicitly Removed / Deferred Surfaces
| Removed/deferred | Replacement / reason |
| --- | --- |
| Standalone /app/qualification | Qualification tab under Follow-Up. |
| Standalone /app/bookings | Dashboard booking widget + Lead Drawer booking summary + external provider. |
| Standalone /app/analytics | Dashboard reporting + Campaign Detail results. |
| Standalone /app/integrations | Settings → Connections. |
| Nine lead status tabs | Five quick filters + full status filter. |
| Lead Drawer Qualification tab | Qualification summary in Lead Summary. |
| Lead Drawer Booking tab | Booking summary in Lead Summary. |
| Seven Settings tabs | Workspace, Connections, Team, Billing only. |
| Notification Centre | Attention indicator/panel + email/system alerts. |
| Service-specific qualification page | Question-level service scope; later expansion if demanded. |
| Separate Unresponsive Lead automation | Part of the single new-lead follow-up sequence. |
| Admin Webhooks/Messaging/Billing Event tabs | Unified System → Events with filters. |
| Support impersonation | Deferred due security/audit complexity. |
