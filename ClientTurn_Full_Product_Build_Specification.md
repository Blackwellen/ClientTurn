# Client Turn

Full Product Build Specification Meta Lead → Instant Follow-Up →
Qualification → Booking → Revenue \> Build principle \> This product is
deliberately narrow. Every feature must improve one of six stages: lead
capture, speed-to-lead, response, qualification, booking, or revenue
attribution. It must not become a general CRM, marketing suite, or
enterprise workflow platform.

Version: MVP / Commercial V1 • Target: UK home-service businesses buying
Facebook & Instagram leads • Architecture: Next.js + Supabase +
server-side integrations

# Document map

  -----------------------------------------------------------------------
  Section                             What it defines
  ----------------------------------- -----------------------------------
  1\. Product definition              Target market, positioning,
                                      pricing, success metrics and
                                      exclusions.

  2\. Information architecture        Every public, app, settings, admin
                                      and wizard route.

  3\. Landing page build              The single marketing page and every
                                      section/component required to sell.

  4\. Customer application            Detailed component-by-component UI
                                      and behavior.

  5\. Onboarding                      Activation wizard and integration
                                      setup.

  6\. Technical architecture          Services, boundaries and
                                      deployment.

  7\. Data model                      Supabase/Postgres tables,
                                      relationships and indexes.

  8\. RLS & permissions               Tenant isolation, policies and
                                      service-role boundaries.

  9\. Integrations                    Meta, messaging, calendars, Stripe,
                                      email, analytics, monitoring and
                                      AI.

  10\. Events & queues                Webhooks, idempotency, retries,
                                      jobs and realtime.

  11\. Algorithms                     Qualification, prioritization,
                                      follow-up, handover, reactivation
                                      and attribution.

  12\. Backend API                    Endpoints, server actions and
                                      background jobs.

  13\. Security/compliance            Consent controls, secrets,
                                      auditability and retention.

  14\. Admin                          Minimum viable platform operations.

  15\. External-system boundary       How to connect other products
                                      without bloating this one.

  16\. UI system                      Reusable components and interaction
                                      rules.

  17\. Observability                  Product analytics, operational
                                      metrics and audit.

  18\. Build sequence                 Exact implementation order.

  19\. Acceptance criteria            Launch gates.

  20\. Sales/Meta plan                How to sell the product.

  21\. Decisions to lock              Choices developers should not
                                      reopen without evidence.
  -----------------------------------------------------------------------

# 1. Product definition

## 1.1 One-sentence product

Client Turn automatically receives new Meta Lead Ads enquiries, contacts
them within seconds by SMS and/or WhatsApp, asks simple qualification
questions, follows up when they go quiet, and moves qualified leads into
a booking or human sales handover. \## 1.2 Initial target market Launch
only at UK home-service businesses that already buy leads from Facebook
or Instagram. This is narrower than 'small businesses' because the pain
is measurable and one extra converted job can pay for months of
software. \| Priority \| Vertical \| Why it is attractive \| \| --- \|
--- \| --- \| \| 1 \| Roofing \| High job values, common Meta lead
generation, speed to quote matters. \| \| 2 \| Windows & doors \|
High-value enquiries, structured qualification, appointment-led sales.
\| \| 3 \| Driveways / paving \| Local lead generation, visual ads,
quote appointment is natural. \| \| 4 \| Landscaping \| Local targeting,
seasonal lead flow, simple service/location qualification. \| \| 5 \|
Kitchens / bathrooms \| High-value jobs, consultation booking. \| \| 6
\| Builders / extensions \| High ticket; useful early filtering by
project type, area and timing. \| \| 7 \| Plumbing / electrical \|
Urgent enquiries benefit strongly from response speed. \| \| 8 \|
Cleaning / removals \| Higher lead volume and simple booking/quote
workflows. \|

## 1.3 Ideal customer profile

-   Owner-led or small sales team, normally 1--20 staff.
-   Already spends money on Meta, an agency, or lead generation.
-   Receives at least 20 inbound leads per month.
-   Currently follows up manually, inconsistently, or from multiple
    phones/inboxes.
-   Can name a clear conversion event: booked quote, site visit, survey,
    consultation, call, or job.
-   Has enough gross profit per sale that £79--£249/month is easy to
    justify if conversion improves. \## 1.4 Core jobs-to-be-done \| Job
    \| Customer thought \| Product response \| \| --- \| --- \| --- \|
    \| Respond instantly \| I cannot watch Facebook all day. \| Webhook
    capture + immediate message. \| \| Stop lead leakage \| Half these
    people never answer. \| Timed automated follow-up. \| \| Filter poor
    leads \| I only want jobs in my area / service type. \|
    Qualification rules. \| \| Get appointments \| I need them in the
    diary. \| Calendar or booking-link handoff. \| \| Know what works \|
    Which ads actually generate work? \| Source-to-booking attribution.
    \| \| Recover sunk spend \| I have hundreds of old enquiries. \|
    Reactivation campaign. \|

## 1.5 Product promise and positioning

> Primary promise Never waste another Facebook lead. Client Turn
> contacts paid leads quickly, keeps following up, qualifies them and
> gets sales-ready enquiries into the diary.

Secondary promise: recover more value from leads the business has
already paid for, without replacing its CRM, agency or calendar. \## 1.6
Commercial offer \| Plan \| Price \| Recommended entitlement \| \| ---
\| --- \| --- \| \| Starter \| £79/month \| 100 new leads, SMS, 1 user,
one booking integration, standard follow-up. \| \| Growth \| £149/month
\| 500 new leads, SMS + WhatsApp, 3 users, AI qualification,
reactivation. \| \| Pro \| £249/month \| 1,500 new leads, 10 users,
advanced routing, campaigns, priority support. \|

