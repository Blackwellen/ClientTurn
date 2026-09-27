/**
 * Story Q: the Qualification Intelligence engine in LIVE mode on the test
 * workspace (design 08 §C.5 release gates; coverage tracker 8.28).
 *
 *   Q1 high intent books without over-qualifying (calendar slots offered,
 *      at most one gating question, no budget/authority, booking created);
 *   Q2 "not interested" after a pricing-page enquiry: NEGATIVE, no reply,
 *      no pursuit, no model call;
 *   Q3 a lead created through the public API gets a reply (I3, LIVE);
 *   Q4 resume after the agent's hand-off: the agent answers again (H3b, LIVE);
 *   Q5 manual booking mode: the preferred time becomes a PENDING request on
 *      the engine's booking-readiness, lead not BOOKED (H3, LIVE).
 *
 * Same safety design as every story (README.md): no real outbound, provider
 * fakes only, every job parked, the labelled ZZ-E2E-STORY workspace, full
 * cleanup proof in revenue-stories.test.ts `after`. Imported LAST so the LIVE
 * engine mode set here cannot change the earlier stories.
 *
 * The model is scripted: the script reads the NBA strategy block the runtime
 * hands it (strategy.ts buildNbaStrategyBlock) and does exactly that move.
 * Model wording quality is NOT evaluated here.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as H from "./harness.ts";
import { check, configureBusiness, connect, disconnect, runOp } from "./kit.ts";
import { RUN } from "./safety.ts";

const { admin } = H;

/* ------------------------------------------------------------- helpers */

