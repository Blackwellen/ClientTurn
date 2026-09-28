# Backups and restore runbook

What protects ClientTurn's data, how to check it is still switched on, how to restore, and
the drill that proves a restore works. Gap audit (docs/revenue-engine/15-system-gap-audit.md
§5) found backups and PITR "assumed, never verified". This page records what was actually
verified.

## Current status (verified 2026-09-28, read-only)

Supabase project **Client Turn**, ref `losieaikadkadtmezini`, eu-west-2, Postgres 17.6.

| Check | Result |
|---|---|
| `GET /v1/projects/losieaikadkadtmezini/database/backups` | `walg_enabled: true`, **`pitr_enabled: false`** |
| Daily physical backups | 8 listed, all `COMPLETED`, one a day at about 02:10 UTC (20 to 27 Sept 2026) |
| PITR add-on (`GET .../billing/addons`) | **Not selected.** Available: 7 days ($100/month), 14 days ($200), 28 days ($400) |
| Compute add-on | Micro |
| R2 bucket versioning / lifecycle | **Could not be read.** The app's R2 token is object-scoped and gets `AccessDenied` on `GetBucketVersioning` and `GetBucketLifecycleConfiguration` (which is correct for an app token). Check in the Cloudflare dashboard. |

**What that means today.** The database can be restored to any of the last ~7 daily
backups, so the worst case is **up to 24 hours of data lost** (RPO 24 h), for every
workspace at once. PITR would bring that down to seconds. It is an owner decision
(cost vs. RPO); nothing has been bought or changed.

Recommendation: enable **PITR 7 days** before the first paying customers go live on voice,
quotes or invoicing. Losing a day of signed quotes, payments and call records is the
failure it prevents.

## How to check (repeat monthly and before launch)

Read-only, with a Supabase personal access token (`SUPABASE_PAT` in `.env`; never commit it):

```bash
# PITR on? Daily backups completing?
curl -s -H "Authorization: Bearer $SUPABASE_PAT" \
  https://api.supabase.com/v1/projects/losieaikadkadtmezini/database/backups
# expect: "pitr_enabled": true (once bought), and a COMPLETED backup from the last 24 h

# Which add-ons are selected (look for "type":"pitr" under selected_addons)
curl -s -H "Authorization: Bearer $SUPABASE_PAT" \
  https://api.supabase.com/v1/projects/losieaikadkadtmezini/billing/addons
```

Dashboard equivalent: Project Settings -> Add-ons (PITR), and Database -> Backups.

With PITR on, the backups endpoint also reports the recoverable window
(`physical_backup_data.earliest_physical_backup_date_unix` / `latest_...`).

## Restoring the database

**Never restore over production to "try it".** Every restore below except the last is
into a separate project.

1. **Decide the target time.** From the incident timeline: the last moment the data was
   known good. Write it down in UTC.
2. **Freeze writes** if the damage is ongoing: Admin -> Site -> maintenance
   `READ_ONLY` (docs/MAINTENANCE.md), or the break-glass `MAINTENANCE_OVERRIDE_LEVEL`
   env var if the database itself is unreachable. Pause the worker if jobs are making it
   worse: `select cron.unschedule('clientturn-worker');` (re-schedule from
   `supabase/migrations/00242_pg_cron_worker.sql` afterwards).