Recommended launch mechanic: 14-day trial or first 25 leads free. The
onboarding objective is activation, not feature exploration. \## 1.7
Success metrics \| Metric \| Definition \| \| --- \| --- \| \|
Activation rate \| Signup → Meta connected + messaging connected + test
lead passed. \| \| Time to first value \| Signup → first successful
automated response. \| \| Speed-to-lead \| Lead received → first
outbound message. \| \| Reply rate \| Leads that send at least one
reply. \| \| Qualification rate \| Responded leads meeting business
rules. \| \| Booking rate \| New leads → booking/qualified handover. \|
\| Recovered leads \| Old leads reactivated → replies/bookings. \| \|
Gross margin \| Revenue less messaging, AI and provider usage. \| \|
Logo churn \| Cancelled customers / active customers. \|

## 1.8 Explicit non-goals

-   No full CRM pipeline builder.
-   No social media publishing or ad manager.
-   No project management, invoicing, estimates, accounting, files or
    e-signatures.
-   No complex omnichannel contact centre.
-   No Zapier-style freeform workflow canvas.
-   No proprietary calendar/scheduling engine.
-   No enterprise multi-brand hierarchy at launch.
-   No voice AI until text conversion economics are proven. \# 2.
    Information architecture \## 2.1 Public surface \| Route \| Page \|
    Purpose \| \| --- \| --- \| --- \| \| / \| Main landing page \|
    Hero, pain, demo, how it works, industries, reactivation, analytics,
    pricing, FAQ, CTA. \| \| /login \| Login \| Authentication. \| \|
    /signup \| Signup \| Create workspace and start onboarding. \| \|
    /privacy \| Privacy \| Legal/static. \| \| /terms \| Terms \|
    Legal/static. \| \| /cookies \| Cookies \| Cookie/privacy preference
    support. \|

No separate pricing or how-it-works page at launch. One conversion page
keeps acquisition simple. \## 2.2 Authenticated app \| Route \| Page \|
Tabs / subviews \| \| --- \| --- \| --- \| \| /app \| Dashboard \|
Overview. \| \| /app/leads \| Leads \| All, New, Contacted, Responded,
Qualified, Booked, Won, Lost, Needs Attention. \| \| /app/automations \|
Automations \| New Lead, Booking Reminder, Unresponsive. \| \|
/app/agent \| AI Receptionist \| Identity, Knowledge, Qualification,
Rules, Handover. \| \| /app/bookings \| Bookings \| Upcoming, Completed,
Cancelled. \| \| /app/campaigns \| Reactivation \| Campaign list +
Create Campaign wizard. \| \| /app/analytics \| Analytics \| Overview,
Sources, Agent, Campaigns. \| \| /app/integrations \| Integrations \|
Meta, Messaging, Calendar, Notifications. \| \| /app/settings \|
Settings \| Business, Services, Team, Notifications, Messaging, Billing,
Account. \|

## 2.3 Admin surface

  -----------------------------------------------------------------------
  Route                   Page                    Tabs
  ----------------------- ----------------------- -----------------------
  /admin                  Admin Overview          Overview.

  /admin/customers        Customers               All, Trials, Active,
                                                  Past Due, Cancelled.

  /admin/system           System                  Integrations, Webhooks,
                                                  Messaging, AI Usage,
                                                  Billing Events, Errors.
  -----------------------------------------------------------------------

## 2.4 Wizards

  -----------------------------------------------------------------------
  Wizard                              Steps
  ----------------------------------- -----------------------------------
  Initial onboarding                  Business → Services → Qualification
                                      → Meta → Messaging → Booking → Test
                                      → Activate.

  Reactivation campaign               Audience → Message → Timing →
                                      Compliance/Preview → Launch.

  Meta reconnect                      Authenticate → Page → Form(s) →
                                      Field mapping → Test.

  Messaging setup                     Provider/number → sender identity →
                                      opt-out copy → Test.

  Calendar setup                      Provider → calendar/event type →
                                      behavior → Test.
  -----------------------------------------------------------------------

# 3. Single major landing page - full build

## 3.1 Sticky header

Logo left. Anchors: How It Works, Results, Pricing, FAQ. Right: Log in
and primary CTA Start Free. Mobile: compact menu and persistent CTA. \##
3.2 Hero Eyebrow: For UK trades running Meta lead ads. H1: Turn Facebook
leads into booked jobs - automatically. Supporting copy explains instant
contact, follow-up, qualification and booking. Product visual shows Lead
→ Message → Reply → Qualified → Booking. \## 3.3 Cost-of-delay problem
Before/after timeline: lead arrives, slow manual response loses customer
vs automated response in seconds. \## 3.4 Outcome strip Respond faster;
follow up automatically; qualify before you call; book more quotes. \##
3.5 How it works Connect Meta → lead arrives → message + qualification →
booking/handover. Avoid API jargon. \## 3.6 Product demo panel Scripted
phone conversation next to funnel/status cards. Show service, postcode,
timescale and booked state. \## 3.7 Why it works Speed, persistence,
consistency, qualification and attribution. Explain practical business
logic rather than AI hype. \## 3.8 Industries Roofers, windows/doors,
driveways, landscaping, kitchens/bathrooms, builders,
plumbing/electrical. \## 3.9 Reactivation You already paid for the old
leads. Show old lead segment → re-contact → reply → quote. \## 3.10
Analytics Show source/campaign → leads → replies → qualified → booked →
won. \## 3.11 Integrations Meta Lead Ads, SMS, WhatsApp, Google
Calendar/Calendly. Keep strip short. \## 3.12 Pricing Starter, Growth,
Pro. Growth recommended. \## 3.13 FAQ Facebook connection, existing CRM,
SMS/WhatsApp, AI behavior, opt-out, old leads, trial, cancellation. \##
3.14 Final CTA Stop paying for leads you reply to too late. Start Free.
\## 3.15 Footer Company/legal/support/login links. \## 3.16 Landing
component inventory \| Component \| Behavior \| \| --- \| --- \| \|
Navbar \| Sticky, anchor scroll, CTA visible. \| \| Hero funnel mockup
\| Lightweight staged animation, no expensive video dependency. \| \|
Conversation demo \| 3--5 message bubbles with deterministic animation.
\| \| Metric cards \| Use product/demo metrics until real proof exists;
never fabricate customer claims. \| \| Industry cards \| Swap example
service/booking copy. \| \| Pricing cards \| Plan comparison and
signup/checkout action. \| \| FAQ accordion \| Accessible keyboard
support. \| \| CTA tracking \| Record section/creative source in product
analytics. \| \| Footer \| Legal, company identity, support. \|

