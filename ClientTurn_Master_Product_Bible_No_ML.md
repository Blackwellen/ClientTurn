# CLIENTTURN — Master Product Bible

**Build architecture • Web application • Next.js + Supabase • No AI / No ML**

**CLIENTTURN**

**Master Domain, Page, Data, Backend, Integration, RLS & Release Architecture**

**Build-ready product bible • Simple commercial V1 • UK home-service businesses**

---

# 0. Architecture Rules & Product Shape

Client Turn is a deliberately narrow SaaS product for businesses that already generate leads from Facebook and Instagram.

Its job is simple:

> **Receive a lead → contact the lead immediately → follow up automatically → ask deterministic qualification questions → hand the lead to the business or send a booking link → report the outcome.**

The product must not expand into a general CRM, social platform, marketing suite, project-management system, ad manager or workflow builder.

## 0.1 Canonical product rules

- The primary target market is **UK home-service businesses using Meta Lead Ads**.
- Initial priority verticals:
  - Roofers
  - Windows and doors
  - Driveways and paving
  - Landscaping
  - Kitchens and bathrooms
  - Builders and extensions
  - Plumbing
  - Electrical
  - Cleaning
  - Removals
- The main commercial outcome is a **booked quote, survey, consultation, callback or job opportunity**.
- The public website consists mainly of **one major landing page**.
- The authenticated application remains small and focused.
- There is **no machine learning**.
- There is **no AI chatbot**.
- Qualification is based on explicit questions, rules and branching.
- Follow-up is based on timers, templates, statuses and stop conditions.
- Next.js owns the frontend and server application layer.
- Supabase owns:
  - PostgreSQL
  - authentication
  - Row Level Security
  - storage where needed
  - selected Realtime updates
- Every tenant-owned record carries `business_id`.
- Every exposed business table uses RLS.
- External provider secrets remain server-side.
- Integrations are isolated behind small adapters.
- Webhooks acknowledge quickly and hand slow work to background processing.
- All repeatable external events must be idempotent.
- All critical user actions must have loading, success, empty and failure states.
- Low-risk edits happen inline or in drawers.
- Multi-step setup uses wizards.
- Admin remains intentionally small.
- One canonical record owns each piece of transactional state.
- Do not duplicate leads, messages, bookings, subscriptions or integration state across multiple modules.

## 0.2 Product value chain

```text
META LEAD
   ↓
LEADRECEIVER
   ↓
INSTANT MESSAGE
   ↓
FOLLOW-UP SEQUENCE
   ↓
QUALIFICATION QUESTIONS
   ↓
QUALIFIED / NOT QUALIFIED
   ↓
BOOKING LINK OR HUMAN HANDOVER
   ↓
BOOKED / WON / LOST
   ↓
ATTRIBUTION + REPORTING
```

Any proposed feature that does not improve this chain should be rejected from V1.

## 0.3 Initial runtime topology

| Layer | Responsibility | Initial deployment |
|---|---|---|
| Web | Next.js / React / TypeScript | Vercel |
| Server application | Next.js route handlers, server actions, integration orchestration | Vercel |
| Authentication | Supabase Auth | Supabase |
| Database | PostgreSQL canonical state | Supabase |
| RLS | Tenant and role isolation | Supabase |
| Realtime | Lead/message/status refresh where useful | Supabase Realtime |
| Storage | Logos and controlled CSV imports | Supabase Storage |
| Background work | Durable scheduled job mechanism / worker | Simple managed worker or database-backed queue |
| Billing | Subscriptions and portal | Stripe |
| SMS | Lead messaging | Twilio |
| WhatsApp | Optional messaging channel | Twilio WhatsApp or Meta WhatsApp Cloud API |
| Calendar | Booking destination | Calendly and/or Google Calendar |
| Transactional email | System emails | Resend |
| Product analytics | Product funnel telemetry | PostHog |
| Error monitoring | Application/integration errors | Sentry |

## 0.4 Commercial scope

### Starter

- £79/month
- Up to 100 new leads
- 1 user
- SMS
- Standard new-lead follow-up
- One booking destination
- Basic analytics

### Growth

- £149/month
- Up to 500 new leads
- 3 users
- SMS + WhatsApp where configured
- Follow-up
- Reactivation campaigns
- Multiple qualification questions
- Source analytics

### Pro

- £249/month
- Up to 1,500 new leads
- Up to 10 users
- All core channels
- Higher limits
- Advanced routing rules
- Priority support

---

# PART I — Canonical Page Register

The canonical register lists every intended route or major surface before detailed implementation.

---

## 01. Public Website, Marketing & Conversion

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 01.01 | Main Landing Page | `/` | Main public page | Public |
| 01.02 | Privacy Policy | `/privacy` | Legal page | Public |
| 01.03 | Terms of Service | `/terms` | Legal page | Public |
| 01.04 | Cookie Policy | `/cookies` | Legal page | Public |

**Rule:** there is no separate pricing page, feature page, industries page or how-it-works page in V1. Those sections live on the main landing page.

---

## 02. Authentication & Account Entry

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 02.01 | Sign Up | `/signup` | Auth page | Public |
| 02.02 | Sign In | `/login` | Auth page | Public |
| 02.03 | Forgot Password | `/forgot-password` | Auth page | Public |
| 02.04 | Reset Password | `/reset-password` | Auth page | Public |
| 02.05 | Email Verification State | `/verify-email` | Auth state | Public/User |

---

## 03. Onboarding & Activation

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 03.01 | Setup Wizard | `/onboarding` | Wizard | Customer |
| 03.02 | Business Setup Step | `/onboarding?step=business` | Wizard step | Customer |
| 03.03 | Services Step | `/onboarding?step=services` | Wizard step | Customer |
| 03.04 | Qualification Step | `/onboarding?step=qualification` | Wizard step | Customer |
| 03.05 | Meta Connection Step | `/onboarding?step=meta` | Wizard step | Customer |
| 03.06 | Messaging Step | `/onboarding?step=messaging` | Wizard step | Customer |
| 03.07 | Booking Step | `/onboarding?step=booking` | Wizard step | Customer |
| 03.08 | Test Lead Step | `/onboarding?step=test` | Wizard step | Customer |
| 03.09 | Activate Step | `/onboarding?step=activate` | Wizard step | Customer |

---

## 04. Application Shell & Navigation

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 04.01 | App Shell | `/app/*` | Shell | Customer |
| 04.02 | Main Sidebar | Global | Shell surface | Customer |
| 04.03 | Top Bar | Global | Shell surface | Customer |
| 04.04 | Notification Tray | Global | Drawer | Customer |
| 04.05 | Profile Menu | Global | Popover | Customer |
| 04.06 | Lead Detail Drawer | Global reusable | Drawer | Customer |

---

## 05. Dashboard

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 05.01 | Dashboard | `/app` | Main app page | Customer |
| 05.02 | Funnel Detail | Inline / drilldown | Analytical view | Customer |
| 05.03 | Needs Attention | Inline panel | Operational view | Customer |

---

## 06. Leads & Conversations

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 06.01 | Leads | `/app/leads` | Main page | Customer |
| 06.02 | All Leads | Tab | Tabbed view | Customer |
| 06.03 | New | Tab | Tabbed view | Customer |
| 06.04 | Contacted | Tab | Tabbed view | Customer |
| 06.05 | Responded | Tab | Tabbed view | Customer |
| 06.06 | Qualified | Tab | Tabbed view | Customer |
| 06.07 | Booked | Tab | Tabbed view | Customer |
| 06.08 | Won | Tab | Tabbed view | Customer |
| 06.09 | Lost | Tab | Tabbed view | Customer |
| 06.10 | Needs Attention | Tab | Tabbed view | Customer |
| 06.11 | Lead Detail | Drawer | Detail surface | Customer |
| 06.12 | Conversation Thread | Inside drawer | Detail surface | Customer |
| 06.13 | Lead Timeline | Inside drawer | Activity surface | Customer |

---

## 07. Follow-Up Automations

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 07.01 | Automations Home | `/app/automations` | Main page | Customer |
| 07.02 | New Lead Follow-Up | Tab/card | Workflow configuration | Customer |
| 07.03 | Booking Reminder | Tab/card | Workflow configuration | Customer |
| 07.04 | Unresponsive Lead Follow-Up | Tab/card | Workflow configuration | Customer |
| 07.05 | Automation Editor | Drawer/panel | Editor | Customer |
| 07.06 | Message Preview | Inline panel | Preview | Customer |

---

