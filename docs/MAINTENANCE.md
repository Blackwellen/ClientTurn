# Maintenance mode, site offline and banners: runbook

Admin → **Site** (`/admin/site`). Platform admins only; every change needs a
step-up (your password in the last 30 minutes) and is written to the audit log,
which is the History panel on the same page.

Migration: `supabase/migrations/0161_platform_maintenance_and_banners.sql`.
Until it is applied the page says so and nothing can be switched; the site runs
normally (maintenance fails open).

## The levels

| Level | What customers see | Writes |
|---|---|---|
| **Off** | Everything normal | Allowed |
| **Read only** | The app loads; a critical "changes are paused" notice at the top | Refused everywhere a person acts: Server Actions, API writes, MCP writes, the OAuth connect flow. Sign-in still works. |
| **App offline** | `/app`, sign-in, onboarding, `/api/*` and MCP show the maintenance page (HTTP 503). The website stays up. | Refused (levels are cumulative) |
| **Site offline** | The website shows the maintenance page too | Refused |

A refused Server Action shows "ClientTurn is in maintenance, so changes are
paused. Nothing was saved." API clients get `503` JSON
(`{"error":{"code":"maintenance_read_only",...}}`) with `Retry-After`.

## What always stays up

At every level, untouched:

- `/admin/*` and `/admin/login` (so you can switch it off);
- `/status`;
- `/api/webhooks/*`: Stripe, Twilio, Meta, Calendly, Google Ads, LinkedIn,
  Retell, Slack, payment endpoints. Leads, payments and STOPs are accepted and
  queued exactly as normal;
- `/api/cron/*`: the worker keeps draining the queue;
- health checks (`/api/health`, `/healthz`), `robots.txt`, `sitemap.xml`,
  static files;
- legal pages and opt-outs: `/privacy`, `/terms`, `/cookies`,
  `/sub-processors`, `/data-deletion`, `/privacy-request`, `/unsubscribe`,
  `/api/unsubscribe`;
- `/q/*` public quote pages, **if** "Keep public quote pages online" is ticked
  (the default);
- the banner-dismiss endpoint.

The worker's own work continues at every level (runOperation lets `SYSTEM` and
the conversation `AGENT` through). **Outbound sends** are held during App
offline and Site offline (rescheduled to the end of the window, re-checked every
15 minutes) unless "Keep automated follow-up running" is ticked. Read only never
holds sends. Opt-outs and stop conditions still abort as normal; a hold never
outranks a stop. Voice dialling is not held by this switch (use the voice
controls in Admin → System).

## Schedule maintenance

1. Admin → Site → **Schedule maintenance**.
2. Choose the level. Choose **Schedule** and a start, or **Start now**.
3. Optional: an automatic end, an "expected back" time, a message for customers
   (plain text), an internal reason.
4. Options: keep quote pages online, keep automated follow-up running, show the
   upcoming-maintenance banner 24 hours before (default on), email workspace
   owners.
5. Confirm. For **App offline** and **Site offline** you must type the level
   name (`APP_OFFLINE` / `SITE_OFFLINE`).

All times are typed and shown in **Europe/London**; the database stores UTC.
Only one window may be in force at a time; overlapping windows are refused.

Start and end are evaluated by the clock on every read. No job has to fire, so
a missed cron tick cannot leave the site offline. Changes reach every server
within about **20 seconds** (the per-instance cache TTL); the server that made
the change sees it at once.

## End maintenance

- **End maintenance now** on the state card (or **End now** in the list). An
  active window ends immediately; a scheduled one is cancelled.
- Or let the scheduled end pass: the site comes back on its own.

## Email workspace owners

Tick "Email workspace owners about this maintenance" when scheduling, or press
**Email owners** on the window. One `notification.send` job per workspace, one
email per owner, sent once per window: the window row's `notice_queued_at` is
claimed before anything is queued, and each job has a unique idempotency key.
Each copy counts against the workspace's daily system-email cap. A window
cancelled before the job runs sends nothing.

## Banners

Admin → Site → **Banners and announcements** → New banner.

- Plain text title and body, one optional link (a `/path` or an `https://`
  URL). No HTML.
- Tone: info, success, warning, critical (colours from the one badge mapping).
- Audience: everyone, app users, website visitors, specific plans (trial,
  starter, growth, pro, enterprise), specific workspaces, owners and admins.
- Placement: app top bar, website top bar, dashboard card. The website only
  ever shows Everyone / Website-visitor banners.
- Start and end (auto-ending), dismissible or not, priority 0-100.

Rules: **one banner per placement**, the highest priority. Dismissals are per
person (server-side for signed-in users, localStorage for website visitors).
The upcoming-maintenance notice is automatic and separate from admin banners.

Stacking in the app top bar: critical platform notices (including maintenance
in progress) first, then the account notice (trial, dunning, allowance), then
other platform banners. At most two visible; the rest collapse behind "N more
notices". Upsell moments and the trial-upgrade prompt are modals, not banners.

## Status page

While a window is active or scheduled (within 30 days), `/status` shows a
maintenance card with the window, and the headline reads **Maintenance** while
it is active (unless something is actually down).

## SEO

Every maintenance response is `503` with `Retry-After`, `Cache-Control:
no-store` and `X-Robots-Tag: noindex`; the page carries `<meta name="robots"
content="noindex">`. Search engines treat that as temporary, so a Site offline
window does not drop pages from the index.

## Admin bypass

A platform admin with a valid session can still open the app and the website
while they are offline (the proxy verifies the Supabase session and
`profiles.platform_role` from the database). A **Maintenance bypass** pill
shows in the bottom-left corner. Writes stay paused for admins too.

## Break-glass: the database is down

If the database is unreachable you cannot switch maintenance in the admin.
Set on the deployment and redeploy:

```
MAINTENANCE_OVERRIDE_LEVEL=SITE_OFFLINE     # or READ_ONLY / APP_OFFLINE
MAINTENANCE_OVERRIDE_MESSAGE=We're restoring service.
MAINTENANCE_OVERRIDE_UNTIL=2026-10-01T12:00:00Z
```

Remove the variables and redeploy to lift it. The admin page shows when an
override is in force.

## Failure behaviour

The maintenance read fails **open**: if the state cannot be read, the last
good value is used for up to five minutes, then maintenance is assumed off. A
database blip never takes the site offline on its own.

## Code map

- `src/lib/maintenance/`: `types`, `schedule` (clock, London time), `routes`
  (the proxy decision), `response` (503 page), `state` (cached read),
  `proxy-gate`, `authz`, `email`, `notices`, `notice-send`, `admin`, `actions`.
- `src/lib/banners/`: `types`, `select` (audience, placement, priority,
  dismissal, stacking), `rows`, `server`.
- `src/components/site/`: the banners, notice stack, bypass pill, status card.
- `src/components/admin/site/` and `src/app/admin/(ops)/site/`: the admin page.
- Enforcement hooks: `src/proxy.ts`, `runOperation` in
  `src/lib/services/runtime.ts`, `evaluateSend` in `src/lib/jobs/send-core.ts`.
- Tests: `maintenance-decision`, `maintenance-schedule`, `banners-select`,
  `maintenance-admin` (unit), `maintenance-runtime` (e2e-resolver group).