# 4. Customer application - page-by-page

## 4.1 `/app` Dashboard

-   Top bar: workspace name, date range, integration-health status,
    notification bell.

-   KPI cards: New Leads, Contacted, Replies, Qualified, Bookings,
    Booking Rate.

-   Conversion funnel; clicking a stage opens the Leads page filtered to
    that status.

-   Estimated pipeline from service average values; always label
    estimated.

-   Recent Leads table with 8--10 rows.

-   Needs Attention panel for human handovers, message failures, Meta
    disconnects and booking errors.

-   Source performance mini-table.

-   Setup-health banner remains until activation is complete. \## 4.2
    `/app/leads` Leads

-   Header metrics: count, reply rate, average response latency.

-   Status tabs and secondary filters for date, service, campaign/form,
    assignee and source.

-   Search by name, phone, email, postcode.

-   Table columns: Lead, Service, Source, Status, Assigned To, Created,
    Last Contact.

-   Click opens a right-side Lead Detail drawer, not a new page.

-   Drawer: contact, source attribution, qualification answers,
    conversation, booking and timeline.

-   Actions: Call, SMS, WhatsApp, Book, Human Takeover, Resume AI, Mark
    Won, Mark Lost. \## 4.3 `/app/automations` Automations

-   Three predefined cards: New Lead Follow-Up, Booking Reminder,
    Unresponsive Lead.

-   Editor is a vertical sequence, never a freeform canvas.

-   Step fields: delay, channel, message template, stop conditions.

-   Global stop conditions: replied, booked, opted out, lost, human
    takeover.

-   Preview personalization tokens.

-   Test action sends only to workspace owner/test number.

-   Version model: Draft → Publish; one active version. \## 4.4
    `/app/agent` AI Receptionist

-   Identity: display name and tone.

-   Knowledge: business summary, services, service areas, hours, FAQs,
    pricing guidance if explicitly allowed.

-   Qualification: ordered questions, required flags and simple
    acceptance rules.

-   Rules: prohibited promises, escalation topics, out-of-area behavior,
    unknown-answer behavior.

-   Handover: human request, complaints, AI uncertainty,
    high-value/complex exceptions.

-   Simulator for testing replies.

-   AI may never invent availability, binding quotes, guarantees or
    unsupported service areas. \## 4.5 `/app/bookings` Bookings

-   Tabs Upcoming, Completed, Cancelled.

-   Calendar/list toggle.

-   Fields: lead, service, date/time, postcode/address where collected,
    assignee, external event id, status.

-   Actions: open lead, provider reschedule link, cancel, mark complete.

-   Connected calendar remains source of truth where appropriate. \##
    4.6 `/app/campaigns` Reactivation

-   Campaign list with audience, sent, replies, qualified, bookings,
    status.

-   Create Campaign wizard.

-   Audience sources: existing leads or CSV import.

-   Segments: no response, old enquiry, custom filters.

-   Suppress opted-out, invalid, active-conversation, recent-contact and
    already-booked/won leads.

-   Campaign results reuse Lead Drawer. \## 4.7 `/app/analytics`
    Analytics

-   Overview: leads, reply rate, qualification rate, booking rate, won
    rate, estimated pipeline.

-   Sources: Meta page/form/campaign/ad identifiers where available.

-   Agent: conversations, AI-handled %, human handovers, response
    latency.

-   Campaigns: sent/delivered/replied/qualified/booked.

-   Global date range and service filters. \## 4.8 `/app/integrations`
    Integrations

-   Meta card: connected page/forms, webhook status, last event,
    reconnect/manage forms.

-   Messaging card: SMS/WhatsApp provider, sender, delivery health, test
    message.

-   Calendar card: provider, selected calendar/event type, booking mode,
    test.

-   Notifications card: email operational notifications; add
    Slack/webhook later only if demanded.

-   Every card shows status, last success/error and a repair action. \##
    4.9 `/app/settings` Settings

-   Business: name, logo, website, phone, timezone, hours, service
    region.

-   Services: name, active, average value, service-specific
    qualification overrides.

-   Team: member, role, notifications, assignment availability.

-   Notifications: human takeover, booking, integration failure, daily
    summary.

-   Messaging: sender identity, signature, opt-out wording, quiet hours.

-   Billing: plan, usage, Stripe portal, invoices, upgrades.

-   Account: profile, password, MFA later, sessions, delete account.
    \# 5. Activation and onboarding wizard Persist after every step. A
    customer has no value until a lead can enter and a compliant message
    can leave. \| Step \| UI \| Writes / side effects \| Completion \|
    \| --- \| --- \| --- \| --- \| \| 1 Business \| Name, vertical,
    website, timezone, phone \| businesses, business_settings \|
    Required fields valid. \| \| 2 Services \| Add/edit services and
    values \| services \| At least one active service. \| \| 3
    Qualification \| Template questions + edit \|
    qualification_questions \| Configured or explicit skip. \| \| 4 Meta
    \| Connect account; select Page/Form(s); map fields \| integrations,
    integration_objects, mappings \| Webhook/form test works. \| \| 5
    Messaging \| SMS/WhatsApp; sender details \| integrations, messaging
    config \| Test message succeeds. \| \| 6 Booking \| Google Calendar
    / Calendly / handover-only \| booking_settings, integrations \|
    Provider works or handover chosen. \| \| 7 Test \| Synthetic lead
    through real internal pipeline \| test lead/conversation/message \|
    Visible successful test. \| \| 8 Activate \| Review and switch live
    \| business status, automation publish \| All required checks green.
    \|

