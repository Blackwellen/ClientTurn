# Business stories (coverage tracker 8.17)

End-to-end revenue journeys against the owner's **live** Supabase project. The owner approved this. Everything inside ClientTurn runs for real: route handlers, `ingestLead`, jobs, the agent, the policy gate and SQL triggers. Only the provider HTTP boundary is faked.

```
node --experimental-transform-types --env-file=.env --env-file=.env.local \
  --import ./scripts/e2e-resolver.mjs --test tests/stories/revenue-stories.test.ts
```

Run it between **08:02 and 19:30 UK time**. The UK compliance pack defers SMS during its quiet hours (20:00–08:00). Outside that window the run refuses to start. `STORY_ALLOW_QUIET=1` overrides this for development only, and in that mode every send defers.

`--experimental-transform-types` is Node's own flag. It is needed because `jobs/register.ts` imports a handler that uses TypeScript parameter properties.

## Files

| File | Contents |
|---|---|
| `safety.ts` | The guards (read this first). |
| `harness.ts` | The test workspace, the in-process job runner, the guard loop, provider fakes, turn helpers, cleanup. |
| `kit.ts` | Evidence ledger, `check()`, business configuration, connection helpers. |
| `story-hooks.mjs` and `fakes/` | Substitutions for things that only exist inside a Next request (see below). |
| `revenue-stories.test.ts` | Preflight, story A, report and teardown. It imports the other story files in order. |
| `story-b-google-ads.ts` | Story B. |
| `story-c-linkedin-leadgen.ts` | Story C. |
| `story-g-m-intake.ts` | Stories G to M. |
| `story-d-f-x.ts` | Stories D, E, F and X1 to X5. |

## Safety design: why nothing can be sent

### 1. Secrets
Every provider secret in `process.env` is overwritten with a fake before any application module loads:
- Twilio, Resend, Azure, Meta, Google, LinkedIn, Salesforce, Zoho, Slack, Calendly, TikTok, Stripe test, and the cron secret.
- The live Stripe key, `SUPABASE_PAT` and the optional enrichment keys are deleted.

The Azure endpoint is forced to `story-fake.openai.azure.com`.

### 2. Sockets
`tls.connect`, `net.connect`, `http(s).request` and `http(s).get` refuse every host except the Supabase project, which Node's own `fetch` uses. The management API host is also allowed, for the harness's read-only verification SQL. The run proves this at start-up before writing anything (`assertEgressBlocked`).

### 3. DNS
Only the Supabase hosts resolve for real. Every other name gets a fixed address, so no lookup for a fixture domain ever leaves the machine.

### 4. fetch
Supabase traffic passes through. Every other URL must be answered by a registered fake, or the call throws `BLOCKED_EGRESS`. The report lists every blocked call; a clean run has none.

### 5. Jobs are parked
Every `jobs` row this process writes is rewritten to a far-future `run_at` that is unique to the run, with the original due time kept in `last_error`.
- The deployed worker runs older code, every 30 seconds.
- The live `claim_jobs` claims only `state='pending' AND run_at <= now()`. The run checks this definition before starting (`assertClaimContract`) and refuses if it has changed.
- So a parked job is invisible to the deployed worker. The in-process runner executes the jobs directly.
- `claim_jobs` and `reap_stalled_jobs` are refused in-process, so this run can never claim another workspace's job.
- A failed job is marked `dead`, never rescheduled. A reschedule would unpark it.

### 6. SQL-originated jobs
Only two live SQL functions insert jobs: `emit_domain_event` (event.dispatch) and `receive_workspace_app_event` (app.ingest). The run asserts this list.
- A guard loop parks any unparked pending job of the test workspace every 100 ms.
- Both job types are local writes only. A test workspace has no webhook endpoints and no Slack connection.

### 7. Proof after the run
Every test-workspace job that left `pending` must be one this process claimed. `deployedWorkerTouched` must be `[]`, and the run fails otherwise.

### 8. Billing
The workspace's **real** subscription row is `CANCELLED`. If the deployed code ever did claim a job, its policy gate would refuse any send with `BLOCKED_BUSINESS_STATE`: the deployed-era `send-core` evaluates policy, including entitlements, before any provider call. In this process only, the read of that one row returns an ACTIVE row. Stripe is never called.

### 9. Connections
Connections are created only with fake credentials, and only for the story that needs them. The deployed worker never sees a job for the workspace (see 5).

### 10. Test contacts
Emails are `@example.invalid`. Mobiles are Ofcom drama numbers `+447700900xxx`.

### 11. Schedule
The run refuses to start between 02:45 and 03:40 UTC, when the deployed daily cron runs.

## The workspace and cleanup

There is one workspace, `ZZ-E2E-STORY-<run>`, with one owner user. Each story reconfigures its profile: archetype, motion, services and questions. Earlier questions are deactivated rather than deleted.

Teardown runs in `after` even on failure. It:
1. deletes the parked jobs this run wrote with no workspace id, and the global `webhook_events` rows it created;
2. deletes the workspace, which cascades to its rows;
3. deletes the auth user;
4. counts rows for the workspace id across **every public table with a `business_id` column**. The run fails unless all counts are zero.

## Fakes: what is and is not evaluated

Provider fakes return the response shapes in each provider's public documentation:
- Graph lead forms
- Google Ads `googleAds:search`
- LinkedIn Lead Sync (`leadFormResponses`, `leadForms/{id}`, with `content.questions`)
- Community Management comments (actor URN only)
- Companies House search
- HubSpot contact search
- Salesforce SOQL
- Google Calendar freeBusy and events
- Twilio Messages

The model (Azure) is faked with **scripted decisions**. The script asks exactly the question the deterministic strategy block names, and at the threshold takes the motion's close. **Model quality is NOT evaluated here.** What is evaluated is everything the runtime does around the model: gates, strategy, the qualification pointer, the validator, sends, booking, checkout and hand-off.

## Harness-only substitutions (`story-hooks.mjs`)

- `@/lib/auth/session`: returns the story owner's membership. Role checks still run.
- `@/lib/supabase/server`: a client built from the owner's **real** access token, so RLS applies exactly as for a signed-in page.
- `next/cache`: no-op.
- `next/server`: resolved to `next/server.js`.

One shim: migration 0129 (billing, concurrent work) is not applied, but the working-tree send path reads two of its tables. For the test workspace only, those reads return "no rows". The report counts them under `schemaShims0129`.
