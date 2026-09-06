# Client Turn — Project Instructions

Meta Lead Ads → instant follow-up → deterministic qualification → booking → attribution.
UK home-service businesses. Next.js (App Router) + Supabase + Stripe + Cloudflare R2 + Azure AI.

## Canonical source documents

These documents are the specification. **Read the relevant section before building any
surface.** Do not invent features that are not in them.

| Document | Authority |
|---|---|
| [ClientTurn_Master_Domain_Architecture_V3_Simplified_Full (1).md](ClientTurn_Master_Domain_Architecture_V3_Simplified_Full%20(1).md) | **Primary for navigation, page/IA structure and route map.** Supersedes the Bible/Spec wherever they describe a different navigation shape. Canonical rule: exactly 5 primary customer destinations — Dashboard, Leads, Follow-Up, Reactivation, Settings — plus a separate Admin shell (Overview, Customers, System). |
| [ClientTurn_Master_Product_Bible_No_ML.md](ClientTurn_Master_Product_Bible_No_ML.md) | Data model, RLS, algorithms, component contract, build order, acceptance matrix. |
| [ClientTurn_Full_Product_Build_Specification.md](ClientTurn_Full_Product_Build_Specification.md) | Commercial framing, landing page copy, integration behaviour, admin scope. |
| [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) | The implementation plan derived from all three. Tracks phase status. |
| [docs/AGENT_RUNTIME.md](docs/AGENT_RUNTIME.md) | The conversation agent: architecture, guardrails, tool permissions, what the model may and may not decide. Read before changing anything under `src/lib/agent/`. |
| [docs/CRON.md](docs/CRON.md) | How background processing runs 24/7 (Supabase pg_cron -> `/api/cron/worker`). |

Where the Bible/Spec conflict with the V3 doc on **navigation/page structure**, the **V3 doc
wins**. Where the Bible/Spec conflict with each other or with V3 on anything else (data model,
algorithms, commercial framing), the **Bible wins** unless listed under "Resolved conflicts" below.

## Resolved conflicts (locked — do not reopen)

0. **Navigation/IA (2026-09-05).** The Bible/Spec describe more top-level destinations
   (Leads, Bookings, Campaigns, Automations, Analytics, Integrations, Qualification, Settings,
   Help, Profile). The V3 doc collapses this to 5 primary destinations: **Dashboard, Leads,
   Follow-Up, Reactivation, Settings.** Standalone `/app/qualification`, `/app/automations`,
   `/app/bookings`, `/app/analytics`, `/app/integrations`, and `/app/campaigns` are removed —
   their content is merged into Follow-Up (Follow-Up + Qualification tabs), Dashboard (booking
   summary + source/follow-up/reactivation performance), Settings → Connections, and Reactivation
   (renamed from Campaigns) respectively. Old routes are deleted outright, not redirected. See
   APPENDIX A/B of the V3 doc for the full removed-surface map. The underlying Supabase tables are
   unaffected — this is a UI/IA consolidation only, not a data model change.
1. **AI.** The Bible says "no AI / no ML". The Spec (§4.4, §11.10) describes an AI layer, and
   Azure AI credentials are provisioned. **Resolution:** the qualification and follow-up engines
   are 100% deterministic and remain the system of record. Azure AI is an *optional assist layer*
   that may only (a) classify an inbound message intent, (b) extract a candidate value for an
   existing configured question. Deterministic rules always make the decision. Low confidence or
   any unmatched value ⇒ `REVIEW` + human handover. **AI never composes a binding promise, quote,
   availability or service area.** Gated per plan tier and per workspace toggle; off by default.
2. **Storage.** Bible says Supabase Storage. **Resolution:** Cloudflare R2 for logos and CSV
   imports, accessed only via short-lived signed URLs generated server-side.
3. **Plans.** Bible defines 3 tiers. **Resolution:** 4 tiers — Starter / Growth / Pro (self-serve
   Stripe checkout) + Enterprise (contact sales, no public price).
4. **Admin login.** Admin uses a **separate route** `/admin/login`, separate session check, and
   mandatory step-up. `platform_role` is checked server-side against the database only.

## Non-negotiable rules

- Public marketing brand is **ClientTurn** (user-directed rebrand). Use midnight
  `#0B1020`, lime `#B7F34A`, soft lime `#E7FFC0`, cloud `#F7F9FC`, and white.
  The landing page uses a near-black (#050814) Three.js / Motion scroll experience with reduced-motion
  and WebGL fallbacks. Existing backend identifiers and provisioned email addresses
  remain unchanged until replacements are supplied.

- Every tenant table carries `business_id`. RLS on every browser-exposed table, no exceptions.
- Service-role key, provider tokens and secrets are **server-only**. Never in a client component,
  never in a `NEXT_PUBLIC_*` var, never in a response body.
- Webhooks: verify signature → write `webhook_events` row (unique on `provider, external_event_id`)
  → acknowledge fast → queue a job. Never do provider I/O inside the webhook request.
- Every job handler is retry-safe and re-reads current state before any external action.
- Every route implements: loading, empty, error, permission-denied, integration-required,
  plan-limit-reached.
- Entitlements are enforced server-side, never only in the UI.
- Follow-up respects stop conditions + quiet hours, re-checked immediately before every send.
- Never fabricate customer proof, testimonials, metrics or logos on the landing page.

## Stripe safety

`.env` holds **live** keys for a different product (Propvora). All Client Turn work uses
`STRIPE_SECRET_KEY_TEST` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST`. Never create, modify or
delete objects on the live account without explicit per-action confirmation from the user.

## Stack

Next.js 15 App Router (TS, Tailwind v4, `src/`, `@/*`) · Supabase (Postgres + Auth + RLS +
Realtime) · Stripe Billing · Cloudflare R2 (S3 API) · Azure OpenAI (EU) · Twilio SMS/WhatsApp ·
Calendly / Google Calendar · Resend.

Supabase project: **Client Turn** — ref `losieaikadkadtmezini` (eu-west-2).

## Conventions

- Server Components by default; `"use client"` only for real interactivity.
- Mutations via Server Actions; external ingress via route handlers under `src/app/api/`.
- Zod validates every form, filter, route param, webhook payload and CSV row.
- Supabase clients: `@/lib/supabase/client` (browser), `server` (RSC/actions), `admin`
  (service-role, server-only — import must never appear in a client file).
- Design tokens in `src/app/globals.css`; primitives in `src/components/ui/`. Reuse before adding.
  One accent colour; green = healthy, amber = warning, red = action required.
- Status badge mapping lives in exactly one place.

## Commands

```
npm run dev        # dev server
npm run build      # production build
npm run lint
npx tsc --noEmit   # typecheck (run after `next build` so generated types exist)
```