-   Do not activate without a healthy outbound channel.

-   Do not activate a Meta form until field mapping is tested.

-   Tag test leads and exclude them from production analytics.

-   Default messages must be editable before publishing.

-   Every step has Back, Save & Exit, Continue. \# 6. Technical
    architecture \| Layer \| Choice \| Reason \| \| --- \| --- \| --- \|
    \| Frontend/BFF \| Next.js App Router on Vercel \| Fast SaaS
    development and server routes/actions. \| \| Database \| Supabase
    Postgres \| Relational model, RLS and managed platform. \| \| Auth
    \| Supabase Auth \| Straightforward workspace authentication. \| \|
    Storage \| Supabase Storage \| Logo and limited CSV/import
    artefacts. \| \| Background jobs \| Durable queue/worker mechanism
    \| Acknowledge webhooks quickly and process asynchronously. \| \|
    Billing \| Stripe Billing + Customer Portal \| Subscriptions,
    invoices, payment methods. \| \| Messaging \| Twilio SMS + Twilio
    WhatsApp or Meta WhatsApp Cloud API \| Adapter-based implementation.
    \| \| Email \| Resend \| Transactional operational mail. \| \|
    Calendar \| Google Calendar and/or Calendly \| Avoid building
    scheduling. \| \| Analytics \| PostHog \| Activation and product
    funnel tracking. \| \| Monitoring \| Sentry \|
    Application/integration errors. \| \| AI \| Provider abstraction
    over cost-effective LLM \| Structured extraction + bounded replies.
    \|

## 6.1 Service boundaries

  -----------------------------------------------------------------------
  Module                              Responsibility
  ----------------------------------- -----------------------------------
  Web App                             UI, authenticated reads/writes,
                                      onboarding.

  Webhook Gateway                     Meta, messaging, Stripe, calendar
                                      ingress.

  Lead Ingestion                      Normalize, dedupe, create source
                                      attribution.

  Conversation Engine                 Outbound steps, inbound replies,
                                      stop conditions.

  Qualification Engine                State machine and structured
                                      answers.

  AI Adapter                          Classification, extraction and
                                      bounded response text.

  Booking Adapter                     Booking link/event/handover.

  Campaign Engine                     Audience, suppression, paced
                                      reactivation.

  Analytics                           Funnel/source aggregation.

  Notifications                       Handover and integration alerts.

  Admin Ops                           Health, retries, usage, customer
                                      support.
  -----------------------------------------------------------------------

# 7. Supabase/Postgres data model

All tenant-owned operational tables carry `business_id`. This makes RLS,
indexes, support and analytics easier to reason about. \| Table \| Key
fields \| Purpose \| \| --- \| --- \| --- \| \| profiles \| id/auth user
id, name, phone, platform_role \| User profile. \| \| businesses \| id,
name, industry, timezone, website, phone, status, onboarding_state \|
Tenant. \| \| business_members \| business_id, user_id, role, status \|
Membership. \| \| business_settings \| business_id, hours, region,
messaging settings \| Tenant config. \| \| services \| id, business_id,
name, active, average_value \| Services. \| \| qualification_questions
\| business_id, service_id?, prompt, type, required, position, rules \|
Questions. \| \| leads \| business_id, external_id, identity,
service_id, status, source_id, timestamps \| Core lead. \| \|
lead_sources \| business_id, provider, page/form/campaign/ad ids,
metadata \| Attribution. \| \| lead_assignments \| lead_id, business_id,
user_id, assigned/unassigned timestamps \| Assignment history. \| \|
conversations \| business_id, lead_id, channel, state, human_takeover,
last_message_at \| Conversation. \| \| messages \| business_id,
conversation_id, direction, provider_id, status, body, cost, times \|
Messages. \| \| message_events \| message_id, business_id, event_type,
occurred_at \| Delivery/status history. \| \| automation_definitions \|
business_id, type, name \| Logical automation. \| \| automation_versions
\| business_id, automation_id, version, status, published_at \|
Versioning. \| \| automation_steps \| business_id, version_id, position,
delay, channel, template, conditions \| Sequence steps. \| \|
automation_runs \| business_id, lead_id, version_id, state, next_step,
next_run_at \| Lead execution state. \| \| qualification_answers \|
business_id, lead_id, question_id, raw/normalized answer, confidence \|
Extracted answers. \| \| bookings \| business_id, lead_id, provider,
external id, starts/ends, status, assignee \| Appointments. \| \|
campaigns \| business_id, name, status, segment, schedule \|
Reactivation. \| \| campaign_contacts \| campaign_id, business_id,
lead_id, state, sent_at, stopped_reason \| Campaign member. \| \|
integrations \| business_id, type, status, secret/config reference,
scopes, health fields \| Connections. \| \| integration_objects \|
business_id, integration_id, object_type, external_id, name, enabled \|
Pages/forms/calendars. \| \| webhook_events \| provider,
external_event_id, business_id?, status, attempts, hash/ref, received_at
\| Webhook inbox/idempotency. \| \| jobs \| business_id?, type, payload,
status, run_at, attempts, lock/error \| Async jobs if DB queue used. \|
\| usage_events \| business_id, metric, quantity, unit_cost, source,
occurred_at \| Usage/cost. \| \| subscriptions \| business_id, Stripe
ids, plan, status, period_end \| Entitlements mirror. \| \|
notifications \| business_id, user_id, type, title, body, read_at \|
In-app alerts. \| \| audit_log \| business_id, actor, action, entity,
metadata, created_at \| Audit. \|

