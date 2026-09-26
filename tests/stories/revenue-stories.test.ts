/**
 * ClientTurn Core Revenue Engine: full business stories (coverage tracker 8.17).
 *
 * Runs against a REAL Supabase project with provider HTTP faked at the
 * boundary. Read tests/stories/README.md before running; the safety design is
 * the point of this file.
 *
 *   node --env-file=.env --env-file=.env.local --import ./scripts/e2e-resolver.mjs \
 *     --test tests/stories/revenue-stories.test.ts
 */
import { register } from "node:module";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  scrubSecrets,
  installGuards,
  assertEgressBlocked,
  assertClaimContract,
  assertOutsideDailyCronWindow,
  egress,
  PARK_AT,
  RUN,
} from "./safety.ts";

// Order matters: secrets and guards before ANY application module loads.
scrubSecrets();
installGuards();
register("./story-hooks.mjs", import.meta.url);

const H = await import("./harness.ts");
const { admin, world: _unused, ...rest } = H;
void _unused;
void rest;

const K = await import("./kit.ts");
const { evidence, check, configureBusiness } = K;


/* --------------------------------------------------------------- lifecycle */

let preflightOk = false;

before(async () => {
  assertOutsideDailyCronWindow();
  if (process.env.STORY_ALLOW_QUIET !== "1") H.assertUkDaytime();
  await assertEgressBlocked();
  const inserters = await assertClaimContract();
  assert.deepEqual(inserters, ["emit_domain_event", "receive_workspace_app_event"], "unexpected SQL job inserters");
  H.installProviderFakes();
  await H.setupWorld();
  H.startGuard();
  H.signInAsOwner();
  const { ensureDefaultAutomations } = await import("../../src/lib/onboarding/provision.ts");
  await ensureDefaultAutomations(H.mustWorld().businessId, H.mustWorld().ownerId);
  preflightOk = true;
});

after(async () => {
  let cleanup: Awaited<ReturnType<typeof H.teardownWorld>> | null = null;
  let foreign: unknown[] = [];
  try {
    await H.stopGuard();
    if (H.world) foreign = await H.foreignlyTouchedJobs();
  } finally {
    if (H.world) cleanup = await H.teardownWorld();
  }
  const report = {
    run: RUN,
    parkAt: PARK_AT,
    preflightOk,
    deployedWorkerTouched: foreign,
    guard: H.guardStats,
    egress: {
      faked: egress.faked.length,
      fakedByHost: egress.faked.reduce<Record<string, number>>((acc, call) => {
        acc[call.host] = (acc[call.host] ?? 0) + 1;
        return acc;
      }, {}),
      blocked: egress.blocked,
      parkedInserts: egress.parkedInserts,
      reparkedSqlJobs: egress.reparked.length,
      schemaShims0129: egress.schemaShims,
    },
    jobs: { ran: H.jobLog.length, sequence: H.jobLog.map((j) => j.type + (j.ok ? "" : "!")).join(" > "), failed: H.failedJobs() },
    cleanup,
  };
  console.log("\n=== STORY REPORT ===\n" + JSON.stringify(report, null, 2));
  console.log("\n=== EVIDENCE ===");
  for (const row of evidence) {
    console.log(`| ${row.id} | ${row.flow} | ${row.scenario} | ${row.expected} | ${row.actual.replace(/\|/g, "/").replace(/\n/g, " ")} | ${row.result} | ${row.evidence} | ${row.fix ?? ""} |`);
  }
  assert.deepEqual(foreign, [], "a test-business job was touched by a worker other than this process");
  assert.deepEqual(cleanup?.after.nonZero ?? {}, {}, "rows remain for the test business");
});

/* ================================================================ STORY A */

