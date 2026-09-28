# Observability: structured events for voice, quotes and payments

Brief §61. The logger is `src/lib/observability/log.ts`. It is pure (no `server-only`, no
Supabase), so both server modules and pure modules can use it. It writes one JSON line per event
to the console, which Vercel and the dev server collect.

It is not a metric store. The systems of record stay where they are: `voice_call_events`,
`voice_calls`, `voice_cost_ledger`, `quote_events`, `checkout_payments`, `invoice_payments` and
`audit_log`. The logger is for operators reading logs when something goes wrong.

## Using it

```ts
import { logEvent, obs } from "@/lib/observability/log";

logEvent("voice.eligibility_decided", { callId, leadId, decision: "DENIED", denials: ["TPS_LISTED"] });
obs.error("voice.error", { callId, provider: "retell", code: "PROVIDER_TIMEOUT", error });
```

`logEvent` never throws. Logging must never be the reason a call, a quote or a payment fails.

## Event names

| Area | Events |
|---|---|
| Voice | `voice.call_requested`, `voice.eligibility_decided`, `voice.provider_initiated`, `voice.answered`, `voice.disconnected`, `voice.duration_recorded`, `voice.tool_used`, `voice.transferred`, `voice.post_processed`, `voice.cost_recorded`, `voice.error` |
| Quotes | `quote.event`, `quote.error` |
| Payments | `payment.recorded`, `payment.error` |
| Experiments | `experiment.promoted`, `experiment.rolled_back` |
| Admin and reads | `admin.voice_control`, `analytics.read_failed` |
| Ops | `ops.alert`, `ops.error` (src/lib/ops/alerts.ts) |

To add an event, add its name to `OBSERVABILITY_EVENTS`. The union type then accepts it.

## The redaction rule

**Generic logs never carry transcript text, phone numbers or email addresses.** Three layers
enforce this, so one mistake does not become a leak:

1. **Forbidden keys.** Values under these keys become `"[redacted]"`, at any depth: `transcript`,
   `segments`, `text`, `body`, `message`, `content`, `utterance`, `summary`, `evidence`, `notes`,
   `phone`, `mobile`, `e164`, `to`, `from`, `callerId`, `email`, `signerEmail`, `name`,
   `firstName`, `lastName`, `address`, `url` and `recordingUrl`. Matching ignores case,
   underscores and dashes.
2. **Pattern masking.** Any string that looks like an email address or a phone number is masked
   in place (`[email]`, `[phone]`), whatever key it sits under. UUIDs and ISO dates are left
   alone.
3. **Length cap.** Any string over 200 characters is truncated, so a paragraph of conversation
   cannot slip through under an innocent key.

Identifiers (call, lead, quote and experiment ids), states, outcome codes, durations, counts and
money amounts pass through, because they are what an event is for.

If you need to log an error, pass the `Error` object (as `error`). Its message is scrubbed. Prefer
a stable `code` field over free text.

Tests: `tests/observability-log.test.ts`.

## Where it is used

The P5 modules use it:

* the analytics reads, in `src/lib/analytics/revenue-journey-query.ts` and
  `src/lib/analytics/insights-query.ts` (`analytics.read_failed`);
* the admin voice ops read and controls, in `src/lib/admin/voice-ops.ts`,
  `src/lib/admin/voice-ops-actions.ts` and `src/lib/services/operations/admin-voice.ts`
  (`admin.voice_control`);
* experiment promotion, in `src/lib/services/operations/experiments.ts`.

The voice runtime (`src/lib/voice/*`, `src/lib/jobs/handlers/voice.ts`) and the quote and payment
paths should emit the voice, quote and payment events at the points listed above. That code is
owned by the voice and quote workstreams, so the calls are theirs to add.

## Admin controls the voice runtime must honour

`adminVoiceBlocks()` in `src/lib/admin/voice-ops-model.ts` returns what the platform operator's
controls forbid for one call. These are the 0150 kill switch and the 0158 outbound pause, number
suspension and monthly spend limit. The dial path should call it right before dialling and log
`voice.eligibility_decided` with the reasons. The kill switch is already honoured by the runtime.
The three 0158 controls take effect for dialling once the runtime reads them.