## 7.1 Critical indexes

-   `business_members(user_id, business_id)` unique.
-   `leads(business_id, created_at desc)` and
    `(business_id, status, created_at desc)`.
-   `messages(business_id, conversation_id, sent_at)` plus unique
    provider message id.
-   `webhook_events(provider, external_event_id)` unique.
-   `automation_runs(status, next_run_at)` partial for due work.
-   `campaign_contacts(campaign_id, state)`.
-   `bookings(business_id, starts_at)`.
-   `usage_events(business_id, occurred_at, metric)`.
-   Add JSONB GIN indexes only when real queries prove the need. \# 8.
    Row Level Security and permissions Enable RLS on every exposed
    tenant table. Pair Postgres grants with explicit policies. The
    Supabase service-role key bypasses RLS and therefore belongs only in
    trusted server/webhook/worker environments. \| Role \| Meaning \|
    Permissions \| \| --- \| --- \| --- \| \| owner \| Workspace owner
    \| All tenant data, billing, team, integrations, deletion. \| \|
    admin \| Workspace admin \| Operational data/config except
    ownership-sensitive actions. \| \| member \| Sales/ops \| Leads,
    conversations, bookings, permitted analytics. \| \| viewer \|
    Optional read-only \| Read dashboards/leads only. \| \|
    platform_admin \| Internal support \| Trusted admin server path
    only. \| \| service_role \| Automation/backend \| Server-only RLS
    bypass. \|

## 8.1 Policy pattern

-   Create helper `is_business_member(target_business_id)` backed by
    indexed `business_members`.
-   Create separate SELECT, INSERT, UPDATE and DELETE policies.
-   SELECT requires active membership.
-   INSERT uses `WITH CHECK` to ensure the inserted `business_id`
    belongs to the user.
-   UPDATE requires membership and role; prevent moving records to
    another business.
-   Delete should be rare; operational records are normally
    immutable/soft-deleted.
-   Raw integrations, jobs, webhook payloads, usage and audit tables are
    server-only.
-   Automate cross-tenant RLS tests for reads and writes. \| Data class
    \| Client access \| \| --- \| --- \| \| Business/settings \| Members
    read; owner/admin mutate. \| \| Leads \| Members read; constrained
    operational edits. \| \| Messages \| Read; sends go through server
    action, not direct insert. \| \| Automation config \| Members read;
    owner/admin publish/edit. \| \| Bookings \| Read; creation/update
    through booking service. \| \| Integrations \| Owner/admin metadata
    only; secrets server-only. \| \| Subscriptions \| Owner/admin read;
    webhook/server writes. \| \| Webhooks/jobs/usage/audit \| No direct
    customer table access. \|

# 9. Integrations - full behavior

## 9.1 Meta Lead Ads

Customer authenticates Meta, selects Page and Lead Form(s). A webhook
notifies Client Turn when lead activity occurs. Verify the provider
event, resolve the selected form to the workspace, fetch/normalize
permitted lead data as required, deduplicate by external id, create
source attribution, and enqueue processing. Acknowledge the webhook
quickly rather than sending messages synchronously inside the webhook
request. \## 9.2 SMS A provider adapter receives normalized send
requests and stores the provider message id. Delivery webhooks update
status. Inbound messages resolve sender/number to the correct
conversation and trigger the conversation engine. Keep provider-specific
logic behind an adapter. \## 9.3 WhatsApp Use Twilio WhatsApp or Meta
WhatsApp Cloud API behind the same messaging interface. Observe provider
template/session requirements and delivery/inbound webhooks. The rest of
the product should not care which WhatsApp implementation is used. \##
9.4 Google Calendar OAuth connection remains server-side. Workspace
selects a target calendar. Booking action either creates an event after
qualification or sends a controlled booking link depending on
configuration. Store external event ids for reconciliation. \## 9.5
Calendly Store the selected event type/booking link and send it when
booking-ready. Ingest booking events if supported in the chosen
implementation. This is the simplest early scheduling path. \## 9.6
Stripe Stripe is authoritative for subscription status. Checkout
creates/changes the subscription; verified webhooks mirror
plan/status/period end into `subscriptions`; the Stripe Customer Portal
handles cards and invoices. \## 9.7 Resend Transactional emails only:
onboarding, human handover, integration failure, daily summary and
account notifications. \## 9.8 PostHog Track acquisition/activation
events and product usage, but never send message bodies or unnecessary
sensitive lead data. \## 9.9 Sentry Capture exceptions and integration
failures. Tag with provider, business id/internal event id where
appropriate, without dumping secrets or raw lead payloads. \## 9.10 AI
provider Use one server adapter. Inputs are approved business context,
conversation state and qualification goals. Prefer structured JSON
output for classification/extraction, then separately generate short
customer-facing replies. \## 9.11 Integration health \| Status \|
Meaning \| UI \| \| --- \| --- \| --- \| \| healthy \| Recent
operation/test succeeded \| Green. \| \| degraded \| Transient failures
\| Amber warning. \| \| action_required \| Expired
auth/permissions/sender failure \| Red reconnect/fix CTA; pause affected
actions. \| \| disconnected \| No valid connection \| Setup CTA. \| \|
testing \| Setup verification running \| Testing state. \|

# 10. Event, webhook and queue architecture

## 10.1 New lead end-to-end

1.  Meta webhook reaches `/api/webhooks/meta`.
2.  Verify authenticity/challenge and parse safely.
3.  Insert/find idempotent `webhook_events` record.
4.  Resolve Page/Form to `business_id`.
5.  Fetch/normalize full lead data if needed.
6.  Upsert lead and source attribution.
7.  Emit `lead.created` internal job.
8.  Validate active subscription and integration health.
9.  Create conversation and automation run.
10. Queue immediate outbound message.
11. Messaging adapter sends and records provider id/status.
12. Delivery webhook updates message.
13. Inbound reply creates `message.received` event.
14. Qualification engine extracts answers and decides next question,
    handover or booking.
