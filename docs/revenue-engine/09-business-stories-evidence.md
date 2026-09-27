# 09 — Business stories: end-to-end evidence (§109)

## Run `cf7b81f`, 2026-09-27 10:46–10:55 UK: hand-over as the last resort

After the owner's decision that human hand-over is the last resort (`docs/AGENT_RUNTIME.md`
"Hand-over policy", tracker 8.36). Run inside the 08:02–19:30 UK window, without
`STORY_ALLOW_QUIET`, following `tests/stories/README.md`.

| Result | Value |
|---|---|
| Tests | **55/55 pass**, 0 fail; file-level `after` PASS |
| Rows | 53 PASS · 1 FAIL (D0, unchanged, pre-existing) · 1 BLOCKED (F3) / N/A (E1) as before |
| Isolation | `deployedWorkerTouched: []`, blocked egress `[]`, 578 jobs run in-process, guard re-parked 278, 0 failed sweeps |
| Cleanup | `errors: []`, 187 tables checked, `nonZero: {}`, 0 parked jobs / webhook rows / auth users / businesses: **0 rows left** |

**Story expectation changed: C4** (was "agent_handoffs row, human_takeover, acknowledgement
sent" at the ENTERPRISE threshold). Now: the AI offers slots at the threshold, the lead picks one,
the meeting is booked, and the brief travels with it. Evidence from the run: replies asked the
problem, stakeholders and decision process (budget never asked), then "Happy to set up a call with
the team. Which of these times suits you best?", then "Thanks Priya - that is booked for Mon 28
Sept, 9:30am"; booking `scheduled/google_calendar`; `human_takeover=false`; conversation owner
`AI_ACTIVE`; exactly one `agent_handoffs` row, `HIGH_VALUE/OPEN`, `summary_json.kind =
ASSIST_REQUEST`, `assistReason = MEETING_BRIEF`, with `leadBrief` and `quickBrief` written by the
`handoff.brief` job. Harness fixture change: the test workspace now stores
`agent_handover_on_review = false` (the new default). Every other story passed unchanged; the
hand-overs that remain (H3b, Q4 "can I speak to a real person", X5 takeover) still hand over.

**Current evidence: 2026-09-27 (Sunday), live project `losieaikadkadtmezini`.** Three full runs
after the fixes below, all inside the 08:02–19:30 UK window and outside 02:45–03:40 UTC:

| Run | UK time | Stories | Rows | Cleanup | `deployedWorkerTouched` |
|---|---|---|---|---|---|
| `9b566d75` | 08:38–08:47 | 56/56 tests pass | 53 PASS · 1 FAIL (D0) · 1 BLOCKED (F3) · 1 N/A (E1) | 0 rows left | **2** `event.dispatch` |
| `625a2045` | 08:51–08:59 | 56/56 tests pass | same | 0 rows left | **2** `event.dispatch` |
| `4e15707c` | 09:00–09:09 | 56/56 tests pass | same | 0 rows left | **1** `event.dispatch` |
| **`704f6b49`** | 09:25–09:34 | **55/55 tests pass, file-level `after` PASS** | same | 0 rows left, `errors: []`, 0 parked jobs / webhook rows / auth users / businesses | **`[]`** |

Every story test passed in all three runs, including H3 and Q1 (the two failures of the 08:07
run) and all of Q1–Q5. **No run was clean on the isolation proof**: in each, the deployed worker
claimed one or two SQL-inserted `event.dispatch` jobs before the guard parked them, so the file's
`after` assertion failed each time (see "Safety" below).

**Isolation closed (run `704f6b49`, after migration 0137 was applied at ~09:20 UK):** with
`businesses.job_claims_paused` set on the test workspace, `claim_jobs` never took its jobs:
`deployedWorkerTouched: []`, blocked egress `[]`, 558 jobs run in-process with none failed, 305
inserts parked and 266 SQL jobs re-parked, and cleanup proven at 0 rows across 187 tables. This is
the first fully clean run. The detailed table below is run `4e15707c`; `704f6b49` produced the
same 53 PASS rows.

Runner: `tests/stories/` (safety design in `tests/stories/README.md`).

```
node --experimental-transform-types --env-file=.env --env-file=.env.local \
  --import ./scripts/e2e-resolver.mjs --test tests/stories/revenue-stories.test.ts
```

**What is and is not tested.** The model (Azure) is replaced by scripted decisions, so model
wording quality is not evaluated here. Everything around the model is: gates, strategy,
qualification, validator, sends, bookings, checkout, hand-off.

## What changed since the 08:07 run (53 pass, 3 fail)

| Failure at 08:07 | Root cause | Fix |
|---|---|---|
| **H3** "bookings=[]; last run BOOKING_OPTIONS_SENT" | **Story script, not product.** H runs with the engine in its default mode, SHADOW (`QI_RELEASE_GATES_PASSED` is false), so the legacy turn decides. At the threshold the legacy turn already does the right thing: `askPreferredTime` sends the fixed "which day and time?" and records `preferredTimeAsked: 1` (that is the BOOKING_OPTIONS_SENT the assertion printed). The pending request is created from the lead's *answer* (`handlePreferredTimeReply` → `confirmBooking` → `createBooking`'s manual route), and the story stopped one turn early: the lead never named a time. Q5 passed because it has that turn | `story-g-m-intake.ts` H3: asserts the threshold turn asked for a time, then the lead says "Wednesday at 11am works for me", and asserts a PENDING booking, lead not BOOKED, reply says "requested … not confirmed". The legacy path creates the pending request (lifecycle QUALIFIED satisfies `create_booking`). Not Q5's "Tuesday at 2pm": `bookings_one_active_per_slot_idx` allows one active booking per workspace slot, and H3's request stays open (a first attempt with the same time made Q5 hand over as SLOT_TAKEN) |
| **Q1** "bookings=[]" | **Harness fake, not product.** The Google Calendar fake answered every `freeBusy` with `busy: []`, even for the event it had accepted in A8. So Q1 (same workspace, later) was offered A8's slot again as its first option. `create_booking` re-checked it (fake: free), then the insert hit `bookings_one_active_per_slot_idx` → `SLOT_TAKEN` → `offerAlternativeSlots` sent fresh times. No booking row, correctly: the product refused a double booking. A focused run without story A booked Q1 first time. The A3 slot prefetch, the booking-readiness allowance and the scripted model were all fine (turn 1 was CTA_BOOK R7 with 3 slots) | `harness.ts` fake: `freeBusy` returns every event the fake accepted in the run as busy, inside `timeMin..timeMax`, as Google does. Q1's failure message now carries the pick, the replies and the pick run's decision |
| **Teardown** "business delete: canceling statement due to statement timeout" | `jobs.retried_from_job_id` is an **unindexed self-reference** (ON DELETE SET NULL). Each deleted job seq-scans the 124k-row `jobs` table, so the cascade from `businesses` over ~550 jobs exceeded PostgREST's 8 s `statement_timeout`. The same cause silently failed the parked-orphan delete (its `{ error }` was ignored: 36 rows left) | Staged teardown, below. Index proposed in 0137 |