describe("A. Meta Lead Ads: Northlight Growth (marketing agency, book a meeting)", () => {
  const S: Record<string, string> = {};
  const person = { first: "Amelia", last: "Hart", email: H.testEmail("amelia.hart"), phone: H.dramaPhone(), company: "Hart & Byrne Ltd" };

  before(async () => {
    await configureBusiness({
      name: "Northlight Growth",
      archetype: "MARKETING_AGENCY",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "73.11",
      services: [{ name: "Paid social management", averageValue: 2500, publicPrice: "from £1,500 a month" }],
      questions: [
        { text: "What are you looking to achieve with an agency?", type: "text", required: true },
        { text: "When would you want someone to start?", type: "single_choice", required: true, options: ["This month", "Next quarter", "Just researching"] },
        { text: "Is there a monthly budget you're working to?", type: "single_choice", required: false, options: ["Under £1k", "£1k-£3k", "Over £3k"] },
        { text: "Who else is involved in the decision?", type: "text", required: false },
      ],
    });
    // Connected Page (fake token) and Google Calendar (fake token): created for
    // this story only. Deployed code can only reach them through a job, and
    // every job for this workspace is parked.
    const w = H.mustWorld();
    const pageId = `PAGE_${RUN}`;
    const formId = `FORM_${RUN}`;
    S.pageId = pageId;
    S.formId = formId;
    S.leadgenId = `LG${Date.now()}`;
    const { data: meta } = await admin
      .from("integrations")
      .insert({ business_id: w.businessId, provider_type: "meta", status: "HEALTHY", config: { pageId }, display_name: "Story page" })
      .select("id")
      .single();
    S.metaIntegrationId = meta!.id as string;
    await H.must(
      admin.from("integration_secrets").insert({
        integration_id: meta!.id,
        business_id: w.businessId,
        access_token: "story-fake-page-token",
        token_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
      "meta secret",
    );
    const { data: cal } = await admin
      .from("integrations")
      .insert({ business_id: w.businessId, provider_type: "google_calendar", status: "HEALTHY", config: { calendarId: "primary" }, display_name: "Story calendar" })
      .select("id")
      .single();
    S.calendarIntegrationId = cal!.id as string;
    await H.must(
      admin.from("integration_secrets").insert({
        integration_id: cal!.id,
        business_id: w.businessId,
        access_token: "story-fake-calendar-token",
        token_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
      "calendar secret",
    );

    const createdTime = new Date(Date.now() - 90_000).toISOString().replace("Z", "+0000");
    const { registerFake, json } = await import("./safety.ts");
    registerFake({
      name: "meta-graph",
      match: (url) => url.hostname === "graph.facebook.com",
      respond: (url) => {
        if (url.pathname.endsWith("/me/accounts")) return json({ error: { message: "page token", code: 100 } }, 400);
        if (url.pathname.endsWith(`/${pageId}/leadgen_forms`)) return json({ data: [{ id: formId, name: "Growth audit", status: "ACTIVE" }] });
        if (url.pathname.endsWith(`/${formId}/leads`)) {
          return json({
            data: [
              {
                id: S.leadgenId,
                created_time: createdTime,
                ad_id: "AD1",
                ad_name: "Audit ad",
                adset_id: "AS1",
                adset_name: "UK founders",
                campaign_id: "CMP1",
                campaign_name: "Q4 growth audit",
                form_id: formId,
                platform: "fb",
                field_data: [
                  { name: "full_name", values: [`${person.first} ${person.last}`] },
                  { name: "email", values: [person.email] },
                  { name: "phone_number", values: [person.phone] },
                  { name: "company_name", values: [person.company] },
                  { name: "what_do_you_need_help_with", values: ["More qualified B2B pipeline"] },
                ],
              },
            ],
          });
        }
        return json({ error: { message: "not faked" } }, 404);
      },
    });
  });

  test("A1 webhook -> signed, recorded, acknowledged; poll job queued (parked)", async () => {
    await check({ id: "A1", flow: "Meta webhook", scenario: "signed leadgen webhook", expected: "200, webhook_events row, lead_source.poll parked" }, async () => {
      const { POST } = await import("../../src/app/api/webhooks/meta/route.ts");
      const body = JSON.stringify({
        object: "page",
        entry: [{ id: S.pageId, time: Math.floor(Date.now() / 1000), changes: [{ field: "leadgen", value: { leadgen_id: S.leadgenId, page_id: S.pageId, form_id: S.formId, created_time: Math.floor(Date.now() / 1000) } }] }],
      });
      const response = await POST(new Request("https://story.invalid/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": H.metaSignature(body), "content-type": "application/json", "x-forwarded-for": "127.0.0.2" }, body }));
      H.mustWorld().createdGlobal.webhookEvents.push({ provider: "meta", id: S.leadgenId });
      assert.equal(response.status, 200);
      const { data: jobs } = await admin.from("jobs").select("type, run_at").eq("business_id", H.mustWorld().businessId).eq("type", "lead_source.poll");
      assert.equal(jobs?.length, 1);
      assert.equal(new Date(jobs![0].run_at as string).toISOString(), PARK_AT, "poll job was not parked");
      return `200; poll job parked at ${PARK_AT}`;
    });
  });

  test("A2 poll (faked Graph) -> ingestLead CREATED, touch + provenance, first SMS", async () => {
    await check({ id: "A2", flow: "Meta poll -> ingest", scenario: "poll reads the lead via faked Graph", expected: "lead CREATED, one meta touch with campaign/ad, first follow-up SMS sent via faked Twilio" }, async () => {
      const before = H.jobLog.length;
      await H.runJobs({ skip: [] });
      const failures = H.failedJobs(before);
      const { data: leads } = await admin.from("leads").select("*").eq("business_id", H.mustWorld().businessId).eq("email", person.email);
      assert.equal(leads?.length, 1, `lead not created; failures=${JSON.stringify(failures)}`);
      const lead = leads![0];
      S.leadId = lead.id as string;
      const { data: touches } = await admin.from("lead_touches").select("*").eq("lead_id", S.leadId);
      assert.equal(touches?.length, 1);
      const touch = touches![0];
      assert.equal(touch.provider, "meta");
      assert.equal(touch.provider_record_id, S.leadgenId);
      assert.equal(touch.campaign_id, "CMP1");
      assert.equal(touch.ad_id, "AD1");
      const sms = H.smsOutbox.filter((m) => m.to === person.phone);
      if (sms.length === 0) {
        const { data: events } = await admin.from("automation_events").select("event_type, payload").eq("lead_id", S.leadId);
        const { data: msgs } = await admin.from("messages").select("status, channel, error_code").eq("lead_id", S.leadId);
        const { data: runs } = await admin.from("automation_runs").select("state, current_step, stop_reason").eq("lead_id", S.leadId);
        const fresh = await H.leadRow(S.leadId);
        const { data: mx } = await admin.from("messages").select("status, error_code, error_message").eq("lead_id", S.leadId);
        assert.fail(`no SMS; msgs=${JSON.stringify(mx)} jobs=${H.jobLog.slice(before).map((j) => j.type).join(">")} events=${JSON.stringify(events)} runs=${JSON.stringify(runs)} msgs=${JSON.stringify(msgs)} lead=${JSON.stringify({ s: fresh.status, att: fresh.needs_attention, auto: fresh.automation_active, oo: fresh.opted_out })} blocked=${JSON.stringify(egress.blocked)}`);
      }
      return `lead ${S.leadId.slice(0, 8)} intake_method=${lead.intake_method} created_via=${lead.created_via}; touch campaign=CMP1 ad=AD1; SMS#1="${sms[0].body.slice(0, 60)}"; job failures=${failures.length}`;
    });
  });

  test("A3 identity: the same person via a Google Ads webhook merges (fill blanks only)", async () => {
    await check({ id: "A3", flow: "Identity", scenario: "second arrival, other source, same email", expected: "MERGED into the same lead, 2 touches, merge_events row, provenance unchanged" }, async () => {
      const w = H.mustWorld();
      const { data: gads } = await admin
        .from("integrations")
        .insert({ business_id: w.businessId, provider_type: "google_ads", status: "HEALTHY", external_account_id: "1234567890", display_name: "Story Google Ads" })
        .select("id")
        .single();
      S.googleAdsIntegrationId = gads!.id as string;
      await H.must(admin.from("integration_secrets").insert({ integration_id: gads!.id, business_id: w.businessId, access_token: "story-fake-gads", webhook_secret: `gk_${RUN}`, token_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }), "gads secret");
      const { POST } = await import("../../src/app/api/webhooks/google-ads/route.ts");
      const leadId = `GA_${RUN}_A`;
      const body = JSON.stringify({ lead_id: leadId, form_id: 111, campaign_id: 222, adgroup_id: 333, creative_id: 444, google_key: `gk_${RUN}`, gcl_id: "Cj0story", lead_submit_time: new Date().toISOString(), user_column_data: [
        { column_id: "FULL_NAME", string_value: `${person.first} ${person.last}` },
        { column_id: "EMAIL", string_value: person.email.toUpperCase() },
        { column_id: "JOB_TITLE", string_value: "Managing Director" },
        { column_id: "COMPANY_NAME", string_value: person.company },
      ] });
      const response = await POST(new Request(`https://story.invalid/api/webhooks/google-ads?integration=${gads!.id}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.3" }, body }));
      w.createdGlobal.webhookEvents.push({ provider: "google_ads", id: leadId });
      assert.equal(response.status, 200);
      const before = H.jobLog.length;
      await H.runJobs();
      assert.deepEqual(H.failedJobs(before), []);
      const { data: leads, error: leadsError } = await admin.from("leads").select("*").eq("business_id", w.businessId).eq("email_normalized", person.email);
      assert.equal(leadsError, null);
      assert.equal(leads?.length, 1, "a second lead was created instead of a merge");
      const { data: touches } = await admin.from("lead_touches").select("provider, ingest_outcome, gclid").eq("lead_id", S.leadId).order("received_at");
      assert.deepEqual(touches?.map((t) => `${t.provider}:${t.ingest_outcome}`), ["meta:CREATED", "google_ads:MERGED"]);
      const { data: merges } = await admin.from("merge_events").select("rule, confidence").eq("lead_id", S.leadId);
      assert.ok((merges ?? []).length >= 1, "no merge_events row");
      assert.equal(leads![0].intake_method, "META", "provenance was overwritten");
      return `1 lead; touches=${touches!.map((t) => `${t.provider}:${t.ingest_outcome}`).join(",")}; merge rule=${merges![0].rule}; intake_method still META; job_title=${leads![0].job_title ?? leads![0].role_title} company=${leads![0].company_name}`;
    });
  });

  test("A4 contactability per channel (warm, THEY_CONTACTED_US)", async () => {
    await check({ id: "A4", flow: "Contactability", scenario: "warm ad-form lead with +44 mobile and work email", expected: "SMS and EMAIL allowed (warm, THEY_CONTACTED_US), WHATSAPP not allowed without opt-in" }, async () => {
      const { evaluateAllChannels } = await import("../../src/lib/policy/service.ts");
      const { byChannel } = await evaluateAllChannels(H.mustWorld().businessId, { type: "LEAD", id: S.leadId, email: person.email, phone: person.phone }, "WARM");
      const d = byChannel as unknown as Record<string, { decision: string; reasonCode: string }>;
      for (const v of Object.values(d)) v.decision = (v as unknown as { outcome: string }).outcome;
      const summary = Object.fromEntries(Object.entries(d).map(([c, v]) => [c, `${v.decision}/${v.reasonCode}`]));
      assert.equal(d.SMS.decision, "ALLOWED", JSON.stringify(summary));
      assert.equal(d.EMAIL.decision, "ALLOWED", JSON.stringify(summary));
      assert.notEqual(d.WHATSAPP.decision, "ALLOWED", "WhatsApp allowed without an opt-in");
      const { data: perm } = await admin.from("contact_permissions").select("relationship_type, subscriber_type, consent_scope").eq("subject_id", S.leadId).single();
      return `${JSON.stringify(summary)}; permission=${perm!.relationship_type}/${perm!.subscriber_type}`;
    });
  });

  test("A5 score + tags recorded", async () => {
    await check({ id: "A5", flow: "Scoring", scenario: "lead.score after process/touch", expected: "one current lead_scores row with grade; tags reconciled" }, async () => {
      const { data: scores } = await admin.from("lead_scores").select("*").eq("lead_id", S.leadId);
      const current = (scores ?? []).filter((s) => s.is_current);
      assert.equal(current.length, 1, `current scores=${current.length} all=${JSON.stringify(scores).slice(0, 300)}`);
      const { data: tags } = await admin.from("lead_tags").select("*").eq("lead_id", S.leadId);
      const c = current[0] as Record<string, unknown>;
      return `score=${c.score ?? c.total} grade=${c.grade} versions=${scores!.length}; tags=${(tags ?? []).map((t) => (t as Record<string, unknown>).tag ?? (t as Record<string, unknown>).tag_key).join(",")}`;
    });
  });

  test("A6 adaptive qualification over SMS: one question per message, no repeats, stops at threshold", async () => {
    await check({ id: "A6", flow: "Adaptive qualification", scenario: "3 inbound replies through the Twilio webhook", expected: "Q1 then Q2 asked once each, <=1 '?' per message, optional budget/decision questions never asked after the BOOK_MEETING_B2B threshold" }, async () => {
      const t1 = await H.leadSays(person.phone, "Hi, thanks for getting back to me.");
      const t2 = await H.leadSays(person.phone, "We want more qualified B2B pipeline from LinkedIn and paid social.");
      const t3 = await H.leadSays(person.phone, "This month");
      const all = [...t1.replies, ...t2.replies, ...t3.replies];
      S.turnLog = JSON.stringify({ t1, t2, t3 }).slice(0, 1200);
      for (const reply of all) assert.ok(H.questionMarks(reply) <= 1, `more than one question: ${reply}`);
      const asked = (text: string) => all.filter((r) => r.includes(text)).length;
      assert.equal(asked("What are you looking to achieve with an agency?"), 1, `Q1; ${S.turnLog}`);
      assert.equal(asked("When would you want someone to start?"), 1, `Q2; ${S.turnLog}`);
      assert.equal(asked("monthly budget"), 0, "optional budget question asked after threshold");
      assert.equal(asked("Who else is involved"), 0, "optional authority question asked after threshold");
      const { data: answers } = await admin.from("qualification_answers").select("answer_value, answer_text, source").eq("lead_id", S.leadId);
      const lead = await H.leadRow(S.leadId);
      return `replies=${all.length}: ${all.map((r) => JSON.stringify(r.slice(0, 70))).join(" | ")}; answers=${(answers ?? []).map((a) => `${a.answer_value ?? a.answer_text}`).join(",")}; qualification=${lead.qualification_state}`;
    });
  });

  test("A7 strategy block recorded (method + reason) on every run", async () => {
    await check({ id: "A7", flow: "Strategy", scenario: "conversation_agent_runs.decision_json.strategy", expected: "method, reason, motion BOOK_MEETING_B2B from WORKSPACE" }, async () => {
      const { data: runs } = await admin.from("conversation_agent_runs").select("outcome, decision_json").eq("lead_id", S.leadId).order("created_at");
      assert.ok((runs ?? []).length >= 3, `runs=${runs?.length}`);
      for (const run of runs!) {
        const strategy = (run.decision_json as { strategy?: Record<string, unknown> } | null)?.strategy;
        assert.ok(strategy?.method && strategy?.reason, `run ${run.outcome} has no strategy`);
        assert.equal(strategy.motion, "BOOK_MEETING_B2B");
      }
      const last = (runs!.at(-1)!.decision_json as { strategy: Record<string, unknown> }).strategy;
      return `runs=${runs!.map((r) => r.outcome).join(">")}; last method=${last.method} reason="${String(last.reason).slice(0, 80)}" motionSource=${last.motionSource} stop=${last.stopReason}`;
    });
  });

  test("A8 close per motion: Google booking, provider-confirmed", async () => {
    await check({ id: "A8", flow: "Booking (Google)", scenario: "lead picks an offered slot", expected: "event created with attendee (faked Google), booking scheduled, lead BOOKED, opportunity MEETING_BOOKED" }, async () => {
      const last = await H.latestRun(S.leadId);
      const offered = (last?.decision_json as { offeredSlots?: { label: string }[] } | null)?.offeredSlots ?? [];
      const corrections = H.aiCalls.filter((c) => /correction|validator|fix the following/i.test(c.user)).map((c) => c.user.slice(Math.max(0, c.user.search(/correction|validator|fix the following/i)), 400));
      assert.ok(offered.length > 0, `no slots offered; corrections=${JSON.stringify(corrections)}; last run=${JSON.stringify(last).slice(0, 300)}`);
      const pick = offered[0].label;
      const t4 = await H.leadSays(person.phone, `${pick.split(",").pop()!.trim()} works for me`);
      const { data: bookings } = await admin.from("bookings").select("status, provider, external_event_id, starts_at").eq("lead_id", S.leadId);
      assert.equal(bookings?.length, 1, `bookings=${JSON.stringify(bookings)} t4=${JSON.stringify(t4).slice(0, 500)}`);
      assert.equal(bookings![0].status, "scheduled");
      assert.ok(H.calendarEvents.length >= 1, "no calendar event reached the fake");
      const lead = await H.leadRow(S.leadId);
      assert.equal(lead.status, "BOOKED");
      const { data: opp } = await admin.from("opportunities").select("id, stage, outcome, motion, close_target").eq("lead_id", S.leadId).single();
      assert.equal(opp!.stage, "MEETING_BOOKED");
      S.opportunityId = opp!.id as string;
      return `offered ${offered.length} slots, picked "${pick}"; attendees=${JSON.stringify(H.calendarEvents.at(-1)!.event.attendees)} sendUpdates=${H.calendarEvents.at(-1)!.sendUpdates}; booking ${bookings![0].status}/${bookings![0].provider}; lead BOOKED; opp ${opp!.stage}/${opp!.close_target}; confirmation="${t4.replies[0]?.slice(0, 80)}"`;
    });
  });

  test("A9 opportunity WON with reason", async () => {
    await check({ id: "A9", flow: "Opportunity close", scenario: "opportunity.close WON via the service layer (UI caller, owner)", expected: "outcome WON, reason stored, lead WON, follow-up stopped" }, async () => {
      const { runOperation } = await import("../../src/lib/services/index.ts");
      const w = H.mustWorld();
      const result = await runOperation("opportunity.close", { opportunityId: S.opportunityId, outcome: "WON", reason: "Signed a 6-month paid social retainer" }, { businessId: w.businessId, userId: w.ownerId, role: "owner", caller: "UI", confirmed: true, correlationId: `story-${RUN}-A9` });
      assert.equal(result.success, true, JSON.stringify(result));
      await H.runJobs();
      const { data: opp } = await admin.from("opportunities").select("outcome, outcome_reason, stage").eq("id", S.opportunityId).single();
      const lead = await H.leadRow(S.leadId);
      assert.equal(opp!.outcome, "WON");
      assert.equal(lead.status, "WON");
      return `opp ${opp!.stage}/${opp!.outcome} "${opp!.outcome_reason}"; lead ${lead.status}; automation_active=${lead.automation_active}`;
    });
  });

  test("A10 domain events emitted in order", async () => {
    await check({ id: "A10", flow: "Events", scenario: "domain_events for the lead", expected: "lead.created < lead.touched < reply.received < meeting.booked < opportunity.won" }, async () => {
      const events = await H.domainEventsFor([S.leadId, S.opportunityId]);
      const types = events.map((e) => e.type as string);
      let cursor = -1;
      for (const type of ["lead.created", "lead.touched", "reply.received", "meeting.booked", "opportunity.won"]) {
        const at = types.indexOf(type, cursor + 1);
        assert.ok(at > cursor, `${type} missing or out of order in ${types.join(",")}`);
        cursor = at;
      }
      return types.join(" > ");
    });
  });

  test("A11 analytics funnel reflects the story (source, first touch)", async () => {
    await check({ id: "A11", flow: "Analytics", scenario: "getSlice(source, first) as the owner under RLS", expected: "meta row: 1 lead, contacted, replied, booked, won" }, async () => {
      const { getSlice } = await import("../../src/lib/analytics/slices.ts");
      const now = new Date();
      const bounds = { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 60_000), previousFrom: new Date(now.getTime() - 2 * 86_400_000), previousTo: new Date(now.getTime() - 86_400_000) };
      const slice = await getSlice(H.mustWorld().businessId, bounds as never, "source", "first");
      assert.equal(slice.status, "ok", JSON.stringify(slice));
      const rows = (slice as { rows: Record<string, unknown>[] }).rows;
      const meta = rows.find((r) => JSON.stringify(r).toLowerCase().includes("meta"));
      assert.ok(meta, `no meta row in ${JSON.stringify(rows)}`);
      return JSON.stringify(meta).slice(0, 300);
    });
  });
});

/* ======================================================= STORIES B.. */
// Imported in order; each registers its own describe block.
await import("./story-b-google-ads.ts");
await import("./story-c-linkedin-leadgen.ts");
await import("./story-g-m-intake.ts");
await import("./story-d-f-x.ts");