15. Realtime/query refresh updates lead/conversation UI.
16. Domain state changes append to timeline/audit. \## 10.2 Idempotency
    and retries

-   Every external webhook must have a deterministic idempotency key.
-   Every job handler must be retry-safe.
-   Outbound sends should have a client-generated send id/key where
    feasible.
-   Never duplicate leads, messages, bookings or subscription
    transitions because a provider retried.
-   5xx/timeouts use exponential backoff; permanent 4xx errors become
    action-required.
-   Rate limits requeue according to provider guidance.
-   Expired auth pauses affected actions and creates a visible reconnect
    task.
-   AI malformed output gets one constrained repair attempt then
    deterministic fallback/handover. \## 10.3 Realtime strategy Use
    Supabase Realtime selectively for conversations, lead status and
    notifications. Do not subscribe every analytics card to every table.
    Analytics can use server queries/materialized aggregates and refresh
    on navigation or short intervals. \# 11. Algorithms and state
    machines \## 11.1 Lead lifecycle Canonical funnel: NEW → CONTACTED →
    RESPONDED → QUALIFIED → BOOKED → WON. LOST is a terminal commercial
    outcome. Human takeover, follow-up active, AI active and opted-out
    are control flags rather than separate funnel stages. \## 11.2
    Speed-to-lead dispatch
-   On lead creation, check subscription, suppression and messaging
    health.
-   Choose primary channel from workspace settings.
-   Queue the first message immediately.
-   Measure lead_received_at → first_outbound_at.
-   If the primary channel hard-fails and a permitted fallback exists,
    try one fallback. \## 11.3 Qualification Use deterministic rules
    first and AI for language understanding. The AI extracts structured
    fields; the rules engine decides whether the lead meets the
    customer's stated criteria. \| Input \| Example normalized value \|
    \| --- \| --- \| \| Service \| need whole roof doing →
    roof_replacement \| \| Location \| BH14... → postcode / service-area
    match \| \| Timing \| next month → within_30_days \| \| Ownership \|
    yes, my house → owner=true \| \| Intent \| just comparing prices →
    research intent \|

## 11.4 Booking readiness

Example explainable score: required qualification complete +50, in
service area +20, preferred timing +15, explicit quote/call intent +15.
A threshold such as 70 can trigger the booking CTA. The score is a
transparent rules configuration, not a black-box ML prediction. \## 11.5
Follow-up scheduler - Default cadence: immediately, +10 minutes, +2
hours, +1 day, +3 days. - Before every step, re-check stop conditions. -
Respect quiet hours by rolling to the next permitted window. - Prevent
overlapping new-lead and reactivation sends. - Any reply cancels pending
no-response steps. \## 11.6 Human handover - Immediate handover if lead
explicitly requests a person. - Handover for complaint,
sensitive/complex request, or repeated AI uncertainty. - Handover when
requested facts are outside approved knowledge. - V1 can notify/assign
the workspace owner; round-robin routing can come later. \## 11.7
Reactivation audience Eligible = tenant-owned lead AND old enough AND
valid channel AND not opted out AND not recently contacted AND no active
conversation AND not already booked/won. Prioritize using transparent
factors such as recency, prior response, service value and original
intent. \## 11.8 Pipeline estimate Estimated pipeline = sum of
configured `service.average_value` for selected qualified/booked leads.
Always label this estimate and keep realized revenue separate. \## 11.9
Attribution Persist Meta page/form/campaign/ad identifiers when
available, then aggregate leads, replies, qualifications, bookings and
wins by source. The business should see which lead sources produce
commercial outcomes, not only cheap lead volume. \## 11.10 AI response
loop 1. Classify inbound message: answer, question, objection, opt-out,
booking intent, human request, unknown. 1. Extract qualification fields
to structured JSON and confidence. 1. Run deterministic rules. 1. Choose
next action. 1. Generate a short response from approved business
context. 1. Validate against forbidden commitments and missing
context. 1. Send or hand over. Store cost/metadata, never hidden
chain-of-thought. \# 12. Backend API and server functions \| Endpoint /
action \| Purpose \| Authority \| \| --- \| --- \| --- \| \| POST
`/api/webhooks/meta` \| Meta lead ingress \| Provider verification. \|
\| POST `/api/webhooks/messaging` \| Inbound and delivery events \|
Provider verification. \| \| POST `/api/webhooks/stripe` \| Subscription
events \| Stripe signature. \| \| POST `/api/webhooks/calendar` \|
Booking events where supported \| Provider verification. \| \| POST
`/api/integrations/meta/connect` \| Meta OAuth/connect \| Owner/admin.
\| \| POST `/api/integrations/meta/test` \| Meta setup test \|
Owner/admin. \| \| POST `/api/messages/send` \| Manual outbound \|
Member + server policy. \| \| POST `/api/leads/:id/handover` \| Human
takeover \| Member. \| \| POST `/api/leads/:id/resume-ai` \| Resume
automation \| Authorized member. \| \| POST `/api/campaigns` \| Create
draft \| Owner/admin. \| \| POST `/api/campaigns/:id/launch` \|
Validate + launch \| Owner/admin. \| \| POST
`/api/automations/:id/publish` \| Publish version \| Owner/admin. \| \|
POST `/api/billing/checkout` \| Checkout/upgrade \| Owner. \| \| POST
`/api/billing/portal` \| Stripe portal \| Owner. \|