### Teardown changes (`harness.ts` `teardownWorld`, `revenue-stories.test.ts` `after`)

1. `deployedWorkerTouched` and the shadow-diff review are computed, and the report and evidence
   table printed, **before** anything is deleted.
2. Deletes run in stages and every `{ error }` is checked: jobs by id in batches of 25 (halved on a
   timeout), then the run's parked orphan jobs, `domain_events` in batches, the run's
   `webhook_events`, every other table with rows (largest first, up to four passes), the business
   (three attempts with backoff), then the auth user.
3. It never throws. What remains is printed with the SQL that finishes it.
4. The run fails on any teardown error, any remaining row, or any non-zero global count.

Run `4e15707c` stages: jobs 533 in 22 batches; orphan parked jobs 38; domain_events 265;
webhook_events 41; 62 other tables in two passes (`leads` and `prospects` on the second); business deleted on the first attempt.

### Other harness changes

* The migration 0129 shim is removed: 0129 is applied (`usage_overage_events` and
  `message_credit_balances` exist), so the send path reads them for real.
* The guard loop now runs on its own thread (`tests/stories/guard-worker.mjs`, 40 ms, up to 3
  sweeps in flight). On the main thread it stalled during synchronous work (the report measured a
  3.5 s main-thread stall).
* The workspace sets `businesses.job_claims_paused` when that column exists (0137); the report
  shows `claimPause0137`.
* **Never run the file with `--test-name-pattern`**: Node then runs the file-level `after` hook
  before the suites. A focused debug run did this once today; the workspace it left
  (`ZZ-E2E-STORY-15b3eec2`) was removed by hand and proved at zero across 187 tables, with its auth
  user, 197 parked jobs and 14 webhook rows.

## Safety

| Control | Result (run `4e15707c`; the other two runs match) |
|---|---|
| Real outbound communication | None. `egress.blocked: []`: no unregistered call left the process |
| Faked calls | 127: Azure 47, Twilio 46, Google Calendar 16, Graph 7, Companies House 3, Google Ads 2, LinkedIn 2, HubSpot 2, Salesforce 2 |
| Parking | 305 inserts parked by the fetch rewrite; 265 SQL-inserted jobs re-parked by the guard (11,633 sweeps, 0 failed, guard tick gap ≤ 73 ms) |
| Test contacts | `@example.invalid` emails, `+447700900xxx` mobiles only |
| **`deployedWorkerTouched`** | **FAIL: `[event.dispatch 4c19a064…, completed]`** (created 08:07:32.811 UTC, completed by the deployed worker 08:07:33.199). Runs `9b566d75` and `625a2045`: 2 each, same type and state |
| Second barrier | Held. The workspace's real subscription row is `CANCELLED`, and `event.dispatch` does local writes only: the workspace had no webhook endpoints and no Slack connection, so the deployed handler had nothing to send to |