## 08. Qualification Rules

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 08.01 | Qualification Rules | `/app/qualification` | Main page | Customer |
| 08.02 | Questions | Tab | Settings tab | Customer |
| 08.03 | Qualification Criteria | Tab | Settings tab | Customer |
| 08.04 | Routing Rules | Tab | Settings tab | Customer |
| 08.05 | Service-Specific Rules | Drawer | Detail editor | Customer |

---

## 09. Bookings

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 09.01 | Bookings | `/app/bookings` | Main page | Customer |
| 09.02 | Upcoming | Tab | Tabbed page | Customer |
| 09.03 | Completed | Tab | Tabbed page | Customer |
| 09.04 | Cancelled | Tab | Tabbed page | Customer |
| 09.05 | Booking Detail | Drawer | Detail surface | Customer |

---

## 10. Lead Reactivation Campaigns

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 10.01 | Reactivation Campaigns | `/app/campaigns` | Main page | Customer |
| 10.02 | Create Campaign | `/app/campaigns/new` | Wizard | Customer |
| 10.03 | Audience Step | Wizard step | Wizard step | Customer |
| 10.04 | Message Step | Wizard step | Wizard step | Customer |
| 10.05 | Timing Step | Wizard step | Wizard step | Customer |
| 10.06 | Review Step | Wizard step | Wizard step | Customer |
| 10.07 | Campaign Detail | Drawer/page | Detail surface | Customer |

---

## 11. Analytics & Attribution

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 11.01 | Analytics | `/app/analytics` | Main page | Customer |
| 11.02 | Overview | Tab | Analytics tab | Customer |
| 11.03 | Sources | Tab | Analytics tab | Customer |
| 11.04 | Follow-Up Performance | Tab | Analytics tab | Customer |
| 11.05 | Campaign Performance | Tab | Analytics tab | Customer |

---

## 12. Integrations

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 12.01 | Integrations | `/app/integrations` | Main page | Customer |
| 12.02 | Meta Lead Ads | Card/detail | Integration | Customer |
| 12.03 | SMS | Card/detail | Integration | Customer |
| 12.04 | WhatsApp | Card/detail | Integration | Customer |
| 12.05 | Google Calendar | Card/detail | Integration | Customer |
| 12.06 | Calendly | Card/detail | Integration | Customer |
| 12.07 | Email Notifications | Card/detail | Integration | Customer |

---

## 13. Settings, Team & Billing

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 13.01 | Settings | `/app/settings` | Main settings page | Customer |
| 13.02 | Business | Tab | Settings tab | Customer |
| 13.03 | Services | Tab | Settings tab | Customer |
| 13.04 | Team | Tab | Settings tab | Customer |
| 13.05 | Notifications | Tab | Settings tab | Customer |
| 13.06 | Messaging | Tab | Settings tab | Customer |
| 13.07 | Billing | Tab | Settings tab | Owner |
| 13.08 | Account | Tab | Settings tab | Customer |

---

## 14. Administration & Platform Operations

| ID | Page / Surface | Route | Category | Audience |
|---|---|---|---|---|
| 14.01 | Admin Overview | `/admin` | Admin dashboard | Platform admin |
| 14.02 | Customers | `/admin/customers` | Admin page | Platform admin |
| 14.03 | Customer Detail | Drawer | Admin detail | Platform admin |
| 14.04 | System | `/admin/system` | Admin page | Platform admin |
| 14.05 | Integrations Health | Tab | Admin tab | Platform admin |
| 14.06 | Webhooks | Tab | Admin tab | Platform admin |
| 14.07 | Messaging | Tab | Admin tab | Platform admin |
| 14.08 | Billing Events | Tab | Admin tab | Platform admin |
| 14.09 | Errors | Tab | Admin tab | Platform admin |

---

# PART II — Detailed Domain Specifications

---

# 01. Public Website, Marketing & Conversion

**Goal:** Convert paid and organic traffic into trial accounts by making the lost-lead problem obvious and demonstrating how Client Turn turns Meta enquiries into booked work.

**Primary audience:** UK home-service business owners and small sales teams.

## 01.1 Domain functions

- Explain the pain of slow lead response.
- Explain automatic follow-up.
- Explain deterministic lead qualification.
- Explain booking/handover.
- Explain old-lead reactivation.
- Explain source-to-booking analytics.
- Show pricing.
- Answer common objections.
- Drive visitors into signup.
- Track CTA source and campaign attribution.
- Provide privacy, terms and cookie information.

## 01.2 Main Landing Page — `/`

### Purpose

The landing page is the only significant public marketing page in V1.

It must answer:

1. What problem does this solve?
2. Who is it for?
3. What happens after I connect Meta?
4. What does the customer receive?
5. What does it cost?
6. Can I trust it with my leads?
7. How quickly can I start?

### Page structure

#### Header

Components:

- Client Turn logo
- `How It Works` anchor
- `Results` anchor
- `Industries` anchor
- `Pricing` anchor
- `FAQ` anchor
- `Log in`
- `Start Free` primary CTA

Behavior:

- Sticky after scroll.
- Mobile navigation becomes drawer.
- Primary CTA stays visible.
- Anchor navigation uses smooth scroll.

#### Hero

Content direction:

**Eyebrow**

> For UK trades running Facebook & Instagram lead ads

**Headline**

> Turn Facebook leads into booked jobs — automatically.

**Support copy**

> Client Turn contacts every new lead quickly, follows up when they do not reply, asks your qualification questions and sends sales-ready enquiries to your team or booking calendar.

Primary CTA:

`Start Free`

Secondary CTA:

`See How It Works`

Product visual:

```text
New Facebook Lead
        ↓
Message sent
        ↓
Lead replied
        ↓
Questions completed
        ↓
Qualified
        ↓
Quote booked
```

#### Pain / Cost of Delay

Display two timelines.

**Without Client Turn**

- 10:32 — Meta lead submitted
- 11:55 — business notices lead
- 12:10 — business sends first message
- 12:14 — customer: "Already booked someone"

**With Client Turn**

- 10:32 — Meta lead submitted
- 10:32 — first message sent
- 10:34 — customer replies
- 10:37 — qualification complete
- 10:40 — booking link sent

Purpose:

Show that the product protects ad spend.

#### Outcome cards

Four cards:

- Respond faster
- Follow up consistently
- Qualify before calling
- Book more quotes

#### How It Works

Step 1 — Connect Meta

Step 2 — A new lead arrives

Step 3 — Client Turn sends the configured message

Step 4 — Follow-up continues until reply / stop condition

Step 5 — Qualification questions are asked in order

Step 6 — Qualified leads receive booking link or human handover

#### Product conversation demo

Left:

Message conversation mockup.

Right:

Lead record card.

Example:

```text
Lead: Sarah Morgan
Service: Roof replacement
Postcode: BH14
Timing: Within 30 days
Owner: Yes
Status: QUALIFIED
Next action: Booking link sent
```

#### Why It Works

Five reasons:

- Fast first response
- Consistent follow-up
- Structured questions
- Clear stop conditions
- Visible conversion attribution

#### Industries

Cards:

- Roofing
- Windows & Doors
- Driveways
- Landscaping
- Kitchens
- Bathrooms
- Builders
- Plumbing
- Electrical
- Cleaning
- Removals

Each card uses the same system but changes the final action.

Examples:

- Roofing → `Book free survey`
- Windows → `Book quotation visit`
- Landscaping → `Book site visit`
- Bathrooms → `Book consultation`

#### Reactivation section

Headline:

> You already paid for the old leads.

Flow:

```text
Old leads
  ↓
Filter eligible contacts
  ↓
Send reactivation message
  ↓
Lead responds
  ↓
Qualification
  ↓
Booking
```

#### Analytics section

Show:

- Leads received
- Contacted
- Replied
- Qualified
- Booked
- Won
- Estimated pipeline

Source table:

| Campaign | Leads | Replies | Qualified | Booked |
|---|---:|---:|---:|---:|
| Roof Replacement | 82 | 47 | 29 | 18 |
| Roof Repairs | 51 | 26 | 14 | 8 |

#### Integrations strip

Show only:

- Meta Lead Ads
- SMS
- WhatsApp
- Google Calendar
- Calendly

#### Pricing

Starter £79

Growth £149

Pro £249

Growth is visually recommended.

#### FAQ

Required questions:

- Do I need to change my Facebook ads?
- Can I use my current CRM?
- Can Client Turn use my existing phone number?
- Does it support WhatsApp?
- What happens when someone replies?
- How does qualification work?
- Can someone opt out?
- Can I reactivate old leads?
- Does it replace my sales team?
- Can I cancel?
- Is there a free trial?

