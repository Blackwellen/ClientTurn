# Data flow

How personal data moves through ClientTurn, from the moment a lead arrives to where it is
stored, and in which region. Every statement here is checked against the code or config
(paths given). Sub-processor contracts and regions are on `/sub-processors`
(`src/lib/marketing/subprocessors.ts`); the customer DPA is `/dpa`.

## Diagram

```mermaid
flowchart LR
  subgraph Sources["Lead sources (customer-connected)"]
    META[Meta Lead Ads]
    GADS[Google Ads lead forms]
    LIADS[LinkedIn / TikTok lead forms]
    CRM[HubSpot / Zoho / Salesforce / Pipedrive inbound]
    APPS[Custom apps: HMAC-signed events]
    API[Public API v1 + MCP<br/>workspace API keys]
    CSV[CSV import<br/>R2 signed upload]
    FIND[Find Leads<br/>Google Places + company websites<br/>+ Companies House]
  end

  subgraph Edge["Vercel (app + route handlers)"]
    WH["/api/webhooks/*<br/>verify signature → webhook_events<br/>(unique provider+event id) → 200"]
    UI[Next.js app + Server Actions<br/>Supabase Auth session]
  end

  subgraph DB["Supabase Postgres — London eu-west-2<br/>RLS on every tenant table"]
    EV[(webhook_events)]
    Q[(jobs queue)]
    CORE[(leads, conversations, messages,<br/>qualification, bookings, quotes,<br/>invoices, voice_calls, audit_log)]
  end

  CRON[pg_cron every minute → /api/cron/worker]

  subgraph Worker["Job handlers (Vercel functions)"]
    ING[ingest + dedupe + suppression +<br/>permission record]
    QUAL[deterministic qualification<br/>+ follow-up scheduler<br/>stop conditions, quiet hours re-checked before send]
    AI[optional AI assist<br/>Azure OpenAI, EU<br/>classify intent / extract candidate value]
  end

  subgraph Channels["Outbound channels"]
    RESEND[Resend: email]
    SMTP[Customer's own mailbox<br/>SMTP/IMAP]
    TWILIO[Twilio: SMS / WhatsApp<br/>voice numbers]
    RETELL[Retell AI: voice calls<br/>US (AWS US regions)]
    CAL[Google Calendar / Calendly]
    STRIPE_C[Customer's own Stripe<br/>quote + invoice payments]
    CRMOUT[CRM push / Slack]
  end

  R2[(Cloudflare R2<br/>EU jurisdiction<br/>logos, CSVs, support files,<br/>quote PDFs, recordings)]
  STRIPE[Stripe: ClientTurn subscription billing]

  META & GADS & LIADS & CRM & APPS --> WH --> EV --> Q
  API --> UI
  CSV --> R2
  FIND --> ING
  UI --> CORE
  UI --> Q
  CRON --> Worker
  Q --> ING --> CORE
  ING --> QUAL
  QUAL <--> AI
  QUAL --> RESEND & SMTP & TWILIO & RETELL & CAL & CRMOUT
  UI --> STRIPE_C
  RESEND & TWILIO & RETELL & STRIPE_C --> WH
  Worker --> R2
  UI --> STRIPE
```

## Prose

**1. Lead sources.** Leads arrive by provider webhook (Meta, Google Ads, LinkedIn/TikTok lead
forms, Calendly, CRM inbound connectors, custom apps), by the public API or MCP (workspace
API keys, `src/lib/api-keys/`), by CSV import (uploaded straight to R2 with a 5-minute signed
PUT URL, `src/lib/storage/r2.ts`), or from Find Leads. Find Leads uses Google Places for
discovery only (place ID and website domain kept, nothing else,
`src/lib/find-leads/server/providers/google-places.ts`), the company's own website (fetched
through `src/lib/security/safe-fetch.ts`) and Companies House. No paid enrichment vendor is
used (Apollo, Hunter and Clearbit are disabled; CLAUDE.md resolved conflict 7).

**2. Webhooks.** Each route under `src/app/api/webhooks/` verifies the provider signature or
shared secret, writes a `webhook_events` row (unique on provider + external event id, so a
replay is a no-op), acknowledges, and queues a job. No provider I/O happens inside the request.
All are rate limited (`webhook:inbound`).

**3. Queue and worker.** `jobs` lives in Postgres. Supabase pg_cron calls
`/api/cron/worker` every minute with a bearer secret (`src/lib/security/cron-auth.ts`,
`docs/CRON.md`). Handlers are retry-safe and re-read current state before any external action.

**4. Qualification and follow-up.** Deterministic: rules and configured questions decide
(`src/lib/qualification/`, `src/lib/follow-up/`). Stop conditions, suppression and quiet hours
are re-checked immediately before every send, and every contact decision is recorded in
`compliance_decisions`.

**5. AI assist (optional, off by default).** Azure OpenAI in the EU may classify an inbound
message's intent or extract a candidate value for an existing question. It sees the message
text and the question. It never decides a verdict, and never composes a price, quote,
availability or service-area promise (`docs/AGENT_RUNTIME.md`).

**6. Channels.** Email through Resend or the customer's own mailbox (password encrypted with
AES-256-GCM, `src/lib/security/secret-box.ts`); SMS/WhatsApp through Twilio, only to a mobile the
person submitted themselves; AI voice calls through Retell AI with Twilio numbers
(`docs/VOICE.md`); bookings into Google Calendar or Calendly; pushes to the customer's CRM or
Slack. Quote and invoice payments are taken on the customer's own Stripe account.

**7. Storage and regions.**

| Store | What | Region |
|---|---|---|
| Supabase Postgres + Auth | all records, audit log, queue | London, eu-west-2 |
| Cloudflare R2 | logos, CSV imports, support attachments, quote/invoice PDFs, call recordings | EU jurisdiction; private bucket, signed URLs only |
| Vercel | compute, transient request logs | US primary compute, global edge |
| Providers | per `/sub-processors` | as listed |

**8. Egress controls.** Customer-supplied URLs (website analysis, outgoing webhooks) go
through `safe-fetch` (public addresses only, DNS resolved and checked, each redirect
re-checked). Outgoing webhooks to the customer are HMAC-signed (`docs/DEVELOPER_PLATFORM.md`).

**9. Deletion.** Retention settings and data-rights tools delete or anonymise records; on
cancellation the workspace is read-only for 90 days, then deleted (`docs/BILLING.md`,
`supabase/migrations/0170_workspace_day90_deletion.sql`). R2 objects under the workspace
prefixes are removed with it.