## 12.1 Job types

  Job                        Trigger
  -------------------------- --------------------------------
  lead.process               Normalized lead.
  message.send               Automation/manual send.
  message.process_inbound    Inbound reply.
  automation.advance         Due step.
  booking.create             Booking-ready lead.
  campaign.expand            Launch audience.
  campaign.send              Paced send.
  integration.health_check   Scheduled or user test.
  analytics.aggregate        Hourly/daily rollup if needed.
  notification.send          Handover/system alert.
  retention.cleanup          Scheduled cleanup.

# 13. Security, consent and operational safety

-   TLS everywhere.
-   Provider secrets/tokens never in browser-readable tables or bundles.
-   Verify external webhook signatures/challenges.
-   Rate-limit login, manual-send, testing and public endpoints.
-   Maintain explicit opt-out/suppression state and immediately stop
    future marketing outreach for that channel.
-   Persist consent/source context where available.
-   Implement quiet hours and plan usage limits.
-   Use least-privilege OAuth scopes and disconnect controls.
-   Audit integration changes, roles, exports, billing, impersonation
    and campaign launches.
-   Delegate payment-card storage to Stripe.
-   Use managed database backups/PITR appropriate to the production
    plan.
-   Define retention for raw provider payloads, failed jobs, messages
    and deleted workspaces.
-   Build workspace export/deletion procedures before scale. \>
    Compliance note \> Direct-marketing requirements depend on channel,
    consent context, business/customer type and jurisdiction. The
    platform should provide suppression, opt-out, consent evidence and
    audit controls, and the production outreach templates/process should
    be reviewed for UK GDPR/PECR and provider-policy compliance before
    scaling.

# 14. Admin and operating model

## 14.1 `/admin` Overview

-   Active customers, trials, MRR mirror, signups, leads processed,
    messages, bookings and failed jobs.
-   Provider health summary.
-   Recent activations/cancellations.
-   Action-required queue for disconnected Meta, delivery failures and
    past-due subscriptions. \## 14.2 `/admin/customers`
-   Table: business, owner, plan, status, lead/message usage, joined and
    last activity.
-   Filters: trial, active, past due, cancelled, integration problem.
-   Customer drawer: members, subscription, integrations, recent errors
    and usage.
-   Audited support view/impersonation; never expose raw secrets. \##
    14.3 `/admin/system`
-   Integrations: provider health and auth failures.
-   Webhooks: event id, provider, time, status, attempts, safe retry.
-   Messaging: sent, delivered, failed, inbound, opt-outs, cost.
-   AI Usage: calls, cost estimate, parse failures, handover rate.
-   Billing Events: subscription/invoice event processing.
-   Errors: app/job error references. \# 15. Connecting to other systems
    without bloating Client Turn Keep Client Turn standalone. Its system
    of record is the lead, conversation, qualification and booking
    outcome. Anything outside this boundary connects through adapters,
    outbound webhooks or a small API later. \| External system \| V1 \|
    Later \| \| --- \| --- \| --- \| \| Existing CRM \| Do not replace
    \| Push qualified/booked lead by webhook/API. \| \| Agency software
    \| No multi-client agency portal \| Add after proven demand. \| \|
    Website forms \| Not needed for the Meta wedge \| Generic inbound
    webhook/form later. \| \| Zapier/Make \| Not launch critical \|
    Outbound events later. \| \| Other owned products \| No shared
    database/product UI \| Consume events through API/webhook if
    strategically useful. \| \| BI/data warehouse \| No \| Scheduled
    export/API later. \| \| Voice AI \| No \| Add as a new channel after
    text economics are proven. \|

Reuse design tokens or code packages if useful, but avoid shared tenant
databases or tightly coupled authentication unless there is a concrete
commercial reason. \# 16. UI system and reusable components \| Component
\| Use \| Rule \| \| --- \| --- \| --- \| \| AppShell \| All app routes
\| Left nav + top bar + responsive drawer. \| \| PageHeader \| All pages
\| Title, context, primary action. \| \| StatCard \| Dashboards \|
Metric + comparison/tooltip. \| \| DataTable \| Leads/campaigns/admin \|
Server pagination and filters. \| \| StatusBadge \| All operational
lists \| One centralized status mapping. \| \| LeadDrawer \|
Dashboard/leads/campaigns \| Reusable detail/conversation surface. \| \|
ConversationThread \| Lead drawer \| Messages, delivery status, times.
\| \| SequenceEditor \| Automations \| Linear sequence only. \| \|
IntegrationCard \| Integrations/onboarding \| Health + test/reconnect.
\| \| HealthBanner \| App \| Only actionable problems. \| \| WizardShell
\| Onboarding/campaigns \| Progress + save/resume + validation. \| \|
EmptyState \| Lists \| Always offer next action. \| \| ConfirmDialog \|
Destructive actions \| Explain scope/consequence. \| \|
Toast/InlineError \| Mutations \| Actionable server error. \|

# 17. Analytics, observability and audit

## 17.1 Product analytics events

-   landing_cta_clicked, signup_started, signup_completed.
-   onboarding_step_completed, integration_connected, test_lead_passed,
    workspace_activated.
-   first_real_lead_received, first_outbound_sent, first_reply_received,
    first_qualified_lead, first_booking.
-   automation_published, campaign_created, campaign_launched.
-   billing_checkout_started, subscription_started, plan_changed,
    subscription_cancelled. \## 17.2 Operational metrics
-   Webhook processing success/failure and latency.
-   Lead received → first message p50/p95.
-   Message send/delivery/failure by provider.
-   AI success/latency/cost per conversation.
-   Queue depth and oldest due job.
-   Integration disconnection rate.
-   Subscription entitlement mismatch count. \## 17.3 Audit trail Keep
    security-significant audit records append-only. The lead drawer can
    show a friendly timeline derived from domain events; the platform
    audit log stays stricter and admin-facing. \# 18. Exact build
    sequence \## Phase 0 - Foundations
-   Create Next.js, Supabase, environments, migrations, auth, tests,
    monitoring.