#### Final CTA

> Stop paying for leads you reply to too late.

CTA:

`Start Free`

#### Footer

- Logo
- Company details
- Support email
- Privacy
- Terms
- Cookies
- Login

## 01.3 Data

Public acquisition data:

- `marketing_sessions`
- `marketing_events`
- UTM parameters
- referrer
- CTA placement
- signup attribution

Avoid storing unnecessary personal marketing data.

## 01.4 Backend integration

- Next.js server-rendered landing where practical.
- PostHog client event for CTA click.
- Preserve UTM/click metadata through signup.
- Legal pages static or database/CMS-lite if required.
- No public API needed.

## 01.5 Component contract

- `MarketingHeader`
- `Hero`
- `PainTimeline`
- `OutcomeCard`
- `HowItWorksStep`
- `ConversationDemo`
- `IndustryCard`
- `AnalyticsPreview`
- `IntegrationStrip`
- `PricingCard`
- `FAQAccordion`
- `FinalCTA`
- `MarketingFooter`

## 01.6 Permissions & QA

Public.

Test:

- Mobile header
- All anchors
- All CTA destinations
- No broken pricing state
- UTM preservation
- SEO title/description
- Open Graph
- Accessibility
- Core Web Vitals
- No fabricated customer proof

---

# 02. Authentication & Account Entry

**Goal:** Create secure user accounts and route users directly into activation.

## 02.1 Domain functions

- Sign up
- Sign in
- Verify email
- Reset password
- Session management
- Logout
- Protected-route enforcement

## 02.2 Sign Up — `/signup`

Fields:

- First name
- Last name
- Business name
- Work email
- Password
- Terms checkbox

Actions:

- `Create account`
- `Already have an account? Log in`

On submit:

1. Create Supabase Auth user.
2. Create `profiles`.
3. Create `businesses`.
4. Create owner membership in `business_members`.
5. Store acquisition attribution.
6. Redirect to `/onboarding`.

## 02.3 Sign In — `/login`

Fields:

- Email
- Password

Actions:

- Sign in
- Forgot password
- Sign up

After login:

- Incomplete onboarding → `/onboarding`
- Complete onboarding → `/app`
- Platform admin → normal app unless explicitly using `/admin`

## 02.4 Forgot / Reset Password

Use Supabase Auth password-reset flow.

Never create a custom password token system.

## 02.5 Supabase tables

### `profiles`

- `id uuid primary key`
- `first_name text`
- `last_name text`
- `phone text null`
- `platform_role text default 'user'`
- `created_at timestamptz`
- `updated_at timestamptz`

### `business_members`

- `id uuid`
- `business_id uuid`
- `user_id uuid`
- `role text`
- `status text`
- `created_at timestamptz`

Allowed roles:

- owner
- admin
- member

## 02.6 RLS

`profiles`

- user may read/update own profile.
- platform admin does not gain browser-wide access solely from a client field.

`business_members`

- members may read membership rows for businesses they belong to.
- only owner/admin may invite or update members.
- owner role transfer requires server action.

## 02.7 Components

- `AuthCard`
- `FormField`
- `PasswordField`
- `PasswordStrength`
- `AuthError`
- `AuthSuccess`
- `SubmitButton`

## 02.8 QA

- Duplicate email
- Invalid credentials
- Expired reset link
- Unverified email
- Session expiry
- Back-button behavior
- Redirect preservation
- RLS membership creation test

---

# 03. Onboarding & Activation

**Goal:** Make the account operational in one guided flow.

## 03.1 Wizard architecture

One route:

`/onboarding`

State:

- persisted in database
- resumable
- each step independently valid
- progress indicator
- back
- save & exit
- continue

## 03.2 Step 1 — Business

Fields:

- Business name
- Industry
- Website
- Phone
- Timezone
- Business hours
- Service postcode/region description

Writes:

- `businesses`
- `business_settings`

## 03.3 Step 2 — Services

Fields per service:

- Name
- Active
- Average job value
- Optional internal description

Examples:

Roof replacement

Roof repair

Guttering

Emergency repair

Writes:

`services`

## 03.4 Step 3 — Qualification

User adds ordered questions.

Default template:

1. What service do you need?
2. What postcode is the property?
3. When would you like the work completed?
4. Are you the property owner?
5. Would you like to book a free quote?

Question fields:

- Question text
- Response type
- Required yes/no
- Sort position
- Rule type
- Accepted values where relevant

Supported response types:

- Free text
- Yes / No
- Single choice
- Number
- Postcode
- Date/timing choice

No natural-language AI parsing.

If a free-text answer cannot be evaluated automatically, store it and continue.

## 03.5 Step 4 — Meta

Actions:

- Connect Facebook
- Select business/page
- Select lead form(s)
- Map lead fields

Minimum field mapping:

- First name
- Last name or full name
- Phone
- Email if available
- Form id
- Source metadata

Test:

- Verify subscription
- Verify selected form
- Trigger or simulate form payload

## 03.6 Step 5 — Messaging

Options:

- SMS
- WhatsApp
- Both

Fields:

- Sender number/provider
- Default opening message
- Business signature
- Opt-out wording
- Quiet hours

Test action:

`Send test message`

Activation cannot proceed if no working outbound channel exists.

## 03.7 Step 6 — Booking

Modes:

### Calendly link

- Store event booking URL.

### Google Calendar

- Connect account
- select calendar
- define whether Client Turn creates a tentative event or only links the business to lead detail.

### Human handover only

- No booking integration.
- Notify owner/team.

## 03.8 Step 7 — Test Lead

Create a synthetic lead through the same internal processing path.

Expected outcome:

- lead created
- source tagged `test`
- message generated
- test message sent
- visible conversation
- status changed

Test records are excluded from production analytics.

## 03.9 Step 8 — Activate

Checklist:

- Business complete
- At least one service
- Qualification configured
- Meta healthy
- Messaging healthy
- Booking/handover configured
- Test successful
- Published follow-up sequence exists

Action:

`Activate Client Turn`

## 03.10 Tables

- `businesses`
- `business_settings`
- `services`
- `qualification_questions`
- `integrations`
- `integration_objects`
- `field_mappings`
- `automation_definitions`
- `automation_versions`
- `automation_steps`

## 03.11 QA

Test every wizard step independently.

Must support:

- refresh
- browser close
- resume
- provider failure
- expired Meta session
- failed SMS test
- invalid booking URL
- incomplete state

---

# 04. Application Shell & Navigation

**Goal:** Provide a simple application frame that keeps the user focused on leads and bookings.

## 04.1 Sidebar

Navigation order:

1. Dashboard
2. Leads
3. Automations
4. Qualification
5. Bookings
6. Reactivation
7. Analytics
8. Integrations

Bottom:

- Settings
- Help
- Profile

Do not add:

- Contacts
- Companies
- Tasks
- Projects
- Pipelines
- Documents
- Marketing
- Social
- CRM

## 04.2 Top bar

Components:

- Mobile nav trigger
- Page title
- Integration health indicator
- Notifications
- User profile

## 04.3 Notification tray

Only operational notifications:

- lead needs attention
- booking completed
- integration disconnected
- message failed
- campaign finished
- billing issue

## 04.4 Lead Detail Drawer

Reusable from:

- Dashboard
- Leads
- Campaigns
- Analytics drilldown

Tabs/sections:

- Overview
- Conversation
- Qualification
- Booking
- Timeline

## 04.5 Responsive behavior

Desktop:

- fixed sidebar
- content max width
- drawers from right

Tablet/mobile:

- sidebar becomes drawer
- tables become stacked rows where necessary
- lead detail may become full-screen sheet

## 04.6 Shared states

Every route must implement:

- loading
- empty
- error
- permission denied
- integration required
- plan limit reached

---

# 05. Dashboard

**Goal:** Tell a business owner whether Client Turn is producing value within seconds.

## 05.1 Route

`/app`

## 05.2 Header

Display:

- `Good morning, [Business Name]`
- date range
- setup/integration health

## 05.3 KPI cards

- New Leads
- Contacted
- Replies
- Qualified
- Bookings
- Booking Rate

## 05.4 Funnel

```text
LEADS
  ↓
CONTACTED
  ↓
RESPONDED
  ↓
QUALIFIED
  ↓
BOOKED
  ↓
WON
```

Clicking a stage opens Leads with filter.

## 05.5 Estimated pipeline

Formula:

```text
sum(service.average_value for qualifying active leads)
```