## Error tracking (Sentry)

`@sentry/nextjs` is installed and **off unless `SENTRY_DSN` is set**. With no DSN the SDK
is never imported (server, edge or browser), `next.config.ts` does not wrap the build, and
nothing is sent: development and the test suites cost nothing and make no noise.

| File | Role |
|---|---|
| `src/instrumentation.ts` | `register()` inits Sentry for the Node and Edge runtimes; `onRequestError` reports server render, route handler and server action errors |
| `src/instrumentation-client.ts` | Browser init (lazy import, only with `NEXT_PUBLIC_SENTRY_DSN`); `onRouterTransitionStart` |
| `src/lib/observability/sentry-scrub.ts` | The shared options and the scrubber every event passes through |
| `src/lib/observability/report-client-error.ts` | Passes errors caught by React boundaries on to Sentry |
| `src/app/global-error.tsx` | Root boundary, including errors thrown in a group layout such as `(app)/layout.tsx` |
| `src/app/not-found.tsx` | Root 404 |
| `src/app/onboarding/error.tsx`, `src/app/start-trial/error.tsx` | Signup boundaries (a throw there used to be a dead end) |

Set up: `SENTRY_DSN` (the browser copy is filled from it). Optional:
`SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` (tracing is off by default), and
`SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` to upload source maps at build time
(they are deleted from the deployment after upload). Session replay is never enabled.

**The redaction rule applies to Sentry too** (`tests/sentry-scrub.test.ts`):
`sendDefaultPii: false`; `user` keeps only an id; `request` keeps the method, the URL
without its query string, and the content-type and user-agent headers (cookies, body and
env are dropped); exception messages and the event message are scrubbed with
`scrubString`; stack-frame locals are dropped; `extra`, `tags` and custom `contexts` go
through `redact`; console breadcrumbs are dropped and HTTP ones keep only method, status
and a scrubbed URL; capability tokens in paths (`/q/<token>`, `/unsubscribe/<token>`)
are masked. If the scrubber itself fails it drops the event's detail rather than sending it.

When a DSN is set, the report-only Content-Security-Policy also reports violations to the
project's security endpoint (see `docs/SECURITY_HEADERS.md`).

## Push alerts

`src/lib/ops/alerts.ts` (rules in `src/lib/ops/alert-model.ts`, tests in
`tests/ops-alerts.test.ts`). Delivery is email to `OPS_ALERT_EMAIL` (comma separated)
through Resend, and/or a POST to `OPS_ALERT_WEBHOOK_URL` (Slack incoming-webhook
format). With neither set, alerts still appear in the log as `ops.alert`.

| Alert | Fires when | Severity |
|---|---|---|
| `dead_jobs` | any job went `dead` in the last 24 h (new dead jobs change the fingerprint) | critical |
| `webhook_failures` | 5+ inbound `webhook_events` failed in 15 min | critical |
| `worker_cron_miss` | `cron_job_health` shows no `clientturn-worker` start for 10 min, or the schedule is gone | critical |
| `worker_app_miss` | no job completed for 15 min (pg_cron firing but the app answering 401/5xx) | critical |
| `daily_cron_miss` | no `clientturn-daily` start for 26 h | warning |
| `cron_job_failed` | pg_cron reports a failed run | critical |
| `queue_backlog` | the oldest due pending job has waited 15 min | warning |
| `provider_outage` | a configured platform provider probe is DOWN (probes run every 15 min and are recorded, so Admin uptime now fills on a schedule) | critical |
| `voice_margin` / `platform_margin` | a new open `MARGIN_BELOW_THRESHOLD` economics alert in the last 26 h | warning |

Where they run: the worker every 5 minutes (not its own schedule, which it cannot see
missing), the daily route (everything), and `GET /api/cron/heartbeat` for an external
uptime monitor (docs/CRON.md, "Alerts").

Dedupe: per alert kind at most one delivery an hour, and the same fingerprint at most once
a day, on the shared `consume_rate_limit` counter; an in-process map stands in if that
counter errors. Alert text carries counts, types, ids and scrubbed error snippets only.
Checks never throw into the tick they ride on, and the worker gives them at most 8 s.
