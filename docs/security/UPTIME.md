# Uptime commitment, status page and incident process

## Stated target

**99.5% monthly availability target** for the ClientTurn application (sign-in, app pages,
lead webhooks and the API), measured as the share of minutes in a calendar month in which
those surfaces respond successfully, excluding announced planned maintenance.

This is a **target, not a contractual SLA**. Terms of Service clause 18.2: self-serve plans
have no contractual uptime commitment or service credits; an Enterprise customer may agree a
separate SLA, which then takes precedence for that customer. Do not quote a higher figure
until there is a quarter of measured history behind it.

Why 99.5%: the platform depends on Vercel and Supabase (single region, eu-west-2, Micro
compute, no read replica) and on the providers behind each channel. 99.5% (about 3.6 hours a
month) is achievable on that stack; 99.9% would need measured history and a multi-region or
hot-standby plan first.

Recovery objectives today (`docs/RESTORE.md`): **RPO up to 24 hours** (daily backups; PITR not
enabled), **RTO a few hours** for a restore to a new project. Enabling PITR is an owner
decision recorded in RESTORE.md.

## What the status page shows

`status.clientturn.com` (served by `/status`, `src/app/status/page.tsx`, re-rendered every 60
seconds from `src/lib/status/service.ts`):

* An overall banner: operational, degraded, outage, or planned maintenance in progress.
* Per-service status for: Lead sources, Email mailbox/sender, SMS, WhatsApp, Booking,
  Sourcing, Intent monitors, Campaigns, Background agents, Queue status, Database, File
  storage.
* 30 days of daily history and an uptime percentage per service, computed in SQL from
  provider probes (`platform_provider_checks`) and job outcomes over the whole window.
* Recent failures, as short stable labels only.
* Scheduled and active maintenance windows (`docs/MAINTENANCE.md`).

It never shows tenant data, error text, credentials or provider account ids (allow-listed
output). The same snapshot drives the in-app System Status tab, so the two cannot disagree.

What it does **not** yet do: an external synthetic check (the page is computed by the platform
itself, so a total Vercel outage takes the page down with it) and subscriber notifications.
Recommended: point an external uptime monitor at `/api/cron/heartbeat` and `/status`.

## Incident process

1. **Detect.** Ops alerts (`src/lib/ops/alerts.ts`: dead jobs, webhook failures, cron misses,
   provider probes, backlog) email `OPS_ALERT_EMAIL` and/or post to `OPS_ALERT_WEBHOOK_URL`;
   Sentry when `SENTRY_DSN` is set; the status page; customer reports to support@.
2. **Triage (within 30 minutes during UK business hours).** Assign one incident lead. Classify:
   * **SEV1** service down, or data exposed across tenants, or a suspected personal data breach;
   * **SEV2** a major function degraded (webhooks, sending, sign-in) for many workspaces;
   * **SEV3** a single provider or feature degraded, workaround exists.
3. **Contain.** Admin → Site → maintenance `READ_ONLY` or the break-glass
   `MAINTENANCE_OVERRIDE_LEVEL` env var; pause the worker (`cron.unschedule`); the voice kill
   switch and outbound pause; revoke keys or rotate secrets if a credential is involved.
4. **Communicate.** Status banner / maintenance window for anything customer-visible. SEV1:
   update at least hourly.
5. **Personal data breach.** If personal data may be affected: notify affected customers
   without undue delay and within **24 hours** of becoming aware (DPA §10); the customer, as
   controller, decides on ICO notification (72 hours); where ClientTurn is controller (account
   data), we notify the ICO within 72 hours if there is a risk to people. Keep a breach log
   entry either way.
6. **Recover.** Fix forward or roll back the deployment on Vercel; restore data per
   `docs/RESTORE.md`; replay webhooks from `webhook_events` / provider dashboards.
7. **Review.** Within 5 working days for SEV1/SEV2: timeline, root cause, what detected it,
   actions with owners. Add a todo for each action.

## Owner actions

* Decide PITR (7 days recommended before paid voice/quotes customers).
* Add an external uptime monitor and decide whether to offer status-page email subscriptions.
* Decide if an Enterprise SLA template (with service credits) is wanted; the 99.5% target is
  the starting point.