The label must always say:

`Estimated pipeline`

Never represent this as realized revenue.

## 05.6 Recent Leads

Columns:

- Lead
- Service
- Source
- Status
- Last Activity

Maximum default rows:

10

## 05.7 Needs Attention

Possible cards:

- Lead requested a person
- SMS failed
- Meta disconnected
- Booking link missing
- Form mapping error
- Usage limit reached

## 05.8 Source snapshot

Columns:

- Source / campaign
- Leads
- Replies
- Booked

## 05.9 Data queries

Read:

- `leads`
- `messages`
- `qualification_answers`
- `bookings`
- `lead_sources`
- `integrations`
- `services`

Scope every query by authenticated business.

## 05.10 Realtime

Realtime permitted for:

- new lead
- lead status
- conversation reply
- booking
- notification

Analytics totals may refetch rather than subscribe to every row.

---

# 06. Leads & Conversations

**Goal:** Provide a minimal operational lead inbox without building a full CRM.

## 06.1 Route

`/app/leads`

## 06.2 Status model

Canonical statuses:

- NEW
- CONTACTED
- RESPONDED
- QUALIFIED
- BOOKED
- WON
- LOST

Flags:

- needs_attention
- automation_active
- human_takeover
- opted_out
- test_lead

## 06.3 Filters

- Status
- Service
- Source
- Form
- Campaign
- Assigned user
- Date
- Needs attention

Search:

- Name
- Phone
- Email
- Postcode

## 06.4 Lead table

Columns:

- Name
- Service
- Source
- Status
- Assigned To
- Created
- Last Contact

Actions:

- open
- assign
- pause/resume follow-up
- mark lost

Avoid broad bulk-messaging in V1.

## 06.5 Lead Detail Drawer

### Overview

Fields:

- Name
- Phone
- Email
- Service
- Postcode
- Lead created
- Source
- Meta form
- Campaign/ad metadata where available
- Assignee
- Current status

### Conversation

Show:

- outbound message
- inbound message
- status
- timestamp
- delivery state

### Qualification

Each question:

- Question
- Answer
- Complete
- Meets criteria / does not meet criteria / not evaluated

### Booking

- Booking status
- Link sent
- appointment date/time where known
- external reference

### Timeline

Events:

- lead created
- first message
- follow-up message
- reply
- question answered
- qualified
- handover
- booking
- won/lost
- opt-out

## 06.6 Manual actions

- Send SMS
- Send WhatsApp
- Call link
- Send booking link
- Mark qualified
- Mark not qualified
- Assign
- Human handover
- Resume automation
- Mark won
- Mark lost

## 06.7 Data model

### `leads`

Core fields:

- `id uuid`
- `business_id uuid`
- `external_id text null`
- `first_name text`
- `last_name text`
- `phone text`
- `email text null`
- `postcode text null`
- `service_id uuid null`
- `status text`
- `assigned_user_id uuid null`
- `needs_attention boolean`
- `human_takeover boolean`
- `opted_out boolean`
- `is_test boolean`
- `source_id uuid null`
- `created_at`
- `updated_at`
- `first_contacted_at`
- `first_replied_at`
- `qualified_at`
- `booked_at`
- `won_at`
- `lost_at`

### `lead_sources`

- business_id
- provider
- page_id
- form_id
- campaign_id
- adset_id
- ad_id
- source_name
- raw_metadata jsonb

### `conversations`

- business_id
- lead_id
- channel
- state
- last_message_at

### `messages`

- business_id
- conversation_id
- direction
- channel
- body
- provider_message_id
- status
- scheduled_for
- sent_at
- delivered_at
- failed_at

## 06.8 RLS

Leads:

- active members may select.
- member/admin/owner may update approved operational fields.
- source identifiers and ingestion ownership are not freely user-editable from browser.

Messages:

- members may read.
- browser must not directly insert arbitrary provider-backed outbound messages.
- manual send goes through server action.

## 06.9 QA

Critical tests:

- tenant isolation
- duplicate Meta lead
- duplicate webhook
- incoming reply resolution
- opted-out lead
- failed message
- lead without service
- lead without email
- long conversation
- concurrent status updates

---

# 07. Follow-Up Automations

**Goal:** Provide reliable deterministic follow-up without a workflow-builder product.

## 07.1 Route

`/app/automations`

## 07.2 Available automation types

Only:

1. New Lead Follow-Up
2. Booking Reminder
3. Unresponsive Lead Follow-Up

## 07.3 Editor model

Vertical sequence.

Each step:

- order
- delay
- channel
- message
- active
- stop conditions

Example:

```text
Step 1
Immediately
SMS
"Hi {{first_name}}, thanks for your enquiry with {{business_name}}..."

Step 2
10 minutes
SMS
"Just checking you received my message..."

Step 3
2 hours
SMS

Step 4
1 day
SMS

Step 5
3 days
SMS
```

## 07.4 Supported merge fields

- `{{first_name}}`
- `{{business_name}}`
- `{{service_name}}`
- `{{booking_link}}`
- `{{business_phone}}`

Unknown token:

- publishing blocked

## 07.5 Stop conditions

Before every send:

Stop if:

- replied
- booked
- won
- lost
- opted out
- human takeover
- automation manually paused
- subscription inactive
- integration unavailable

## 07.6 Quiet hours

Business config:

- start allowed
- stop allowed
- timezone

If scheduled time is outside window:

- shift to next valid time

## 07.7 Versioning

Tables:

### `automation_definitions`

- id
- business_id
- type
- name

### `automation_versions`

- id
- business_id
- automation_id
- version_number
- status: DRAFT / PUBLISHED / ARCHIVED
- published_at

### `automation_steps`

- id
- business_id
- version_id
- position
- delay_seconds
- channel
- template
- enabled

### `automation_runs`

- business_id
- lead_id
- version_id
- state
- current_step
- next_run_at
- stopped_reason

## 07.8 Scheduling algorithm

Pseudo-logic:

```text
when lead created:
    if eligible:
        create automation_run
        schedule first step

when step becomes due:
    reload lead
    reload business subscription
    reload channel health

    if any stop condition:
        stop run
        record reason
        return

    render template
    enqueue send
    increment step

    if more steps:
        calculate next valid send time
    else:
        complete run
```

## 07.9 Components

- `AutomationCard`
- `SequenceEditor`
- `SequenceStep`
- `ChannelSelector`
- `DelayInput`
- `TemplateEditor`
- `MergeFieldMenu`
- `StopConditionSummary`
- `PublishDialog`
- `TestMessageDialog`

---

# 08. Qualification Rules

**Goal:** Qualify leads without AI by asking explicit questions and evaluating explicit rules.

## 08.1 Route

`/app/qualification`

## 08.2 Questions tab

Fields:

- question
- response type
- required
- sort order
- service applicability

## 08.3 Qualification criteria

Supported deterministic criteria:

### Postcode / area

- allowed postcode prefix list
- blocked prefixes

### Choice

Example:

`Are you the property owner?`

Rule:

- Yes = pass
- No = fail or continue depending configuration

### Timing

Options:

- ASAP
- 7 days
- 30 days
- 3 months
- Researching only

Business may define acceptable choices.

### Service

Lead must map to an active service.

### Numeric field

Optional minimum / maximum.

Example:

- project size
- budget if business chooses to ask

## 08.4 Qualification result

Possible:

- PENDING
- QUALIFIED
- NOT_QUALIFIED
- REVIEW

`REVIEW` is used when:

- free text cannot be automatically evaluated
- answers conflict
- required field missing
- business chooses manual review

## 08.5 Conversation progression

Without AI, messages use explicit prompts.

Example:

```text
System: What service are you interested in?

Lead: [button/choice or typed reply]

If channel supports no buttons:
attempt exact/simple matching against configured options.

If no reliable match:
mark answer REVIEW
send:
"Thanks. A member of the team will pick this up."
```

Do not pretend to understand arbitrary text.

## 08.6 Rule evaluation

Example:

```text
required service = active
AND postcode in permitted area
AND property_owner = yes
AND timing != research_only
```

Then:

`QUALIFIED`

If explicit hard-fail:

`NOT_QUALIFIED`

If uncertain:

`REVIEW`

## 08.7 Tables

### `qualification_questions`

- business_id
- service_id nullable
- question_text
- response_type
- required
- position
- active

### `qualification_options`

- question_id
- label
- value
- position

### `qualification_rules`

- business_id
- question_id
- operator
- comparison_value
- result
- priority

### `qualification_answers`