-   Build design tokens/AppShell.
-   Create businesses/business_members and tenant resolver.
-   Implement RLS baseline and RLS tests before feature tables. \##
    Phase 1 - Landing/auth
-   Build single landing page.
-   Build signup/login/reset.
-   Create workspace on signup.
-   Track acquisition/activation events. \## Phase 2 - Core lead UI
-   Create services, leads, sources, conversations and messages.
-   Build Dashboard and Leads drawer using seeded fixtures.
-   Lock status enums and domain events. \## Phase 3 -
    Onboarding/integrations
-   Wizard steps 1--3.
-   Meta connection and form mapping.
-   SMS provider with inbound/delivery webhooks.
-   Test-lead flow through the same internal pipeline. \## Phase 4 -
    Automation
-   Automation definitions/versions/steps/runs.
-   Default sequences and linear editor.
-   Due-step worker, stop rules, quiet hours and retry.
-   Real Meta lead → immediate outbound message. \## Phase 5 -
    Qualification/AI
-   Questions/answers.
-   Deterministic qualification state machine.
-   Structured AI extraction + bounded replies.
-   AI Receptionist page, simulator and handover. \## Phase 6 - Booking
-   Calendly or Google Calendar adapter.
-   Booking action and booking state.
-   Bookings page and funnel analytics. \## Phase 7 - Billing
-   Stripe subscription/portal.
-   Webhook mirror.
-   Entitlements and limits.
-   Usage metering. \## Phase 8 - Reactivation
-   Audience builder/CSV import.
-   Suppression rules.
-   Campaign wizard and paced sends.
-   Campaign analytics. \## Phase 9 - Analytics/admin
-   Source analytics.
-   Admin overview/customers/system.
-   Webhook retries and health tooling. \## Phase 10 - Launch hardening
-   Cross-tenant tests, webhook replay tests, provider failure tests.
-   Consent/opt-out review.
-   Alerts/backups/secrets audit.
-   Burst/load test ingestion and queue.
-   Production domain/legal/support process. \# 19. MVP acceptance
    criteria \| Area \| Launch requirement \| \| --- \| --- \| \| Signup
    \| Create workspace and resume onboarding. \| \| RLS \| Business A
    cannot read/write Business B data. \| \| Meta \| Real selected form
    lead arrives exactly once in correct workspace. \| \| Messaging \|
    Automatic first outbound works and delivery is recorded. \| \|
    Replies \| Inbound reply maps to correct conversation. \| \|
    Automation \| Follow-ups stop on reply, booking, opt-out, lost or
    human takeover. \| \| Qualification \| Answers are structured and
    qualification decision is explainable. \| \| AI \|
    Unknown/unapproved cases hand over rather than fabricate. \| \|
    Booking \| Qualified lead reaches working booking path. \| \|
    Billing \| Stripe state controls entitlement. \| \| Analytics \|
    Funnel matches underlying test records. \| \| Admin \| Failed
    webhooks/jobs visible and safe-retryable. \| \| Monitoring \|
    Critical failures alert. \| \| Compliance controls \|
    Opt-out/suppression works end-to-end. \| \| Landing \| All CTAs
    reach signup and are tracked. \|

# 20. First sales and Meta advertising plan

Sell the lost-money scenario, not AI software. \| Creative \| Hook \|
Landing alignment \| \| --- \| --- \| --- \| \| Roofing speed \| You
paid for the roofing lead. Who replied first? \| Hero + response
timeline. \| \| Follow-up \| Most leads do not buy on message one. Who
follows up tomorrow? \| Automation demo. \| \| Reactivation \| You
already paid for these old enquiries. \| Reactivation section. \| \|
Attribution \| Cheap leads do not matter if none become booked quotes.
\| Source → booking analytics. \|

## 20.1 Acquisition funnel

1.  Vertical Meta ad.
2.  Single matching landing page.
3.  Start Free.
4.  Signup.
5.  Onboarding.
6.  Meta + messaging connected.
7.  Test lead succeeds.
8.  First real lead receives automated response.
9.  First reply/booking becomes the trial's value moment.
10. Upgrade before/at plan limit or trial end. \## 20.2 Sales-assisted
    fallback Early on, offer 'We set it up with you' if integrations
    create activation friction. Use those calls to identify onboarding
    problems, while keeping the product architecture self-serve. \# 21.
    Decisions to lock now \| Decision \| Recommendation \| \| --- \| ---
    \| \| Working name \| Client Turn internally; check domain/trademark
    before final brand. \| \| Market \| UK trades/home services first.
    \| \| Public site \| One landing page + auth + legal. \| \|
    Messaging \| SMS first; WhatsApp where setup is reliable. \| \|
    Calendar \| Calendly or Google; no bespoke scheduler. \| \| CRM \|
    No CRM beyond lightweight lead statuses. \| \| Automation \|
    Predefined linear sequences. \| \| AI \| Bounded
    receptionist/qualification only. \| \| Billing \| Stripe. \| \|
    Database \| Supabase Postgres + strict RLS. \| \| Admin \| 3 routes
    maximum. \| \| Deployment \| Vercel + Supabase + managed providers.
    \| \| Integration pattern \| Adapters + webhook inbox + idempotent
    async jobs. \| \| Expansion \| Only after repeated customer demand.
    \|

# 22. Implementation references and cautions

Supabase's current documentation recommends enabling RLS on exposed
tables, pairing grants with policies, and keeping service-role access
server-side because it bypasses RLS. Stripe's current subscription
guidance recommends relying on verified webhook events for asynchronous
subscription changes. Meta and WhatsApp scopes, webhook verification and
messaging requirements can change, so implementation should verify the
exact current developer requirements when the integrations are coded.
This is a product and engineering specification, not legal advice.
Validate production direct-marketing consent, privacy, retention and
messaging-template practices before scaling outbound communication.