**Why parking cannot close this.** `emit_domain_event` is called by row triggers on bookings,
messages, agent_handoffs, qualification_answers and suppression_entries, and inserts
`event.dispatch` with `run_at = now()` inside the writing transaction. Until the guard parks it,
the job is claimable, and the deployed `claim_jobs` runs every 30 s (pg_cron job 1). With about
265 such jobs per run, even a short window meets a claim about once or twice a run. Moving the
guard to its own thread and sweeping every 40 ms went from 2, 2 to 1: not zero. The earlier clean
result (`2a454c28`, 2026-09-26) was luck. **Fix:** migration
`0137_job_claim_pause_and_retry_index.sql` (written, **not applied**) adds
`businesses.job_claims_paused` and makes `claim_jobs` skip a paused workspace's jobs. The harness
already sets the flag when the column exists. Once 0137 is applied, one run gives a deterministic
`deployedWorkerTouched: []`.

## Cleanup proof

Each of the three runs, from the teardown's own count, run through the Management API:
* 0 rows for the workspace across all **187** public tables with `business_id`;
* 0 parked jobs at the run's `run_at`;
* 0 of the run's `webhook_events`;
* auth user and workspace deleted; `finishSql: []`; `errors: []`.

Before teardown, run `4e15707c` held 64 kinds of row, including 533 jobs, 265 domain events,
84 messages, 20 leads, 7 opportunities and 5 bookings.

Independent check after the last run (SQL, 09:10 UK):
* 0 businesses named `ZZ-E2E-STORY%`;
* 0 jobs with a far-future `run_at` or a `STORY_PARKED:` mark;
* 0 `zz-e2e-story-owner-%` auth users;
* 0 null-business Twilio `webhook_events` from drama numbers.

The 08:07 run was cleaned by the coordinator before this work.

## Shadow-diff review (first review, test traffic only)

Read from this run's agent runs (`decision_json.qi.accounting.shadow_differs`) and SHADOW
assessments (`lead_assessments.legacy_decision`) before teardown. Stories A–M and X run in SHADOW;
story Q runs in LIVE.

| Measure | Run `4e15707c` |
|---|---|
| Agent runs with an engine record | 30 (24 SHADOW, 6 LIVE) |
| SHADOW turns where the NBA differed from the legacy turn | **8 of 24** |
| By NBA action | CTA_BOOK 4/10, ASK 3/8, CTA_SIGNUP 1/3, CTA_CHECKOUT 0/2, ESCALATE 0/1 |
| SHADOW assessments | 102, of which 34 `differs` (note: "legacy selection recomputed in lead.score"; the per-turn detail is on the run) |

| Story (lead) | Turns | NBA would have | Legacy did |
|---|---|---|---|
| C (Priya, ENTERPRISE) | 3 | ASK a library intent (OUTCOME.GOOD_RESULT, USE_CASE.MAIN_JOB ×2), R9 | ASK_NEXT_QUESTION: the next *configured* question |
| H3 (Hannah, consultancy, handover) | 2 | CTA_BOOK, R7 booking-ready | ASK_NEXT_QUESTION (the remaining required question) |
| H4 (Harriet, same) | 2 | CTA_BOOK, R7 | ASK_NEXT_QUESTION |
| I3 (Isaac, SaaS self-serve) | 1 | CTA_SIGNUP, R8 purchase-ready | ASK_NEXT_QUESTION |

**Reading:** two kinds of difference, both expected from the design.
* The engine closes one turn earlier than legacy when the lead is booking-ready or
  purchase-ready: 5 of 8 turns. That is the "don't over-qualify" behaviour Q1 proves in LIVE.
* The engine asks a library intent where legacy asks the next configured question: 3 of 8 turns,
  all in the enterprise story. This is a question-id difference, and `shadowDiffers` compares
  question ids, so a same-topic question still counts as a difference.

No turn showed the engine pursuing a lead that legacy stopped, or the reverse. The model is
scripted and these are test conversations, so **a review on real SHADOW traffic is still owed**
before `QI_RELEASE_GATES_PASSED` can flip.

## Evidence table (run `4e15707c`, `=== EVIDENCE ===`)

Scenario text is abbreviated; the full lines are in the run log.