- business_id
- lead_id
- question_id
- answer_text
- answer_value
- evaluation
- answered_at

## 08.8 Components

- `QuestionList`
- `QuestionEditor`
- `ResponseTypeSelect`
- `OptionEditor`
- `RuleBuilderSimple`
- `ServiceScopeSelector`
- `QualificationPreview`

---

# 09. Bookings

**Goal:** Move qualified leads into the business's existing booking process.

## 09.1 Route

`/app/bookings`

## 09.2 Booking strategies

### Strategy A — Calendly

Simplest recommended V1.

Store:

- event URL
- event name

When qualified:

- send template containing booking link

If webhook available/configured:

- receive booking completion
- create booking record
- update lead to BOOKED

### Strategy B — Google Calendar

Connect OAuth.

Use conservatively.

V1 can:

- select calendar
- create event only after explicit customer/business action
- store external event id

Do not build complex free/busy scheduling unless required later.

### Strategy C — Human handover

Qualified lead:

- mark needs attention
- notify team
- no external booking

## 09.3 Bookings page

Tabs:

- Upcoming
- Completed
- Cancelled

Columns:

- Lead
- Service
- Date
- Time
- Assignee
- Provider
- Status

## 09.4 Booking Detail

Fields:

- lead
- contact
- qualification summary
- appointment time
- provider
- external event id
- notes
- status

Actions:

- open lead
- open external booking
- mark completed
- cancel if supported

## 09.5 Table

`bookings`

- id
- business_id
- lead_id
- provider
- external_event_id
- booking_url
- starts_at
- ends_at
- assigned_user_id
- status
- created_at
- updated_at

## 09.6 RLS

Members:

- may read bookings for tenant.
- mutation through controlled server actions where provider sync is involved.

---

# 10. Lead Reactivation Campaigns

**Goal:** Recover value from old leads the business has already paid for.

## 10.1 Route

`/app/campaigns`

## 10.2 Campaign list

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

## 10.3 Create Campaign wizard

### Step 1 — Audience

Sources:

- Existing Client Turn leads
- CSV import

Filters:

- older than X days
- status
- service
- source
- no reply
- lost
- not booked

Mandatory suppression:

- opted out
- invalid number
- active conversation
- recent message cooldown
- booked
- won
- deleted/suppressed contact

### Step 2 — Message

One initial message.

Optional one follow-up.

Avoid complex drip marketing.

### Step 3 — Timing

- Send now
- Schedule date/time
- send-window / quiet-hours controls

### Step 4 — Review

Show:

- eligible contacts
- suppressed contacts
- estimated message count
- reason groups
- message preview

Action:

`Launch Campaign`

## 10.4 Pacing

Do not send an entire large audience at once.

Worker:

- claims a small batch
- sends within provider/account rate constraints
- records each result
- stops failed/suppressed contacts

## 10.5 Tables

### `campaigns`

- business_id
- name
- status
- message_template
- followup_template nullable
- scheduled_at
- launched_at
- completed_at
- filter_config jsonb

### `campaign_contacts`

- business_id
- campaign_id
- lead_id
- state
- next_send_at
- sent_at
- replied_at
- stopped_reason

### `imports`

- business_id
- file_path
- status
- row_count
- valid_count
- invalid_count

## 10.6 CSV import

Accepted columns:

- first_name
- last_name
- phone
- email
- service
- postcode

Validate before insertion.

Show row errors.

Never make CSV import an unrestricted arbitrary schema tool.

---

# 11. Analytics & Attribution

**Goal:** Prove whether lead handling produces replies, qualified enquiries and bookings.

## 11.1 Route

`/app/analytics`

## 11.2 Overview tab

Metrics:

- Leads
- Contact rate
- Reply rate
- Qualification rate
- Booking rate
- Won rate
- Estimated pipeline

## 11.3 Sources tab

Group by:

- Meta page
- Lead form
- campaign
- ad set
- ad

Where provider data exists.

Columns:

- Source
- Leads
- Contacted
- Replies
- Qualified
- Booked
- Won
- Booking rate

## 11.4 Follow-Up Performance

Metrics:

- first response latency
- replies after first message
- replies after follow-up 1
- replies after follow-up 2
- message failure rate
- opt-out rate

This tells the user whether persistence is producing responses.

## 11.5 Campaign Performance

Per reactivation campaign:

- audience
- delivered
- replied
- qualified
- booked
- stopped/opted out

## 11.6 Query model

Start with server-side SQL aggregate queries.

Only introduce summary/materialized tables if performance proves necessary.

Potential views:

- `business_funnel_daily`
- `source_performance_daily`

Do not build a data warehouse in V1.

## 11.7 Attribution rule

A lead keeps its captured source identity.

Outcome events reference the same `lead_id`.

Therefore source reporting is derived by joining:

```text
lead_sources
→ leads
→ bookings / outcome fields
```

No ML attribution.

---

# 12. Integrations

**Goal:** Keep external dependencies understandable, testable and replaceable.

## 12.1 Integration adapter contract

Each provider adapter should implement only the functions the product needs.

Example conceptual interface:

```ts
interface MessagingProvider {
  sendMessage(input): Promise<SendResult>
  verifyWebhook(request): Promise<boolean>
  parseInbound(request): Promise<InboundMessage[]>
  parseStatus(request): Promise<MessageStatusEvent[]>
}
```

## 12.2 Meta Lead Ads

### Purpose

Receive new paid/social lead form enquiries.

### Connection flow

1. User chooses `Connect Meta`.
2. OAuth starts server-side.
3. Callback validates state.
4. Store provider connection reference securely.
5. Query/select Pages.
6. Query/select lead forms.
7. Store selected external objects.
8. Subscribe webhook.
9. Test connection.

### Inbound lead flow

```text
Meta webhook
  ↓
verify
  ↓
idempotency record
  ↓
resolve form → business
  ↓
obtain lead data
  ↓
normalize
  ↓
create lead
  ↓
queue lead.process
```

## 12.3 Twilio SMS

### Send

Input:

- business
- recipient
- message
- idempotency/send key

Output:

- provider id
- accepted/failed

### Delivery webhook

Update:

- queued
- sent
- delivered
- failed

### Inbound

Resolve using:

- destination number
- sender phone
- active conversation/business mapping

## 12.4 WhatsApp

Keep behind same messaging abstraction.

Rules:

- provider-specific templates/session restrictions respected
- status webhooks normalized to same message states
- inbound messages normalized to same conversation flow

## 12.5 Calendly

Configuration:

- integration
- booking/event URL
- optional webhook secret/config

On qualification:

- send booking link

On booking webhook:

- create booking
- set lead BOOKED
- stop follow-ups

## 12.6 Google Calendar

Configuration:

- OAuth token
- calendar id

Access:

server only.

No token returned to client.

## 12.7 Stripe

Use Stripe for:

- plans
- subscriptions
- payment method
- invoices
- customer portal

Stripe webhook is authoritative.

Important events to process:

- subscription created/updated/deleted
- invoice paid
- invoice payment failed

Mirror only required subscription state in Supabase.

## 12.8 Resend

System emails:

- welcome
- invite
- human handover alert
- integration failure alert
- campaign completed
- billing support notifications

Do not use Resend for lead SMS-like sequences.

## 12.9 Integration table

`integrations`

Fields:

- id
- business_id
- provider_type
- status
- external_account_id
- encrypted_secret_reference / server-controlled config
- scopes
- last_success_at
- last_error_at
- last_error_code
- created_at
- updated_at

Never put access tokens in browser-readable query results.

## 12.10 Integration object table

`integration_objects`

Examples:

- Meta Page
- Meta Form
- Google Calendar
- Calendly event type

Fields:

- business_id
- integration_id
- object_type
- external_id
- name
- enabled
- config jsonb

---

# 13. Settings, Team & Billing

**Goal:** Keep all workspace configuration in one route with tabs.

## 13.1 Route

`/app/settings`

## 13.2 Business tab

Fields:

- Business name
- Logo
- Industry
- Website
- Phone
- Timezone
- Business hours
- Service-area description

## 13.3 Services tab

Table:

- Service
- Average value
- Active
- Edit

Drawer:

- name
- description
- average value
- active
- service-specific qualification rules

## 13.4 Team tab

Columns:

- User
- Email
- Role
- Status

Actions:

- Invite
- Change role
- Remove

Roles:

- Owner
- Admin
- Member

No complex custom RBAC editor in V1.

## 13.5 Notifications tab

Toggles:

- New human handover
- New booking
- Integration failure
- Campaign completed
- Daily summary

## 13.6 Messaging tab