async function setEngineMode(mode: "OFF" | "SHADOW" | "LIVE") {
  const { LIBRARY_VERSION } = await import("../../src/lib/sales-library/types.ts");
  const w = H.mustWorld();
  await H.must(
    admin.from("workspace_sales_overrides").upsert(
      {
        business_id: w.businessId,
        kind: "QUALIFICATION_POLICY",
        key: "*",
        payload: { engineMode: mode },
        library_version: LIBRARY_VERSION,
        updated_by: w.ownerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,kind,key" },
    ),
    "engine mode",
  );
  const { loadEngineMode } = await import("../../src/lib/qualification-intelligence/service.ts");
  assert.equal(await loadEngineMode(w.businessId), mode, "engine mode not stored");
}

/** The scripted model for LIVE turns: it performs the NBA block's one move. */
function liveAi(taskType: string, user: string): unknown | undefined {
  if (taskType !== "agent_decision") return undefined;
  const ask = user.match(/ask only this, in natural wording: (.+)$/m)?.[1]?.trim() ?? null;
  const slots = /Move: stop qualifying and propose a meeting: offer the confirmed slots/.test(user);
  if (slots && !/^Before that, /m.test(user)) {
    return { intent: "BOOKING_REQUEST", confidence: 0.93, proposed_action: "SEND_BOOKING_OPTIONS", message: "Happy to set that up. Which of these times suits you best?", extracted: [], reasoning_code: "SCRIPTED_BOOK" };
  }
  if (ask) {
    return { intent: "SERVICE_ENQUIRY", confidence: 0.92, proposed_action: "ASK_NEXT_QUESTION", message: `Thanks, that helps. ${ask}`, extracted: [], reasoning_code: "SCRIPTED_ASK" };
  }
  if (/Move: answer their question/.test(user)) {
    return { intent: "PRICE_ENQUIRY", confidence: 0.9, proposed_action: "REPLY", message: "Pricing starts from the figure on our site, and we tailor it after a short call.", extracted: [], reasoning_code: "SCRIPTED_ANSWER" };
  }
  return undefined;
}

/** A form lead (ad form) with the service chosen and the postcode typed on the form. */
async function formLead(label: string, extra: { landingUrl?: string; postcode?: string } = {}) {
  const { ingestLead } = await import("../../src/lib/ingest/service.ts");
  const { data: service } = await admin.from("services").select("id").eq("business_id", H.mustWorld().businessId).eq("active", true).limit(1).single();
  const person = { email: H.testEmail(label), phone: H.dramaPhone() };
  const result = await ingestLead({
    businessId: H.mustWorld().businessId,
    serviceId: service!.id as string,
    source: {
      type: extra.landingUrl ? "WEB_FORM" : "AD_FORM",
      provider: extra.landingUrl ? "website" : "meta",
      providerRecordId: `q-${RUN}-${label}`,
      formId: "FORM_Q",
      caller: { type: "SYSTEM", id: "story" },
      submittedAt: new Date().toISOString(),
      ...(extra.landingUrl ? { landingUrl: extra.landingUrl } : {}),
    },
    person: {
      firstName: label.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
      lastName: "Story",
      email: person.email,
      phone: person.phone,
      companyName: `${label} Ltd`,
      postcode: extra.postcode ?? "LS6 2AB",
    },
  });
  await H.runJobs();
  return { ...person, leadId: result.leadId as string };
}

type RunQi = { nba?: { next_action?: string; intent_state?: string; question_intent?: { dimension?: string; purpose?: string } | null; rule?: string } };
async function runsFor(leadId: string) {
  const { data } = await admin
    .from("conversation_agent_runs")
    .select("id, outcome, status, error_code, decision_json, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return (data ?? []) as { id: string; outcome: string; status: string; error_code: string | null; decision_json: Record<string, unknown> & { qi?: RunQi } }[];
}
const planned = (run: { decision_json: { qi?: RunQi } } | undefined) => run?.decision_json?.qi?.nba ?? null;

/* ================================================================== Q */

describe("Q. Qualification engine LIVE: Brightside Studio (web studio, book a meeting)", () => {
  before(async () => {
    await configureBusiness({
      name: "Brightside Studio",
      archetype: "CREATIVE_WEB_STUDIO",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "62.01",
      salesModel: "AGENCY",
      bookingMode: "handover",
      services: [{ name: "Website redesign", averageValue: 9000, publicPrice: "from £6,000" }],
      questions: [
        { text: "What would you like the new site to do for the business?", type: "text", required: true },
        { text: "When would you want it live?", type: "text", required: false },
      ],
    });
    await disconnect("google_calendar").catch(() => undefined);
    await setEngineMode("LIVE");
    H.scriptAi(liveAi);
    H.signInAsOwner();
  });

  after(async () => {
    H.scriptAi(null);
  });

  test("Q5 manual booking mode: a booking-ready lead's preferred time becomes a PENDING request (H3, LIVE)", async () => {
    await check(
      {
        id: "Q5",
        flow: "Booking (handover mode, engine LIVE)",
        scenario: "form lead asks to book; no calendar, no link",
        expected: "fixed 'which day and time?' (no model call), then a PENDING booking for the stated time; lead told 'requested', not BOOKED; lifecycle not QUALIFIED",
      },
      async () => {
        const p = await formLead("quinn.manual");
        // States the scope, so no gating question is left (pure-engine check: CTA_BOOK, no question).
        const t1 = await H.leadSays(p.phone, "We need a new website for the practice. Can we book a call?");
        const r1 = (await runsFor(p.leadId)).slice(-1)[0];
        assert.equal((r1?.decision_json as { preferredTimeAsked?: number }).preferredTimeAsked, 1, `run ${JSON.stringify(r1).slice(0, 400)}`);
        assert.equal((r1?.decision_json as { engineBookingReady?: boolean }).engineBookingReady, true, "readiness not recorded");
        assert.equal(t1.replies.length, 1);
        assert.equal(H.questionMarks(t1.replies[0]), 1);
        const t2 = await H.leadSays(p.phone, "Tuesday at 2pm works for me");
        const { data: bookings } = await admin.from("bookings").select("id, status").eq("lead_id", p.leadId);
        assert.equal(bookings?.[0]?.status, "pending", `bookings=${JSON.stringify(bookings)}; run=${JSON.stringify((await runsFor(p.leadId)).slice(-1)[0]).slice(0, 400)}`);
        const lead = await H.leadRow(p.leadId);
        assert.notEqual(lead.status, "BOOKED");
        assert.ok(t2.replies.every((r) => !/\bbooked\b/i.test(r) || /not confirmed/i.test(r)), `claimed booked: ${t2.replies}`);
        return `asked "${t1.replies[0].slice(0, 60)}"; booking ${bookings![0].status}; lead ${lead.status} (qualification_state ${lead.qualification_state}); reply "${(t2.replies[0] ?? "").slice(0, 60)}"`;
      },
    );
  });

  test("Q1 high intent books without over-qualifying (calendar slots)", async () => {
    await check(
      {
        id: "Q1",
        flow: "Booking-ready close (engine LIVE)",
        scenario: "form lead with service + postcode asks to book this week",
        expected: "CTA_BOOK with no VERIFY of form values; no BUDGET/AUTHORITY/STAKEHOLDERS asked; slots offered; chosen slot booked",
      },
      async () => {
        await admin.from("business_settings").update({ booking_mode: "google_calendar" }).eq("business_id", H.mustWorld().businessId);
        await connect("google_calendar", { config: { calendarId: "primary" } });
        const p = await formLead("quentin.ready");
        const t1 = await H.leadSays(p.phone, "We need a new website before our launch. Can we book a call this week?");
        const runs = await runsFor(p.leadId);
        const nba = planned(runs.slice(-1)[0]);
        assert.equal(nba?.next_action, "CTA_BOOK", `nba ${JSON.stringify(nba)}`);
        const asked = runs.map((r) => planned(r)?.question_intent?.dimension).filter(Boolean) as string[];
        for (const dim of ["BUDGET", "AUTHORITY", "STAKEHOLDERS", "DECISION_PROCESS"]) assert.ok(!asked.includes(dim), `over-qualified: asked ${dim}`);
        assert.ok(!runs.some((r) => planned(r)?.question_intent?.purpose === "VERIFY"), "a form value was VERIFY-asked");
        const offered = (runs.slice(-1)[0]?.decision_json as { offeredSlots?: { label: string }[] }).offeredSlots ?? [];
        assert.ok(offered.length > 0, `no slots; replies=${JSON.stringify(t1.replies)}`);
        const pick = offered[0];
        const t2 = await H.leadSays(p.phone, `${pick.label.split(",").pop()!.trim()} please`);
        const { data: bookings } = await admin.from("bookings").select("status").eq("lead_id", p.leadId);
        const pickRun = (await runsFor(p.leadId)).slice(-1)[0];
        assert.ok(
          bookings?.length === 1,
          `bookings=${JSON.stringify(bookings)}; picked "${pick.label}"; replies=${JSON.stringify(t2.replies)}; failures=${JSON.stringify(t2.failures)}; pick run ${pickRun?.outcome}/${pickRun?.error_code} ${JSON.stringify(pickRun?.decision_json).slice(0, 900)}`,
        );
        await disconnect("google_calendar");
        await admin.from("business_settings").update({ booking_mode: "handover" }).eq("business_id", H.mustWorld().businessId);
        return `turn 1 NBA ${nba?.next_action} (${nba?.rule}); questions asked: ${asked.join(",") || "none"}; slots ${offered.length}; booking ${bookings![0].status}`;
      },
    );
  });

  test("Q2 'not interested' after a pricing-page enquiry: NEGATIVE, no pursuit", async () => {
    await check(
      {
        id: "Q2",
        flow: "Negative intent (engine LIVE)",
        scenario: "web-form lead from /pricing replies 'not interested'",
        expected: "NBA NO_ACTION on NEGATIVE; no reply SMS; follow-up stopped; no agent_decision model call for the turn",
      },
      async () => {
        const p = await formLead("quincy.pricing", { landingUrl: "https://brightside.example.invalid/pricing" });
        const aiBefore = H.aiCalls.filter((c) => c.taskType === "agent_decision").length;
        const t = await H.leadSays(p.phone, "Not interested, thanks.");
        const run = (await runsFor(p.leadId)).slice(-1)[0];
        const nba = planned(run);
        assert.equal(t.replies.length, 0, `replied: ${t.replies}`);
        assert.equal(nba?.intent_state, "NEGATIVE", `nba ${JSON.stringify(nba)} run ${run?.outcome}/${run?.error_code}`);
        assert.ok(nba?.next_action === "NO_ACTION" || nba?.next_action === "DISQUALIFY", `pursued: ${nba?.next_action}`);
        const { data: active } = await admin.from("automation_runs").select("state").eq("lead_id", p.leadId).eq("state", "ACTIVE");
        assert.equal(active?.length ?? 0, 0, "follow-up still active");
        const aiAfter = H.aiCalls.filter((c) => c.taskType === "agent_decision").length;
        assert.equal(aiAfter, aiBefore, "a model call was made for a negative lead");
        const { data: signal } = await admin.from("lead_intent_signals").select("signal_type").eq("lead_id", p.leadId).eq("signal_type", "CONVERTING_PAGE_PRICING");
        return `pricing signal ${signal?.length ? "recorded" : "absent"}; NBA ${nba?.next_action} on ${nba?.intent_state}; replies 0; active follow-up 0; model calls +0`;
      },
    );
  });

  test("Q3 a lead created through the public API gets a reply (I3, engine LIVE)", async () => {
    await check(
      {
        id: "Q3",
        flow: "Reply to an API-created lead (engine LIVE)",
        scenario: "POST /api/v1/leads, then the lead texts in",
        expected: "the agent replies (automation_active false does not stop a reply the lead is owed); run outcome matches the send",
      },
      async () => {
        const w = H.mustWorld();
        const { createApiKey } = await import("../../src/lib/api-keys/service.ts");
        const key = await createApiKey({ businessId: w.businessId, userId: w.ownerId, createdBy: w.ownerId, name: `story-q-${RUN}`, environment: "test", scopes: ["leads:read", "leads:write"] });
        assert.ok(key, "API key not created");
        const person = { email: H.testEmail("quill.api"), phone: H.dramaPhone() };
        const { POST } = await import("../../src/app/api/v1/leads/route.ts");
        const response = await (POST as unknown as (r: Request) => Promise<Response>)(
          new Request("https://story.invalid/api/v1/leads", {
            method: "POST",
            headers: { authorization: `Bearer ${key!.key}`, "content-type": "application/json", "idempotency-key": `q-${RUN}-api`, "x-forwarded-for": "127.0.0.21" },
            body: JSON.stringify({ first_name: "Quill", last_name: "Story", email: person.email, phone: person.phone, company_name: "Quill Ltd", relationship: "THEY_CONTACTED_US", source: { type: "WEB_FORM", provider: "website", record_id: `q-web-${RUN}`, form_name: "Contact us" } }),
          }),
        );
        assert.equal(response.status, 201, `api ${response.status}`);
        const leadId = ((await response.json()) as { data: { lead_id: string } }).data.lead_id;
        await H.runJobs();
        const t = await H.leadSays(person.phone, "Hi, I filled in your contact form. We want our site to bring in more enquiries.");
        const run = (await runsFor(leadId)).slice(-1)[0];
        assert.ok(t.replies.length >= 1, `no reply; run ${run?.outcome}/${run?.error_code}; outbound=${JSON.stringify((await H.outboundMessages(leadId)).map((m) => [m.direction, m.status, m.error_code]))}`);
        assert.notEqual(run?.outcome, "FAILED");
        return `reply "${t.replies[0].slice(0, 70)}"; run ${run?.outcome}; NBA ${planned(run)?.next_action}`;
      },
    );
  });

  test("Q4 resume after the agent's hand-off: the agent answers again (H3b, engine LIVE)", async () => {
    await check(
      {
        id: "Q4",
        flow: "Hand-off release (engine LIVE)",
        scenario: "lead asks for a person -> hand-off; lead.resume_follow_up; lead writes again",
        expected: "silent while handed over; after resume the agent replies (not HUMAN_OWNS_CONVERSATION)",
      },
      async () => {
        const p = await formLead("quentina.resume");
        const handed = await H.leadSays(p.phone, "Can I speak to a real person please?");
        const handRun = (await runsFor(p.leadId)).slice(-1)[0];
        assert.equal(handRun?.outcome, "HANDOVER_CREATED", `run ${handRun?.outcome}`);
        const during = await H.leadSays(p.phone, "Hello?");
        assert.equal(during.replies.length, 0, `agent replied while handed over: ${during.replies}`);
        const resumed = await runOp("lead.resume_follow_up", { leadId: p.leadId });
        assert.equal(resumed.success, true, JSON.stringify(resumed));
        const after = await H.leadSays(p.phone, "Sorry, I'm happy to carry on here. We want the new site to bring in more enquiries.");
        const run = (await runsFor(p.leadId)).slice(-1)[0];
        assert.notEqual(run?.error_code, "HUMAN_OWNS_CONVERSATION");
        assert.ok(after.replies.length >= 1, `no reply after resume; run ${run?.outcome}/${run?.error_code}`);
        return `hand-off ack ${handed.replies.length}; during 0; after resume "${after.replies[0].slice(0, 60)}" (${run?.outcome})`;
      },
    );
  });
});