3. **Restore to a new project** (Dashboard -> Database -> Backups -> "Restore to a new
   project", or with PITR the point-in-time picker). Same region (eu-west-2).
4. **Verify the copy** with the checks in "Drill checklist" step 4.
5. **Choose the recovery:**
   * *Partial loss* (one workspace, one table, a bad script): export the affected rows
     from the restored copy (`pg_dump --data-only -t ... --where` or `COPY (select ...)`)
     and re-insert them into production. This keeps everything written since.
   * *Total loss or corruption*: restore in place (Dashboard -> Backups -> Restore). This
     rolls the whole database back; everything after the target time is gone. Before
     doing it, export from production anything created after the target time that must
     be replayed (Stripe is the source of truth for subscriptions and can be re-synced;
     provider webhooks can be replayed from the providers' dashboards).
6. **After an in-place restore:** check Vault still holds `clientturn_site_url` and
   `clientturn_cron_secret` (docs/CRON.md), re-schedule the worker if you unscheduled it,
   confirm `select * from public.cron_job_health;` shows fresh runs, and watch the ops
   alerts (docs/OBSERVABILITY.md) for an hour.
7. **Tell affected customers** what was lost and when. A restore that loses personal data
   may be a personal-data breach (UK GDPR Art 33: 72 hours to notify the ICO if it is a
   risk to people).

## Cloudflare R2 (logos, CSV imports, voice recordings, quote PDFs)

R2 is not covered by the Supabase backups. Rows in Postgres point at R2 keys, so a
database restore does not bring back a deleted object, and an object deleted by the
retention job or a data-rights erasure is meant to stay deleted.

Guidance, to be done in the Cloudflare dashboard by the owner:

* **Check whether the bucket has object versioning or bucket locks.** R2's support for
  S3-style versioning has been limited; if versioning is not available on the account,
  use the two items below instead. Do not rely on "deleted objects can be undeleted"
  until it has been checked.
* **Bucket lock / retention rule** on the prefixes that must not be lost early (signed
  quote PDFs, invoice PDFs), for at least the legal retention period, if the account
  supports it. Do **not** lock recordings or CSV imports: they have deliberate deletion
  (retention settings, data-rights requests) and a lock would break erasure.
* **A nightly copy** of the quote/invoice prefixes to a second bucket (different account
  or provider) with `rclone sync --backup-dir`, using a separate read-only token for the
  source. This is the practical backup if versioning is unavailable.
* The app token should stay object-scoped (it is today); bucket settings are changed only
  from the dashboard.

Restoring an object: copy it back from the backup bucket to the same key. The database
row still references the key, so nothing else changes.

## Quarterly restore drill

Run once a quarter (next: December 2026) and after any change to the backup set-up. Record
the result in the table at the bottom. Cost: one temporary project for about an hour.

1. [ ] **Status check.** Run the two `curl` commands above. Record `pitr_enabled`, the
   newest backup time, and the add-on list.
2. [ ] **Restore** the latest daily backup (or, with PITR, a point 1 hour ago) **to a new
   project** named `ct-restore-drill-YYYY-MM`. Note the time it took.
3. [ ] **Do not** add Vault secrets or enable pg_cron schedules on the copy (otherwise it
   will call the production app). If the schedules came across, unschedule them at once:
   `select cron.unschedule(jobname) from cron.job where jobname like 'clientturn-%';`
4. [ ] **Verify the copy:**
   * row counts of `businesses`, `leads`, `messages`, `quotes`, `invoices`, `voice_calls`,
     `jobs` are within a day's growth of production;
   * the newest `messages.created_at` and `webhook_events.received_at` match the restore
     point;
   * `select count(*) from supabase_migrations.schema_migrations;` matches production;
   * RLS is on: `select relname from pg_class where relrowsecurity = false and relnamespace = 'public'::regnamespace and relkind = 'r';`
     returns the same (short) list as production;
   * one known workspace's leads, a quote and an invoice can be read with the service role.
5. [ ] **R2 spot check.** Pick 3 keys referenced by the copy (a logo, a quote PDF, a
   recording) and confirm each object exists (or exists in the backup bucket).
6. [ ] **Measure** RPO (restore point vs. now) and RTO (start to verified copy).
7. [ ] **Delete** the drill project.
8. [ ] **Record** below, and open a todo for anything that failed.

| Date | Backup type | Restore point | RTO | RPO | Result | By |
|---|---|---|---|---|---|---|
| _none yet_ | | | | | | |