Fields:

- Default signature
- Quiet hours
- Opt-out wording
- Default opening template
- Fallback channel

## 13.7 Billing tab

Display:

- Plan
- Subscription status
- Current period
- Lead usage
- Message usage
- Upgrade
- Manage billing

`Manage billing` launches Stripe Customer Portal.

## 13.8 Account tab

- First name
- Last name
- Email
- Password reset
- Logout all sessions later if required
- Delete account/workspace request

---

# 14. Administration & Platform Operations

**Goal:** Give the platform owner enough control to support customers and diagnose failures without building a huge back office.

## 14.1 Admin authorization

Admin is determined server-side.

Never rely on a browser-supplied query parameter or editable profile field alone.

Access to `/admin/*` checked in server layout/middleware plus server actions.

## 14.2 Admin Overview — `/admin`

Cards:

- Active customers
- Trials
- MRR mirror
- New signups
- Leads processed today
- Messages today
- Bookings today
- Failed jobs

Panels:

- Recent signups
- Recent cancellations
- Provider health
- Action required

## 14.3 Customers — `/admin/customers`

Columns:

- Business
- Owner
- Plan
- Subscription
- Leads this period
- Messages this period
- Integration health
- Joined
- Last activity

Filters:

- Trial
- Active
- Past due
- Cancelled
- Integration problem

## 14.4 Customer drawer

Read:

- Business data
- Members
- Plan
- Usage
- Integrations
- Last events
- Recent errors

Support actions:

- resend onboarding email
- trigger integration health check
- suspend workspace
- audited support session if implemented

Never show raw tokens.

## 14.5 System — `/admin/system`

Tabs:

### Integrations

- provider
- healthy
- degraded
- disconnected counts

### Webhooks

- provider
- external event id
- received
- status
- attempts
- last error
- retry button where safe

### Messaging

- sent
- delivered
- failed
- inbound
- opt-outs

### Billing Events

- event type
- customer
- processed
- error

### Errors

- internal id
- area
- message
- time
- Sentry reference

---

# PART III — Supabase Data Architecture

# 15. Core Database Model

## 15.1 Tenant principle

Every tenant-owned table contains:

```sql
business_id uuid not null
```

Do this even where the business could technically be inferred through another join.

Benefits:

- simpler RLS
- simpler indexes
- easier support queries
- easier audit
- easier analytics
- less accidental cross-tenant leakage

## 15.2 Canonical tables

| Table | Purpose |
|---|---|
| `profiles` | Human user profile |
| `businesses` | Tenant/workspace |
| `business_members` | User membership and basic role |
| `business_settings` | Operational workspace config |
| `services` | Services offered |
| `qualification_questions` | Ordered lead questions |
| `qualification_options` | Choice options |
| `qualification_rules` | Deterministic rules |
| `qualification_answers` | Lead answers |
| `leads` | Main lead record |
| `lead_sources` | Meta/source attribution |
| `lead_assignments` | Assignment history |
| `conversations` | Channel conversation |
| `messages` | Inbound/outbound messages |
| `message_events` | Delivery state events |
| `automation_definitions` | Automation type |
| `automation_versions` | Draft/published versions |
| `automation_steps` | Timed sequence steps |
| `automation_runs` | Per-lead execution |
| `bookings` | Booking record |
| `campaigns` | Reactivation campaign |
| `campaign_contacts` | Campaign recipient state |
| `imports` | CSV import state |
| `integrations` | Provider connection registry |
| `integration_objects` | Selected external forms/calendars |
| `field_mappings` | External → internal lead fields |
| `webhook_events` | Idempotent external event inbox |
| `jobs` | Async work if DB-backed queue chosen |
| `usage_events` | Lead/message usage |
| `subscriptions` | Stripe entitlement mirror |
| `notifications` | User-visible alerts |
| `audit_log` | Sensitive action log |

## 15.3 Foreign-key rules

- Every `business_members.business_id` → `businesses.id`
- Every lead-owned child → both business + parent
- Delete business uses controlled server workflow.
- Avoid broad cascading deletes on audit/billing records.
- Operational children may cascade only where safe and tested.

## 15.4 Enums

Prefer constrained text/check or Postgres enum where stable.

Core statuses:

### Lead

- NEW
- CONTACTED
- RESPONDED
- QUALIFIED
- BOOKED
- WON
- LOST

### Message

- QUEUED
- SENT
- DELIVERED
- FAILED
- RECEIVED

### Integration

- HEALTHY
- DEGRADED
- ACTION_REQUIRED
- DISCONNECTED
- TESTING

### Automation run

- ACTIVE
- PAUSED
- COMPLETED
- STOPPED
- FAILED

### Campaign

- DRAFT
- SCHEDULED
- RUNNING
- PAUSED
- COMPLETED
- CANCELLED

### Subscription

- TRIALING
- ACTIVE
- PAST_DUE
- CANCELLED
- UNPAID

## 15.5 Indexes

Required:

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
notifications(user_id, read_at, created_at)
```

## 15.6 Timestamps

Use `timestamptz`.

Store UTC.

Convert using `businesses.timezone` in UI/business logic.

---

# 16. Row Level Security Bible

## 16.1 Core RLS rule

All browser-accessible tenant tables use RLS.

Never make a table browser-readable merely because the UI currently hides it.

## 16.2 Membership helper

Create a database helper such as:

```sql
is_business_member(target_business_id uuid)
```

Conceptually:

```text
auth.uid()
  ↓
business_members
  ↓
matching active business_id
```

Additional helper:

```sql
has_business_role(target_business_id uuid, allowed_roles text[])
```

## 16.3 SELECT policy pattern

```text
user can SELECT row
IF active membership exists for row.business_id
```

## 16.4 INSERT policy pattern

```text
user can INSERT
IF new business_id belongs to user
AND role allows insertion
```

Server-controlled ingestion tables should not permit direct client insert.

## 16.5 UPDATE policy

Rules:

- member belongs to same business
- allowed role
- `business_id` cannot be changed
- protected provider/system fields changed only via server

## 16.6 DELETE

Use sparingly.

Examples:

User may delete:

- draft automation step
- draft campaign
- unused service

User may not casually hard-delete:

- sent message
- webhook event
- audit event
- billing event
- provider integration evidence

## 16.7 Service-role boundary

Service role is allowed only in:

- verified webhook handler
- background worker
- trusted admin operation
- controlled data-maintenance operation

Never:

- browser
- localStorage
- exposed environment variable
- client component
- user-visible network response

## 16.8 RLS test matrix

For each exposed table test:

| Test | Expected |
|---|---|
| Business A SELECT own row | Allowed |
| Business A SELECT Business B row | Denied/empty |
| Business A INSERT with A id | Allowed if role permits |
| Business A INSERT using B id | Denied |
| Business A UPDATE own allowed field | Allowed |
| Business A UPDATE `business_id` to B | Denied |
| Member changes billing | Denied |
| Owner changes business setting | Allowed |
| Logged-out select private table | Denied |

Automate these tests.

---

# PART IV — Backend, Webhooks & Background Processing

# 17. Next.js Application Structure

Recommended high-level tree:

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
    automations/
    qualification/
    bookings/
    campaigns/
    analytics/
    integrations/
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
    campaigns/
    billing/

components/
  app/
  leads/
  messages/
  automations/
  qualification/
  bookings/
  integrations/
  settings/
  admin/
  marketing/
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

## 17.1 Server vs client

Default:

- Server Components where possible.
- Client Components only for interactivity.
- Provider secrets never reach client.
- Mutations use Server Actions or route handlers.
- External webhook endpoints use route handlers.

## 17.2 Validation

Use a shared validation layer such as Zod.

Validate:

- forms
- query filters
- route params
- webhook-normalized payloads
- CSV rows
- provider callback state

Do not rely only on TypeScript compile-time types.

---

# 18. Webhook Architecture

## 18.1 Webhook inbox

Every external event first creates/locates a `webhook_events` row.

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

## 18.2 Idempotency

Unique constraint:

```text
(provider, external_event_id)
```

If duplicate:

- return success
- do not repeat business action

## 18.3 Meta webhook

Must:

1. verify request
2. acknowledge promptly
3. identify selected form
4. resolve tenant
5. create ingestion job

Do not wait for SMS sending before responding to Meta.

## 18.4 Twilio/status webhook

Normalize provider-specific status into:

- SENT
- DELIVERED
- FAILED

Store event history.

## 18.5 Inbound message webhook

Resolve:

1. destination business sender
2. lead phone
3. active conversation
4. inbound message
5. stop pending no-response automation
6. qualification progression or handover

## 18.6 Stripe webhook

Verify signature.

Process idempotently.

Update `subscriptions`.

Do not trust client checkout-complete redirect as billing truth.

---

# 19. Background Jobs

## 19.1 Required job types

- `lead.process`
- `message.send`
- `automation.advance`
- `message.process_inbound`
- `booking.sync`
- `campaign.expand`
- `campaign.send`
- `integration.health_check`
- `notification.send`
- `usage.aggregate`
- `retention.cleanup`

## 19.2 Job fields

If database-backed:

- id
- type
- business_id nullable
- payload jsonb
- state
- run_at
- attempts
- locked_at
- completed_at
- last_error

## 19.3 Worker rule

Workers must:

- claim job atomically
- be retry-safe
- validate current state before external action
- record failure
- cap retries
- move permanent failure to failed/dead state
- create admin-visible issue where needed

## 19.4 Retry policy

### Retry

- provider timeout
- 5xx
- temporary network error
- explicit rate limit

### Do not blindly retry

- bad phone
- revoked permission
- invalid template
- invalid OAuth
- permanent provider validation error

---

# PART V — Deterministic Algorithms

# 20. Speed-to-Lead Logic

On lead creation:

```text
IF business active
AND subscription permits
AND lead not duplicate
AND lead not suppressed
AND messaging integration healthy