| ID | Flow | Expected | Actual (run `4e15707c`) | Result |
|---|---|---|---|---|
| A1 | Meta webhook | 200, webhook_events row, lead_source.poll parked | 200; poll job parked at 2999-03-11T21:48:09.514Z | PASS |
| A2 | Meta poll -> ingest | lead CREATED, one meta touch with campaign/ad, first follow-up SMS sent via faked Twilio | lead 78bcdced intake_method=META created_via=INBOUND; touch campaign=CMP1 ad=AD1; SMS#1="Hi Amelia, thanks for your enquiry with ZZ-E2E-STORY-4e15707"; job failures=0 | PASS |
| A3 | Identity | MERGED into the same lead, 2 touches, merge_events row, provenance unchanged | 1 lead; touches=meta:CREATED,google_ads:MERGED; merge rule=EMAIL; intake_method still META; job_title=undefined company=Hart & Byrne Ltd | PASS |
| A4 | Contactability | SMS and EMAIL allowed (warm, THEY_CONTACTED_US), WHATSAPP not allowed without opt-in | {"EMAIL":"ALLOWED/ALLOWED","SMS":"ALLOWED/ALLOWED","WHATSAPP":"REQUIRE_CONSENT/BLOCKED_NO_PERMISSION","SOCIAL":"BLOCKED/BLOCKED_INVALID_CONTACT"}; permission=THEY_CONTACTED_US/UNKNOWN | PASS |
| A5 | Scoring | one current lead_scores row with grade; tags reconciled | score=25.8 grade=D versions=2; tags=NEEDS_INFO | PASS |
| A6 | Adaptive qualification | Q1 then Q2 asked once each, <=1 '?' per message, optional budget/decision questions never asked after the BOOK_MEETING_B2B threshold | replies=3: "Thanks, that helps. What are you looking to achieve with an agency?" / "Thanks, that helps. When would you want someone to start?" / "Happy to set up a call with the team. Which of these times suits you b"… | PASS |
| A7 | Strategy | method, reason, motion BOOK_MEETING_B2B from WORKSPACE | runs=MESSAGE_SENT>MESSAGE_SENT>BOOKING_OPTIONS_SENT; last method=SPIN reason="Considered B2B sale: understand the situation before the problem." motionSource=WORKSPACE stop=THRESHOLD_MET | PASS |
| A8 | Booking (Google) | event created with attendee (faked Google), booking scheduled, lead BOOKED, opportunity MEETING_BOOKED | offered 3 slots, picked "Mon 28 Sept, 9:00am"; attendees=[{"email":"amelia.hart.4e15707c@example.invalid","displayName":"Amelia Hart"}] sendUpdates=all; booking scheduled/google_calendar; lead BOOKED; opp MEETING_BOOK… | PASS |
| A9 | Opportunity close | outcome WON, reason stored, lead WON, follow-up stopped | opp CLOSED/WON "Signed a 6-month paid social retainer"; lead WON; automation_active=false | PASS |
| A10 | Events | lead.created < lead.touched < reply.received < meeting.booked < opportunity.won | lead.created > lead.scored > lead.intent_changed > lead.touched > lead.scored > lead.intent_changed > reply.received > reply.classified > lead.scored > reply.received > reply.classified > qualification.answered > lead… | PASS |
| A11 | Analytics | meta row: 1 lead, contacted, replied, booked, won | {"key":"meta/AD_FORM","label":"meta · AD_FORM","leads":1,"contacted":1,"replied":1,"qualified":1,"booked":1,"won":1,"replyRate":{"value":1,"numerator":1,"denominator":1,"lowSample":true},"qualifyRate":{"value":1,"nume… | PASS |
| B1 | Google Ads poll -> ingest | lead CREATED, touch google_ads with campaign/adgroup/creative, first SMS | lead 14753df2 intake=GOOGLE_ADS/INBOUND; touch record=GAB1790496082454; campaign=7001; SMS#1 sent | PASS |
| B2 | Google Ads webhook idempotency | no second touch: both paths dedupe on Google's own id | 1 touch | PASS |
| B3 | Google Ads webhook auth | 403, no webhook_events row | 403; 0 rows | PASS |
| B4 | Contactability | SMS + EMAIL allowed; WhatsApp not without opt-in | {"EMAIL":"ALLOWED/ALLOWED","SMS":"ALLOWED/ALLOWED","WHATSAPP":"REQUIRE_CONSENT/BLOCKED_NO_PERMISSION","SOCIAL":"BLOCKED/BLOCKED_INVALID_CONTACT"} | PASS |
| B5 | Adaptive qualification + direct close | one question per message, budget never asked, checkout URL sent, opportunity CHECKOUT_SENT | replies: "Thanks, that helps. When do you need it live?" / "Brilliant, here is the link to get started. https://checkout" / "Brilliant, here is the link to get started. https://checkout"; opp CHECKOUT_SENT link=starte… | PASS |
| B6 | Opportunity close | WON, reason, lead WON | lead WON; events=lead.created>lead.scored>lead.intent_changed>reply.received>reply.classified>lead.scored>reply.received>reply.classified>qualification.answered>qualification.answered>opportunity.created>opportunity.s… | PASS |
| C1 | LinkedIn Lead Gen poll -> ingest | lead CREATED with first/last name, phone, company from predefinedField mapping; touch linkedin_ads | mapped {"first":"Priya","last":"Raman","phone":"+447700900351","company":"Raman Freight plc"}; form fetched at /rest/leadForms/3162; owner param raw="owner=(organization:urn%3Ali%3Aorganization%3A5509810)" | PASS |
| C2 | LinkedIn Lead Sync request | parentheses and colon raw, only the URN encoded once (no %253A) | owner=(organization:urn%3Ali%3Aorganization%3A5509810) | PASS |
| C3 | Contactability | SMS/EMAIL allowed, WhatsApp needs opt-in | {"EMAIL":"ALLOWED/ALLOWED","SMS":"ALLOWED/ALLOWED","WHATSAPP":"REQUIRE_CONSENT/BLOCKED_NO_PERMISSION","SOCIAL":"BLOCKED/BLOCKED_INVALID_CONTACT"} | PASS |
| C4 | Qualification -> handoff brief | stop asking (budget never asked), agent_handoffs row, human_takeover, handoff.brief summary stored, acknowledgement sent | replies="Thanks, that helps. What's the business problem you're tryin" / "Thanks, that helps. Which stakeholders will be involved in e" / "Thanks, that helps. What does your decision process look lik" / "Thanks. I'll … | PASS |
| C5 | Opportunity close | LOST with reason; lead LOST | opp CLOSED/LOST "Renewed with the incumbent MSP for 12 months"; lead LOST | PASS |
| G1 | CSV import -> ingest | 2 leads created (IMPORT/IMPORT), 1 invalid row reported, CSV touches, follow-up NOT started | grace intake=IMPORT/IMPORT; touch CSV; relationship EXISTING_CUSTOMER; no SMS; import={"status":"COMPLETED"} | PASS |
| G2 | Contactability | EMAIL allowed (existing customer); SMS allowed | {"EMAIL":"ALLOWED/ALLOWED","SMS":"ALLOWED/ALLOWED","WHATSAPP":"REQUIRE_CONSENT/BLOCKED_NO_PERMISSION","SOCIAL":"BLOCKED/BLOCKED_INVALID_CONTACT"} | PASS |
| H1 | Add Lead wizard -> ingest | CREATED, intake MANUAL/PHONE_CALL, created_via MANUAL_WIZARD, THEY_CONTACTED_US with evidence, first SMS | intake=PHONE_CALL created_via=MANUAL_WIZARD; permission=THEY_CONTACTED_US evidence="Hannah phoned the office on 26 Sep and asked for a"; SMS#1 sent | PASS |
| H2 | Identity (wizard) | DUPLICATE with the existing record, nothing created | DUPLICATE; 1 lead | PASS |
| H3 | Booking (handover mode, engine SHADOW = legacy turn) | fixed 'which day and time?' at the threshold, then a PENDING booking for the stated time (flow map 9: 'Manual -> pending row, staff Confirm / Decline'); lead… | engine SHADOW; threshold turn asked "Thanks Hannah. Happy to set up a time. Which day and time wo"; booking pending/manual; lead QUALIFIED; reply "Thanks Hannah - I have requested Wed 30 Sept, 11:00am for yo" | PASS |
| H3b | Hand-off release (engine SHADOW) | the agent answers again (not HUMAN_OWNS_CONVERSATION) | hand-off HANDOVER_CREATED (acks 1); resume ok; next inbound -> BOOKING_OPTIONS_SENT/-; replies=1 | PASS |
| H4 | Booking (pending -> staff confirm) | booking 'pending', lead not BOOKED, no 'booked' claim; staff confirm -> scheduled, lead BOOKED | pending manual; SMS to lead after the failure: "Thanks Harriet - I have requested Tue 6 Oct, 2:30pm for you. It is not"; run HANDOVER_CREATED; staff confirm -> lead BOOKED | PASS |
| I1 | Public API -> ingest | 201 CREATED then 200 with the same lead id; one lead, one touch; UTM stored; follow-up not auto-started | first 201 CREATED; replay 200 DUPLICATE/CREATED; touches=1 utm_campaign=ledgerly-uk; automation_active=false | PASS |
| I2 | Public API guards | 400 invalid_request; 401 | missing key 400; bad key 401 | PASS |
| I3 | Qualification + direct close (sign-up) | one question, then PROPOSE_CHECKOUT with the approved trial link; team-size (optional) not asked | replies="Thanks, that helps. What would you mainly want to use it for" / "Brilliant, here is the link to get started. https://checkout"; opp CHECKOUT_SENT | PASS |
| I3b | Direct close (sign-up) after resume | approved trial link sent, opportunity CHECKOUT_SENT | reply "Brilliant, here is the link to get started. https://checkout.example.invalid/pay"; opp CHECKOUT_SENT | PASS |
| I4 | Opportunity close | WON with reason | WON | PASS |
| J1 | MCP -> ingest | 1 lead, MCP provenance, retry does not create a second lead; FOUND_BY_US refused | lead a77406af touches=2 (CREATED,MERGED); cold refused: {"jsonrpc":"2.0","id":1790496408091,"result":{"isError":true,"content":[{"type":"text","text":"That relationship does no | PASS |
| K1 | Zapier -> app event -> prospect | one prospect with provenance zapier, no lead, no contact; replay no second job; 401 unsigned | statuses 202/202/401; events=1; prospect status=DISCOVERED source=undefined | PASS |
| L1 | hubspot pull -> ingest | lead CREATED, touch CRM/provider, RECORD_ONLY (no SMS, no follow-up) | lead 31c95d6f touch CRM/hubspot; setting={"last_run_status":"OK","last_run_ingested":0,"last_run_error":null}; no SMS | PASS |
| M1 | salesforce pull -> ingest | lead CREATED, touch CRM/provider, RECORD_ONLY (no SMS, no follow-up) | lead b219c409 touch CRM/salesforce; setting={"last_run_status":"OK","last_run_ingested":0,"last_run_error":null}; no SMS | PASS |
| D0 | LinkedIn engagement config | engagement provider finds the organisation | config={} external_account_id=5509810: connectedPage() reads only config.organizationId/organizationUrn, so every real connection is 'unconfigured' | FAIL |
| D1 | LinkedIn engagement source | no linkedin_engagement provider | absent | PASS |
| D2 | Engagement -> prospect | no prospect is created from LinkedIn engagement | none created | PASS |
| D3 | LinkedIn data quality | no linkedin.com/in/<opaque id> URL anywhere | none | PASS |
| E1 | Sales Navigator SNAP | run only if reachable without a real token | LINKEDIN_SNAP_ACCESS_TOKEN unset (removed for the run); SNAP is closed to new partners (Microsoft Learn /linkedin/sales, ms.date 2025-05-22) and the provider's endpoints (salesApiLeadSearch / salesApiAccountSearch) ar… | NOT APPLICABLE |
| F1 | Find Leads enrichment | Ltd -> CORPORATE; not found -> UNKNOWN | ["CORPORATE","UNKNOWN","UNKNOWN"] | PASS |
| F2 | Cold email policy | CORPORATE ALLOWED; SOLE_TRADER BLOCKED_SUBSCRIBER_TYPE; UNKNOWN REVIEW_SUBSCRIBER_TYPE | {"CORPORATE":"ALLOWED/ALLOWED","SOLE_TRADER":"BLOCKED/BLOCKED_SUBSCRIBER_TYPE","UNKNOWN":"REVIEW_REQUIRED/REVIEW_SUBSCRIBER_TYPE"} | PASS |
| F3 | Find Leads sourcing run | prospects persisted by the run | Not run: the 2,340-line sourcing.run handler (AI planning, budgets, waterfall) was out of scope for this pass; F1/F2 cover the register verdict and the policy it drives on stored prospects | BLOCKED |
| X1 | Opt-out | after STOP: SMS blocked, EMAIL allowed, opted_out false; after email unsubscribe: EMAIL blocked; after plain-English: opted_out true | after STOP {"EMAIL":"ALLOWED/ALLOWED","SMS":"BLOCKED/BLOCKED_OPT_OUT","WHATSAPP":"REQUIRE_CONSENT/BLOCKED_NO_PERMISSION","SOCIAL":"BLOCKED/BLOCKED_INVALID_CONTACT"}; email unsub 200 -> EMAIL BLOCKED/BLOCKED_OPT_OUT; p… | PASS |
| X2 | Individual-subscriber policy | SOCIAL and EMAIL only ALLOWED with NON_PROMOTIONAL_ONLY (conversation-only), never promotional | SOCIAL ALLOWED [UNSUBSCRIBE_LINK,NON_PROMOTIONAL_ONLY]; EMAIL ALLOWED [UNSUBSCRIBE_LINK,NON_PROMOTIONAL_ONLY] | PASS |
| X3 | Identity race | 1 lead, 2 touches, no error | outcomes=MERGED,CREATED; 1 lead, touches=api:CREATED,meta:MERGED | PASS |
| X4 | Follow-up stop conditions | no second automated SMS; run stopped (replied) | automated sends 1 -> 1; run=null | PASS |
| X5 | Takeover | no agent reply during takeover (notification only); agent replies again after resume | during takeover: 0 replies; after resume: "Thanks, that helps. What are you looking to achieve with an agency?" | PASS |
| Q5 | Booking (handover mode, engine LIVE) | fixed 'which day and time?' (no model call), then a PENDING booking for the stated time; lead told 'requested', not BOOKED; lifecycle not QUALIFIED | asked "Thanks Quinn. Happy to set up a time. Which day and time wou"; booking pending; lead RESPONDED (qualification_state PENDING); reply "Thanks Quinn - I have requested Tue 29 Sept, 2:00pm for you." | PASS |
| Q1 | Booking-ready close (engine LIVE) | CTA_BOOK with no VERIFY of form values; no BUDGET/AUTHORITY/STAKEHOLDERS asked; slots offered; chosen slot booked | turn 1 NBA CTA_BOOK (R7_BOOKING_READY); questions asked: none; slots 3; booking scheduled | PASS |
| Q2 | Negative intent (engine LIVE) | NBA NO_ACTION on NEGATIVE; no reply SMS; follow-up stopped; no agent_decision model call for the turn | pricing signal recorded; NBA NO_ACTION on NEGATIVE; replies 0; active follow-up 0; model calls +0 | PASS |
| Q3 | Reply to an API-created lead (engine LIVE) | the agent replies (automation_active false does not stop a reply the lead is owed); run outcome matches the send | reply "Thanks, that helps. What would you mainly use it for?"; run MESSAGE_SENT; NBA ASK | PASS |
| Q4 | Hand-off release (engine LIVE) | silent while handed over; after resume the agent replies (not HUMAN_OWNS_CONVERSATION) | hand-off ack 1; during 0; after resume "Thanks, that helps. What would you mainly use it for?" (MESSAGE_SENT) | PASS |

**Run `4e15707c`: 53 PASS · 1 FAIL · 1 BLOCKED · 1 NOT APPLICABLE of 56 rows.**
* D0 FAIL is the removed LinkedIn engagement source. The row is still recorded; it was resolved by removing the source (8.27, owner decision), as below.
* F3 is BLOCKED: there is no harness for the sourcing handler.
* E1 is N/A: SNAP is closed.

Every other row passes, including the re-checks of the 2026-09-26 failures:
* B2 (one touch);
* H3 (a pending request in handover mode, legacy turn);
* H3b (the agent answers after a hand-off and a resume);
* I3 (reply, then the trial link, for an API lead).

---

## Previous run: 2026-09-26, run `2a454c28` (12:58–13:05 UK)

Kept for the history of the fixes. Its FAIL rows are superseded by the table above.

### Safety (2a454c28)

| Control | Result |
|---|---|
| Real outbound communication | None. Every provider secret replaced with a fake before load; sockets/DNS reach only Supabase; unregistered `fetch` blocked (blocked calls: `[]`) |
| Test contacts | `@example.invalid` emails, `+447700900xxx` mobiles only |
| Deployed worker isolation | Jobs this process writes get a far-future, run-unique `run_at`; the live `claim_jobs` definition is checked before start. SQL-inserted jobs are re-parked by a 100 ms guard (window ≤ ~1.3 s; hit twice in earlier runs, both jobs died harmlessly on old deployed code; final run: `deployedWorkerTouched: []`). Second barrier: the workspace's real subscription row is `CANCELLED`, so the deployed send path refuses |
| Faked calls (final run) | Twilio 28, Azure 26, Google Calendar 6, Graph 5, Companies House 3, LinkedIn 2, HubSpot 2, Salesforce 2, Google Ads 1 |

### Cleanup proof (2a454c28)

Before teardown: 59 kinds of row (350 jobs, 168 domain events, 59 messages, 15 leads, 5 prospects,
6 opportunities, 2 bookings, 3 suppression entries, 4 integrations, 1 app install). After: zero rows
for the workspace across all 184 public tables with `business_id`; 0 parked orphan jobs; 0 global
`webhook_events` rows; auth user and workspace deleted. Every earlier run also ended at zero.

### Evidence table (2a454c28)

| ID | Flow | Expected | Actual | Result | Status after follow-up |
|---|---|---|---|---|---|
| A1 | Meta signed leadgen webhook | 200, event recorded, poll parked | As expected | PASS | |
| A2 | Meta poll → ingest → first SMS | CREATED, campaign/ad on touch, SMS | As expected | PASS | Fixed in run (UK pack for +44 leads) |
| A3 | Same email via Google Ads webhook | MERGED, 2 touches, provenance kept | As expected | PASS | |
| A4 | Contactability, warm +44 | SMS/EMAIL allowed, WhatsApp needs opt-in | As expected | PASS | Fixed in run |
| A5 | Scoring | One current score, tags | score 7 / D / NEEDS_INFO | PASS | |
| A6 | Adaptive qualification over SMS | Q1, Q2 once each, ≤1 "?" per message | As expected; QUALIFIED | PASS | |
| A7 | Strategy block | Method + reason + motion | SPIN, BOOK_MEETING_B2B, THRESHOLD_MET | PASS | |
| A8 | Google booking | Event + attendee, BOOKED, MEETING_BOOKED | As expected | PASS | |
| A9 | Close WON | WON with reason | WON; `automation_active` left true | PASS* | Flag clearing assigned to QIE A1 (`opportunities/service.ts`) |
| A10 | Domain event order | created < touched < reply < booked < won | In order | PASS | |
| A11 | Source analytics under owner RLS | meta 1/1/1/1/1 | Exactly | PASS | |
| B1 | Google Ads poll | CREATED, touch, SMS | As expected, intake OTHER | PASS | Intake fixed: migration 0135 + `intakeMethodFor` → GOOGLE_ADS |
| B2 | Webhook + poll dedupe | One touch | Two touches | FAIL | **Fixed**: both paths record the trailing submission id (`ingest/google-ads-ids.ts`, `tests/google-ads-ids.test.ts`) |
| B3 | Webhook wrong key | 403, nothing stored | As expected | PASS | |
| B4 | Contactability | SMS/EMAIL allowed | As expected | PASS | |
| B5 | DIRECT_B2B close to checkout | One question per message, no budget, CHECKOUT_SENT | As expected | PASS | |
| B6 | Close WON | WON | WON | PASS | |
| C1 | LinkedIn Lead Gen poll | Name, phone, company mapped | As expected | PASS | Fixed in run (form schema fetch) |
| C2 | Lead Sync `owner` encoding | Encoded once | As expected | PASS | Fixed in run |
| C3 | Contactability | Allowed | Allowed | PASS | |
| C4 | ENTERPRISE hand-off | No budget, hand-off row, brief | As expected | PASS | |
| C5 | Close LOST | LOST with reason | As expected | PASS | |
| G1 | CSV import | 2 IMPORT leads, no SMS | As expected | PASS | Fixed in run (`z.partialRecord`) |
| G2 | EXISTING_CUSTOMER import | EMAIL allowed | Allowed | PASS | |
| H1 | Add Lead wizard | PHONE_CALL, permission evidence, SMS | As expected | PASS | |
| H2 | Wizard duplicate | DUPLICATE | As expected | PASS | |
| H3 | Booking in `handover` mode | Pending booking | Agent hands over, no booking row | FAIL | Assigned to QIE A3: ask for a time, create a pending request |
| H3b | Resume after agent hand-off | Agent answers again | Skipped: HUMAN_OWNS_CONVERSATION | FAIL | Assigned to QIE A4 (`lead.resume_follow_up`) |
| H4 | Pending → staff confirm | Lead told "requested", staff confirm → BOOKED | As expected | PASS | Fixed in run (handover origin) |
| I1 | Public API idempotency | 201 then 200, one touch | As expected | PASS | |
| I2 | API guards | 400, 401 | As expected | PASS | |
| I3 | Reply to an API-created lead | Agent replies | Run said MESSAGE_SENT, sends failed `stopped:paused` | FAIL | Assigned to QIE A3 (reply origin; truthful run result) |
| I3b | Checkout after resume | CHECKOUT_SENT | As expected | PASS | |
| I4 | Close WON via API | WON | WON | PASS | |
| J1 | MCP `create_lead` | 1 lead; cold refused | As expected | PASS | |
| K1 | Zapier event | 1 prospect; replay deduped; unsigned 401 | As expected | PASS | |
| L1 | HubSpot pull | CREATED, never contacted | As expected | PASS | Fixed in run (`lead.process` provider map) |
| M1 | Salesforce pull | Same | As expected | PASS | Fixed in run |
| D0–D3 | LinkedIn company-page engagement | — | Unconfigured / deprecated version / promotion from a public comment / fabricated profile URL | FAIL | **Resolved by removal**: LinkedIn's Restricted Uses terms forbid prospecting from member data; provider removed (8.27) |
| E1 | Sales Navigator partner search | — | Programme closed; endpoints not partner APIs | N/A | Removed (8.27) |
| F1 | Companies House verdicts | Ltd → CORPORATE, not found → UNKNOWN | As expected | PASS | |
| F2 | Cold email policy | Corporate allowed, sole trader blocked, unknown review | As expected | PASS | |
| F3 | Full Find Leads sourcing run | Prospects saved | Not run | BLOCKED | Open: needs a harness for the sourcing handler |
| X1 | Opt-out mid-flow, three channels | Per-channel then global | As expected | PASS | |
| X2 | Sole trader + accepted connection | Non-promotional only | As expected | PASS | |
| X3 | Two sources simultaneously | 1 lead, 2 touches | As expected | PASS | |
| X4 | Reply during scheduled follow-up | No second automated SMS | As expected | PASS | |
| X5 | Takeover then resume | Silent, then replies | As expected | PASS | |

That run: **42 PASS, 7 FAIL, 1 BLOCKED, 1 N/A** of 51. The H3, H3b, I3 and B2 failures were
re-verified PASS on 2026-09-27 (table above).

### Source fixes applied during that run (re-verified live)

1. UK leads could never be followed up by SMS/WhatsApp: the Default pack was used for +44 leads.
   `countryFromPhone()` and the workspace country now select the UK pack.
2. `lead.process` died for MCP, Meta DM and CRM leads (`lead_sources` CHECK). Mapped for that
   table only; the touch keeps the exact provider.
3. CSV importer rejected every mapping (Zod 4 enum-keyed record). `z.partialRecord`.
4. LinkedIn lead forms arrived without name, phone or company. Form schema fetched from
   `/rest/leadForms/{id}`; `owner` encoded once. Since then: every page read before the cursor
   moves, test submissions skipped, and the window's end fixed before the first request.
5. After a calendar failure the lead's "requested, not confirmed" message was blocked by the
   takeover. `origin: "agent_handover"` added.