THEN
  create conversation
  create automation run
  queue first message now
```

Record:

- lead received time
- first contact queued time
- first sent time
- first delivered time

Metric:

```text
speed_to_lead = first_sent_at - created_at
```

---

# 21. Qualification Logic

No ML.

No model score.

No natural-language inference beyond simple exact/normalized matching.

## 21.1 Evaluation order

1. Required questions complete?
2. Service valid?
3. Service area valid?
4. Explicit hard-fail rules?
5. Required accepted values?
6. Any manual-review field?
7. Result.

## 21.2 Result

```text
IF hard fail:
    NOT_QUALIFIED

ELSE IF unanswered required:
    PENDING

ELSE IF uncertain/manual field:
    REVIEW

ELSE:
    QUALIFIED
```

## 21.3 Booking readiness

Booking is allowed when:

- qualification = QUALIFIED
- no opt-out
- no human block
- booking destination exists

---

# 22. Follow-Up Scheduling Logic

Default:

```text
0 minutes
10 minutes
2 hours
1 day
3 days
```

Every due step:

```text
re-fetch lead
re-fetch run
re-fetch business
re-fetch subscription
re-fetch channel health

IF stop:
   stop
ELSE:
   send
```

No stale scheduled job may bypass the current lead state.

---

# 23. Human Handover Logic

Set `human_takeover = true` if:

- lead explicitly requests a person
- answer cannot be matched reliably
- lead sends unsupported/complex free text and business has chosen manual handling
- business manually takes over
- message failure requires manual contact

Effect:

- stop automation
- mark needs attention
- notify assigned user/owner

---

# 24. Reactivation Eligibility Algorithm

Lead is eligible if:

```text
belongs to business
AND opted_out = false
AND phone valid
AND not WON
AND not BOOKED
AND no active automation
AND no active conversation conflict
AND last outbound older than cooldown
AND matches selected segment
```

Always calculate eligibility again immediately before send.

---

# 25. Usage & Plan Enforcement

Usage dimensions:

- new leads processed
- messages sent
- active users

Server checks entitlement before:

- processing beyond permitted plan rules
- campaign launch
- inviting excess users

Do not enforce only in UI.

---

# PART VI — Security, Compliance & Audit

# 26. Security Rules

- HTTPS only.
- All secrets server-side.
- Supabase service role server-side.
- Verify OAuth state.
- Verify webhook signatures.
- Rate-limit sensitive endpoints.
- Validate all inputs.
- Sanitize uploaded CSV handling.
- No arbitrary file execution.
- Restrict file MIME/type and size.
- Log important mutations.
- Avoid logging raw secrets or full provider payloads.
- Use Sentry scrubbing for sensitive values.

---

# 27. Consent, Opt-Out & Suppression

## 27.1 Suppression record

Create a canonical suppression mechanism.

Suggested table:

`contact_suppressions`

Fields:

- business_id
- normalized_contact
- channel
- reason
- created_at
- source

## 27.2 Opt-out

If inbound message is recognized as configured stop keyword:

Examples:

- STOP
- UNSUBSCRIBE

Then:

- mark channel suppressed
- stop automation
- stop campaign sends
- audit event
- optional compliant confirmation

Keep matching deterministic.

## 27.3 Campaign safeguards

Before campaign launch show:

- eligible
- opted out
- recently contacted
- invalid
- active
- booked/won

The user should know why records were suppressed.

## 27.4 Legal rule

Client Turn provides the technical control layer.

Production messaging policy and wording must be reviewed for the business's lawful use and applicable UK privacy/direct-marketing requirements.

---

# 28. Audit Log

Audit:

- user invited/removed
- role changed
- integration connected/disconnected
- automation published
- campaign launched
- campaign cancelled
- manual lead status change
- human takeover
- opt-out override attempt
- billing plan change
- support impersonation/session
- workspace suspension

Fields:

- business_id
- actor_user_id nullable
- actor_type
- action
- entity_type
- entity_id
- metadata
- created_at

Audit log is append-only for normal users.

---

# PART VII — Components & Design Contract

# 29. Shared Component Register

| Component | Purpose |
|---|---|
| `AppShell` | Customer application frame |
| `Sidebar` | Navigation |
| `TopBar` | Context/actions |
| `PageHeader` | Page title/action |
| `StatCard` | Single KPI |
| `FunnelChart` | Lead funnel |
| `DataTable` | Operational lists |
| `FilterBar` | Search/filter |
| `StatusBadge` | Shared statuses |
| `LeadDrawer` | Reusable lead detail |
| `ConversationThread` | Message history |
| `MessageComposer` | Manual send |
| `QualificationSummary` | Question/answer state |
| `AutomationCard` | Automation summary |
| `SequenceEditor` | Linear steps |
| `IntegrationCard` | Provider connection |
| `HealthBadge` | Integration health |
| `WizardShell` | Multi-step flows |
| `SettingsTabs` | Settings route |
| `EmptyState` | No records |
| `ErrorState` | Recoverable error |
| `Skeleton` | Loading |
| `ConfirmDialog` | Destructive action |
| `Toast` | Mutation feedback |

## 29.1 Design rules

- Bright, clean SaaS UI.
- Clear hierarchy.
- Dense enough for business use.
- Moderate radius, not oversized bubbly cards.
- One primary accent color.
- Green only for success/healthy.
- Amber for warning.
- Red for error/action required.
- Consistent status badge mapping.
- Tables on desktop.
- Mobile cards/sheets where tables become unusable.
- Primary action top-right of page header.
- No decorative dashboard clutter.

---

# PART VIII — Page-by-Page Build Checklist

# 30. Main Landing Page Build Checklist

- [ ] Sticky header
- [ ] Hero
- [ ] CTA analytics
- [ ] Product mockup
- [ ] Cost-of-delay section
- [ ] Outcome cards
- [ ] How it works
- [ ] Conversation demo
- [ ] Why it works
- [ ] Industries
- [ ] Reactivation
- [ ] Analytics preview
- [ ] Integrations
- [ ] Pricing
- [ ] FAQ
- [ ] Final CTA
- [ ] Footer
- [ ] SEO metadata
- [ ] Open Graph
- [ ] Mobile
- [ ] Accessibility

# 31. Signup/Login Build Checklist

- [ ] Supabase Auth configured
- [ ] signup
- [ ] login
- [ ] email verification
- [ ] forgot password
- [ ] reset password
- [ ] workspace creation
- [ ] owner membership
- [ ] redirects
- [ ] auth errors
- [ ] session protection

# 32. Onboarding Build Checklist

- [ ] persisted progress
- [ ] business
- [ ] services
- [ ] qualification
- [ ] Meta
- [ ] messaging
- [ ] booking
- [ ] test
- [ ] activation
- [ ] integration error states
- [ ] resume behavior

# 33. Dashboard Build Checklist

- [ ] KPI queries
- [ ] funnel
- [ ] recent leads
- [ ] needs attention
- [ ] source table
- [ ] pipeline estimate
- [ ] setup health
- [ ] date filter
- [ ] drilldown

# 34. Leads Build Checklist

- [ ] status tabs
- [ ] filters
- [ ] search
- [ ] server pagination
- [ ] lead drawer
- [ ] conversation
- [ ] qualification
- [ ] booking
- [ ] timeline
- [ ] assignment
- [ ] manual send
- [ ] human takeover
- [ ] won/lost

# 35. Automations Build Checklist

- [ ] default definitions
- [ ] sequence editor
- [ ] merge fields
- [ ] validation
- [ ] draft/publish
- [ ] worker
- [ ] stop conditions
- [ ] quiet hours
- [ ] test message
- [ ] retries

# 36. Qualification Build Checklist

- [ ] questions
- [ ] options
- [ ] rules
- [ ] service scope
- [ ] answer capture
- [ ] evaluation
- [ ] REVIEW state
- [ ] qualification summary
- [ ] booking trigger

# 37. Bookings Build Checklist

- [ ] booking mode
- [ ] Calendly
- [ ] optional Google Calendar
- [ ] webhook if used
- [ ] booking records
- [ ] status tabs
- [ ] detail drawer
- [ ] stop follow-up when booked

# 38. Campaigns Build Checklist

- [ ] campaign list
- [ ] audience wizard
- [ ] suppression
- [ ] CSV import
- [ ] message
- [ ] timing
- [ ] review counts
- [ ] paced worker
- [ ] replies stop sends
- [ ] campaign metrics

# 39. Analytics Build Checklist

- [ ] overview
- [ ] sources
- [ ] follow-up
- [ ] campaigns
- [ ] date range
- [ ] service filter
- [ ] source joins
- [ ] no test leads
- [ ] correct denominator definitions

# 40. Integrations Build Checklist

- [ ] Meta OAuth
- [ ] Meta forms
- [ ] field mapping
- [ ] Meta webhook
- [ ] Twilio
- [ ] inbound reply
- [ ] delivery events
- [ ] WhatsApp optional
- [ ] Calendly
- [ ] Google optional
- [ ] Stripe
- [ ] Resend
- [ ] health status
- [ ] reconnect

# 41. Settings Build Checklist

- [ ] business
- [ ] services
- [ ] team
- [ ] role checks
- [ ] notifications
- [ ] messaging
- [ ] billing
- [ ] account

# 42. Admin Build Checklist

- [ ] admin auth
- [ ] overview
- [ ] customers
- [ ] customer drawer
- [ ] system
- [ ] webhooks
- [ ] retries
- [ ] messaging health
- [ ] billing events
- [ ] errors
- [ ] audit support actions

---

# PART IX — Build Order

# 43. Phase 0 — Foundation

Build:

- Next.js project
- TypeScript
- Supabase project
- environments
- migrations
- Auth
- Vercel
- Sentry
- PostHog
- shared components
- base RLS helpers
- automated RLS tests

**Exit condition:** user can sign up and access an isolated empty workspace.

---

# 44. Phase 1 — Landing & Authentication

Build:

- `/`
- legal pages
- signup
- login
- reset
- workspace creation
- attribution capture

**Exit condition:** paid traffic can land and create a workspace.

---

# 45. Phase 2 — Core Lead Application

Build:

- app shell
- dashboard skeleton
- leads
- lead drawer
- conversations
- statuses
- seeded fixtures

**Exit condition:** UI can operate a lead manually.

---

# 46. Phase 3 — Onboarding + Meta + SMS

Build:

- setup wizard
- Meta connection
- form mapping
- webhook inbox
- lead ingestion
- Twilio SMS
- inbound replies
- delivery updates
- test lead

**Exit condition:** a real Meta lead appears and receives the first configured SMS.

This is the first genuinely sellable technical milestone.

---

# 47. Phase 4 — Automation Engine

Build:

- automation tables
- default sequences
- editor
- run scheduler
- quiet hours
- stop conditions
- retry behavior

**Exit condition:** a non-responsive lead receives the configured sequence and it stops immediately on reply.

---

# 48. Phase 5 — Deterministic Qualification

Build:

- questions
- options
- rules
- answers
- qualification state
- REVIEW state
- handover

**Exit condition:** a lead can move from response to QUALIFIED without AI.

---

# 49. Phase 6 — Booking

Build:

- Calendly first
- booking link action
- optional Calendly webhook
- bookings page
- status updates

Optional after:

- Google Calendar

**Exit condition:** qualified lead can book and the app records the outcome.

---

# 50. Phase 7 — Stripe Billing

Build:

- plans
- checkout
- subscriptions
- webhook
- customer portal
- entitlements
- usage

**Exit condition:** paid subscription state governs product access.

---

# 51. Phase 8 — Reactivation

Build:

- campaign wizard
- existing-lead segments
- CSV import
- suppression
- pacing
- campaign result tracking

**Exit condition:** old eligible leads can be re-contacted safely.

---

# 52. Phase 9 — Analytics + Admin

Build:

- source analytics
- follow-up analytics
- campaign analytics
- admin overview
- customers
- system health
- webhook retry

**Exit condition:** both customer and operator can understand product performance and failures.

---

# 53. Phase 10 — Launch Hardening

Required:

- RLS penetration tests
- cross-tenant tests
- webhook replay tests
- message duplication tests
- queue failure tests
- provider disconnect tests
- Stripe state tests
- opt-out tests
- rate limiting
- backup configuration
- error alerts
- legal pages
- privacy review
- production-domain setup
- transactional email
- support process
- performance testing

---

# PART X — Acceptance Criteria

# 54. Commercial V1 Acceptance Matrix

| Area | Must be true |
|---|---|
| Landing | Visitor understands offer and reaches signup |
| Signup | User creates tenant successfully |
| RLS | One tenant cannot read/write another tenant |
| Onboarding | Setup is resumable |
| Meta | Selected form delivers lead to correct tenant |
| Idempotency | Duplicate webhook does not duplicate lead |
| SMS | Automatic first message sends |
| Delivery | Status updates are stored |
| Reply | Inbound reply maps correctly |
| Automation | Due steps send at configured times |
| Stop logic | Reply/booking/opt-out stops follow-up |
| Qualification | Explicit rules produce correct result |
| Review | Unknown answer goes to human review |
| Booking | Qualified lead receives valid path |
| Analytics | Funnel reconciles with source records |
| Stripe | Subscription controls entitlements |
| Campaigns | Suppression works before send |
| Admin | Failed webhook/job can be diagnosed |
| Monitoring | Critical integration error is surfaced |
| Mobile | Core lead flow works on mobile |
| Security | Secrets never sent to browser |

---

# 55. Launch KPI Definitions

## Activation

Customer is activated when:

- Meta connected
- form selected
- messaging healthy
- test lead passed
- automation published

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

Also show:

```text
booked leads / qualified leads
```

but label denominator clearly.

## Reactivation response rate

```text
reactivation leads replied / delivered campaign contacts
```

## Estimated pipeline

```text
sum(service.average_value for selected qualified/booked leads)
```

Not revenue.

---

# 56. Product Expansion Rules

Do not add a major feature because a developer thinks it is useful.

A feature may enter the roadmap only if:

1. customers repeatedly request it;
2. it improves acquisition, activation, conversion, retention or revenue;
3. it fits the lead-to-booking boundary;
4. it does not duplicate a stronger external tool;
5. it can be measured.

Good later additions:

- generic website form webhook
- Zapier/Make outbound events
- basic CRM push
- agency multi-client management
- additional calendars
- call tracking
- simple owner assignment rules

Bad early additions:

- full CRM
- quote builder
- invoicing
- accounting
- social posting
- ad creation
- project management
- document management
- complex visual automation canvas
- proprietary calendar
- voice bot
- AI agent
- ML scoring

---

# 57. Final Canonical Product Definition

Client Turn V1 consists of:

- **1 major public landing page**
- **5 small public/auth/legal routes**
- **1 onboarding wizard**
- **1 simple authenticated app shell**
- **8 core customer modules**
- **1 settings route with tabs**
- **3 admin routes**
- **Supabase PostgreSQL**
- **Supabase Auth**
- **strict RLS**
- **Meta Lead Ads**
- **SMS**
- **optional WhatsApp**
- **Calendly / limited Google Calendar**
- **Stripe**
- **Resend**
- **deterministic qualification**
- **deterministic follow-up**
- **source-to-booking analytics**
- **no AI**
- **no ML**
- **no full CRM**
- **no workflow-builder complexity**

The product succeeds if a business can connect its Meta forms, start receiving leads, automatically contact and follow them up, qualify them with explicit questions, push good leads to a booking/handover, and see which sources produced results.

That is the entire product boundary.

Anything outside it is a later decision.

