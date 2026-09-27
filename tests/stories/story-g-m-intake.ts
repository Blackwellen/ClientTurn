/**
 * Stories G-M: the owned intake paths.
 *   G  CSV import (v4 importer)         Ledgerline Accountants (ACCOUNTING)
 *   H  Add Lead wizard (manual)         Harbour Advisory (MANAGEMENT_CONSULTING), manual booking
 *   I  Public API + Idempotency-Key     Ledgerly (B2B_SAAS, SAAS_SELF_SERVE)
 *   J  MCP create_lead                  (same workspace, service layer via the MCP route)
 *   K  Zapier / custom webhook          app event -> app.ingest -> prospect
 *   L  HubSpot pull                     crm.pull, RECORD_ONLY
 *   M  Salesforce pull                  crm.pull, RECORD_ONLY
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as H from "./harness.ts";
import * as K from "./kit.ts";
import { check, configureBusiness, connect, leadByEmail, touchesFor, channelVerdicts, openOpportunity, runOp } from "./kit.ts";
import { RUN, registerFake, removeFake, json } from "./safety.ts";

const { admin } = H;

/* ================================================================== G */

describe("G. CSV import: Ledgerline Accountants (existing customers)", () => {
  const S: Record<string, string> = {};
  const rows = [
    { first: "Grace", last: "Okafor", email: H.testEmail("grace.okafor"), phone: H.dramaPhone(), company: "Okafor Interiors Ltd" },
    { first: "Tom", last: "Bexley", email: H.testEmail("tom.bexley"), phone: "", company: "Bexley Joinery Ltd" },
    { first: "No", last: "Contact", email: "", phone: "", company: "Nothing Ltd" },
  ];

  before(async () => {
    await configureBusiness({
      name: "Ledgerline Accountants",
      archetype: "ACCOUNTING",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "69.20",
      salesModel: "SERVICE",
      services: [{ name: "Year-end accounts and tax", averageValue: 1800 }],
      questions: [{ text: "When does your current year end?", type: "text", required: true }],
    });
    H.signInAsOwner();
  });

  test("G1 import review -> commit: CREATED x2, INVALID x1, provenance IMPORT, relationship EXISTING_CUSTOMER", async () => {
    await check({ id: "G1", flow: "CSV import -> ingest", scenario: "3 rows, one without any contact point", expected: "2 leads created (IMPORT/IMPORT), 1 invalid row reported, CSV touches, follow-up NOT started" }, async () => {
      const { createImport, commitImport } = await import("../../src/lib/imports/actions.ts");
      const created = await createImport({
        filename: `story-${RUN}.csv`,
        headers: ["First name", "Last name", "Email", "Phone", "Company"],
        rows: rows.map((r) => [r.first, r.last, r.email, r.phone, r.company]),
        mapping: { firstName: 0, lastName: 1, email: 2, phone: 3, companyName: 4 },
        defaultRelationship: "EXISTING_CUSTOMER",
        sourceDetail: "Practice management export",
        startFollowUp: false,
      });
      assert.equal(created.ok, true, JSON.stringify(created));
      S.importId = (created as { data: { id: string } }).data.id;
      const committed = await commitImport(S.importId);
      assert.equal(committed.ok, true, JSON.stringify(committed));
      await H.runJobs();
      const grace = await leadByEmail(rows[0].email);
      const tom = await leadByEmail(rows[1].email);
      assert.equal(grace.length, 1);
      assert.equal(tom.length, 1);
      S.graceId = grace[0].id as string;
      const touches = await touchesFor(S.graceId);
      assert.equal(touches[0]?.source_type, "CSV");
      const { data: perm } = await admin.from("contact_permissions").select("relationship_type").eq("subject_id", S.graceId).single();
      assert.equal(perm?.relationship_type, "EXISTING_CUSTOMER");
      const sms = H.smsOutbox.filter((m) => m.to === rows[0].phone);
      assert.equal(sms.length, 0, "an import with follow-up off sent a message");
      const { data: imp } = await admin.from("lead_imports").select("*").eq("id", S.importId).maybeSingle();
      return `grace intake=${grace[0].intake_method}/${grace[0].created_via}; touch CSV; relationship EXISTING_CUSTOMER; no SMS; import=${JSON.stringify(imp ? { status: imp.status, created: imp.created_count ?? imp.created_rows, invalid: imp.invalid_count ?? imp.invalid_rows } : null)}`;
    });
  });

  test("G2 contactability for an existing customer (email, corporate unknown)", async () => {
    await check({ id: "G2", flow: "Contactability", scenario: "EXISTING_CUSTOMER import", expected: "EMAIL allowed (existing customer); SMS allowed" }, async () => {
      assert.ok(S.graceId, "no lead from G1");
      const verdicts = await channelVerdicts(S.graceId, { email: rows[0].email, phone: rows[0].phone });
      assert.ok(verdicts.EMAIL.startsWith("ALLOWED"), JSON.stringify(verdicts));
      return JSON.stringify(verdicts);
    });
  });
});

/* ================================================================== H */

describe("H. Add Lead wizard: Harbour Advisory (consultancy, manual booking)", () => {
  const S: Record<string, string> = {};
  const person = { first: "Hannah", last: "Price", email: H.testEmail("hannah.price"), phone: H.dramaPhone(), company: "Price & Moor LLP" };

  before(async () => {
    await configureBusiness({
      name: "Harbour Advisory",
      archetype: "MANAGEMENT_CONSULTING",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "70.22",
      salesModel: "SERVICE",
      bookingMode: "handover",
      services: [{ name: "Operations review", averageValue: 12000 }],
      questions: [
        { text: "What are you looking to achieve from the review?", type: "text", required: true },
        { text: "When would you want to start?", type: "text", required: true },
      ],
    });
    H.signInAsOwner();
  });

  test("H1 wizard create: CREATED, MANUAL provenance, permission recorded with evidence, follow-up started", async () => {
    await check({ id: "H1", flow: "Add Lead wizard -> ingest", scenario: "phone call enquiry keyed in by the owner", expected: "CREATED, intake MANUAL/PHONE_CALL, created_via MANUAL_WIZARD, THEY_CONTACTED_US with evidence, first SMS" }, async () => {
      const { createManualLead } = await import("../../src/lib/leads/add-lead/actions.ts");
      const { data: service } = await admin.from("services").select("id").eq("business_id", H.mustWorld().businessId).eq("active", true).single();
      const outcome = await createManualLead({
        contact: { firstName: person.first, lastName: person.last, company: person.company, email: person.email, mobile: person.phone, telephone: "", postcode: "BS1 4DJ", address: "" },
        enquiry: { serviceId: service!.id, enquiryText: "Called about an operations review ahead of a funding round.", source: "PHONE_CALL", sourceDetail: "Inbound call", estimatedValue: "12000", conversionGoal: "BOOK_APPOINTMENT", notes: "" },
        permission: { relationship: "THEY_CONTACTED_US", evidence: "Hannah phoned the office on 26 Sep and asked for a call back." },
        routing: { assigneeId: "", initialStatus: "NEW", needsAttention: false, attentionReason: "", startFollowUp: true, qualificationFlow: "default" },
        acknowledgedDuplicates: false,
      });
      assert.equal(outcome.status, "CREATED", JSON.stringify(outcome));
      S.leadId = (outcome as { leadId: string }).leadId;
      await H.runJobs();
      const lead = await H.leadRow(S.leadId);
      const { data: perm } = await admin.from("contact_permissions").select("relationship_type, consent_evidence, relationship_detail").eq("subject_id", S.leadId).single();
      const sms = H.smsOutbox.filter((m) => m.to === person.phone);
      assert.ok(sms.length >= 1, "no first SMS");
      return `intake=${lead.intake_method} created_via=${lead.created_via}; permission=${perm?.relationship_type} evidence="${String(perm?.consent_evidence ?? perm?.relationship_detail ?? "").slice(0, 50)}"; SMS#1 sent`;
    });
  });

  test("H2 the wizard refuses an exact duplicate", async () => {
    await check({ id: "H2", flow: "Identity (wizard)", scenario: "same email typed again", expected: "DUPLICATE with the existing record, nothing created" }, async () => {
      const { createManualLead } = await import("../../src/lib/leads/add-lead/actions.ts");
      const { data: service } = await admin.from("services").select("id").eq("business_id", H.mustWorld().businessId).eq("active", true).single();
      const outcome = await createManualLead({
        contact: { firstName: person.first, lastName: person.last, company: person.company, email: person.email.toUpperCase(), mobile: "", telephone: "", postcode: "BS1 4DJ", address: "" },
        enquiry: { serviceId: service!.id, enquiryText: "Second entry", source: "MANUAL", sourceDetail: "", estimatedValue: "", conversionGoal: "BOOK_APPOINTMENT", notes: "" },
        permission: { relationship: "THEY_CONTACTED_US", evidence: "Duplicate test" },
        routing: { assigneeId: "", initialStatus: "NEW", needsAttention: false, attentionReason: "", startFollowUp: false, qualificationFlow: "default" },
        acknowledgedDuplicates: true,
      });
      assert.equal(outcome.status, "DUPLICATE", JSON.stringify(outcome));
      assert.equal((await leadByEmail(person.email)).length, 1);
      return "DUPLICATE; 1 lead";
    });
  });

  test("H3 handover booking mode: what happens at the close", async () => {
    // Engine in its default mode (SHADOW: QI_RELEASE_GATES_PASSED is false), so
    // this is the LEGACY turn. At the threshold the agent asks "which day and
    // time?" (BOOKING_OPTIONS_SENT, preferredTimeAsked=1); the pending request
    // is created from the lead's ANSWER, exactly as in Q5 (engine LIVE).
    await check({ id: "H3", flow: "Booking (handover mode, engine SHADOW = legacy turn)", scenario: "booking_mode handover, threshold met, lead then names a time", expected: "fixed 'which day and time?' at the threshold, then a PENDING booking for the stated time (flow map 9: 'Manual -> pending row, staff Confirm / Decline'); lead told 'requested', not BOOKED" }, async () => {
      assert.ok(S.leadId, "no lead from H1");
      await H.leadSays(person.phone, "Thanks for calling back.");
      await H.leadSays(person.phone, "We want to find where our operations are leaking margin, that's what we're looking to achieve.");
      const t3 = await H.leadSays(person.phone, "We'd want to start next month.");
      const asked = await H.latestRun(S.leadId);
      const askedDecision = (asked?.decision_json ?? {}) as { preferredTimeAsked?: number; qi?: { accounting?: { engine_mode?: string } } };
      assert.equal(asked?.outcome, "BOOKING_OPTIONS_SENT", `threshold turn ${asked?.outcome}`);
      assert.equal(askedDecision.preferredTimeAsked, 1, `threshold turn did not ask for a time: ${JSON.stringify(asked?.decision_json).slice(0, 300)}`);
      // Not Q5's "Tuesday at 2pm": bookings_one_active_per_slot_idx allows one
      // active booking per workspace slot, and this pending request stays open.
      const t4 = await H.leadSays(person.phone, "Wednesday at 11am works for me");
      const last = await H.latestRun(S.leadId);
      const { data: bookings } = await admin.from("bookings").select("status, provider").eq("lead_id", S.leadId);
      assert.equal(bookings?.[0]?.status, "pending", `bookings=${JSON.stringify(bookings)}; last run ${last?.outcome} ${JSON.stringify(last?.decision_json).slice(0, 300)}`);
      const lead = await H.leadRow(S.leadId);
      assert.notEqual(lead.status, "BOOKED", "a pending request marked the lead BOOKED");
      assert.ok(t4.replies.length >= 1 && t4.replies.every((r) => !/\bbooked\b/i.test(r) || /not confirmed/i.test(r)), `reply: ${JSON.stringify(t4.replies)}`);
      return `engine ${askedDecision.qi?.accounting?.engine_mode ?? "?"}; threshold turn asked "${(t3.replies[0] ?? "").slice(0, 60)}"; booking ${bookings![0].status}/${bookings![0].provider}; lead ${lead.status}; reply "${(t4.replies[0] ?? "").slice(0, 60)}"`;
    });
  });

  test("H4 Google rejects the event: the slot stays a pending request, 'someone will confirm', staff confirm", async () => {
    await check({ id: "H4", flow: "Booking (pending -> staff confirm)", scenario: "google_calendar mode, events.insert fails", expected: "booking 'pending', lead not BOOKED, no 'booked' claim; staff confirm -> scheduled, lead BOOKED" }, async () => {
      assert.ok(S.leadId, "no lead from H1");
      await admin.from("business_settings").update({ booking_mode: "google_calendar" }).eq("business_id", H.mustWorld().businessId);
      await connect("google_calendar", { config: { calendarId: "primary" } });
      // H3b (engine SHADOW = legacy turn; Q4 is the same with the engine LIVE):
      // the lead asks for a person, the agent hands off, a person resumes
      // follow-up, and the agent must answer again. H4 then uses a fresh lead.
      const handed = await H.leadSays(person.phone, "Can I speak to a real person please?");
      const handRun = await H.latestRun(S.leadId);
      const resumed = await runOp("lead.resume_follow_up", { leadId: S.leadId });
      const probe = await H.leadSays(person.phone, "Are you still there?");
      const probeRun = await H.latestRun(S.leadId);
      const handedOff = handRun?.outcome === "HANDOVER_CREATED";
      K.record({ id: "H3b", flow: "Hand-off release (engine SHADOW)", scenario: "lead asks for a person -> agent hand-off, then lead.resume_follow_up, then an inbound reply", expected: "the agent answers again (not HUMAN_OWNS_CONVERSATION)", actual: `hand-off ${handRun?.outcome} (acks ${handed.replies.length}); resume ${resumed.success ? "ok" : "failed"}; next inbound -> ${probeRun?.outcome}/${probeRun?.error_code ?? "-"}; replies=${probe.replies.length}`, result: handedOff && resumed.success && probeRun?.error_code !== "HUMAN_OWNS_CONVERSATION" && probe.replies.length >= 1 ? "PASS" : "FAIL", evidence: "conversation_agent_runs outcome/error_code for the hand-off and the probe turn; SMS fake outbox", fix: handedOff ? undefined : "the hand-off request did not create a hand-off; H3b not exercised" });
      const { createManualLead } = await import("../../src/lib/leads/add-lead/actions.ts");
      const { data: service } = await admin.from("services").select("id").eq("business_id", H.mustWorld().businessId).eq("active", true).single();
      const fresh = { email: H.testEmail("harriet.cole"), phone: H.dramaPhone() };
      const created = await createManualLead({
        contact: { firstName: "Harriet", lastName: "Cole", company: "Cole Haulage Ltd", email: fresh.email, mobile: fresh.phone, telephone: "", postcode: "BS2 0JA", address: "" },
        enquiry: { serviceId: service!.id, enquiryText: "Wants an operations review.", source: "REFERRAL", sourceDetail: "Referred by Hannah Price", estimatedValue: "", conversionGoal: "BOOK_APPOINTMENT", notes: "" },
        permission: { relationship: "THEY_CONTACTED_US", evidence: "Harriet phoned in after a referral from Hannah Price." },
        routing: { assigneeId: "", initialStatus: "NEW", needsAttention: false, attentionReason: "", startFollowUp: true, qualificationFlow: "default" },
        acknowledgedDuplicates: true,
      });
      assert.equal(created.status, "CREATED", JSON.stringify(created));
      const freshId = (created as { leadId: string }).leadId;
      await H.runJobs();
      S.leadId = freshId;
      person.phone = fresh.phone;
      await H.leadSays(person.phone, "Hi, Hannah said to get in touch.");
      await H.leadSays(person.phone, "We're looking to achieve better margins across our depots.");
      await H.leadSays(person.phone, "We'd want to start next month.");
      registerFake({
        name: "google-calendar-reject",
        match: (url, method) => url.hostname === "www.googleapis.com" && method === "POST" && url.pathname.endsWith("/events"),
        respond: () => json({ error: { code: 503, message: "Backend Error" } }, 503),
      });
      try {
        const t1 = { replies: H.smsOutbox.filter((m) => m.to === person.phone).map((m) => m.body) };
        const last = await H.latestRun(S.leadId);
        const offered = (last?.decision_json as { offeredSlots?: { label: string }[] } | null)?.offeredSlots ?? [];
        assert.ok(offered.length > 0, `no slots offered; last=${JSON.stringify(last).slice(0, 300)}; replies=${JSON.stringify(t1.replies)}; lead=${JSON.stringify(await H.leadRow(S.leadId)).slice(0, 300)}`);
        const pick = offered[offered.length - 1];
        const t2 = await H.leadSays(person.phone, `${pick.label.split(",").pop()!.trim()} please`);
        const { data: bookings } = await admin.from("bookings").select("id, status, provider").eq("lead_id", S.leadId);
        const pickRun = await H.latestRun(S.leadId);
        assert.equal(bookings?.[0]?.status, "pending", `bookings=${JSON.stringify(bookings)}; picked="${pick.label}"; replies=${JSON.stringify(t2.replies)}; run=${JSON.stringify(pickRun).slice(0, 400)}`);
        const lead = await H.leadRow(S.leadId);
        assert.notEqual(lead.status, "BOOKED", "a pending request marked the lead BOOKED");
        const ackOut = (await H.outboundMessages(S.leadId)).filter((m) => m.direction === "outbound").slice(-1)[0];
        assert.ok(t2.replies.length >= 1, `no 'requested' SMS reached the lead (last outbound ${ackOut?.status}/${ackOut?.error_code})`);
        assert.ok(t2.replies.every((r) => /not confirmed/i.test(r)), `claimed booked: ${t2.replies}`);
        const confirmed = await runOp("booking.set_status", { bookingId: bookings![0].id, status: "scheduled" });
        assert.equal(confirmed.success, true, JSON.stringify(confirmed));
        const after = await H.leadRow(S.leadId);
        assert.equal(after.status, "BOOKED");
        const lastOut = (await H.outboundMessages(S.leadId)).filter((m) => m.direction === "outbound").slice(-1)[0];
        return `pending ${bookings![0].provider}; SMS to lead after the failure: ${t2.replies.length ? JSON.stringify(t2.replies[0].slice(0, 70)) : `none (last outbound: ${lastOut?.status}/${lastOut?.error_code} "${String(lastOut?.body ?? "").slice(0, 60)}")`}; run ${pickRun?.outcome}; staff confirm -> lead ${after.status}`;
      } finally {
        removeFake("google-calendar-reject");
      }
    });
  });
});

/* ================================================================== I */

describe("I. Public API POST /api/v1/leads: Ledgerly (B2B SaaS, self-serve trial)", () => {
  const S: Record<string, string> = {};
  const person = { first: "Isaac", last: "Mensah", email: H.testEmail("isaac.mensah"), phone: H.dramaPhone(), company: "Mensah Wholesale Ltd" };

  before(async () => {
    await configureBusiness({
      name: "Ledgerly",
      archetype: "B2B_SAAS",
      motions: ["SAAS_SELF_SERVE"],
      industryCode: "58.29",
      salesModel: "SAAS",
      services: [{ name: "Ledgerly Team plan", averageValue: 588, publicPrice: "£49 per month" }],
      questions: [
        { text: "What would you mainly want to use it for?", type: "text", required: true },
        { text: "How many people on your team would be using it?", type: "text", required: false },
      ],
    });
    const w = H.mustWorld();
    await H.must(
      admin.from("commercial_authority").upsert(
        {
          business_id: w.businessId,
          enabled: true,
          approved_checkout_links: [{ id: "team-trial", label: "Team plan trial", product: "Ledgerly Team, 14-day trial", url: "https://checkout.example.invalid/pay/team-trial", price_text: "£49 per month", currency: "GBP" }],
          max_discount_percent: 0,
          requires_human_above_value_minor: null,
          updated_by: w.ownerId,
        },
        { onConflict: "business_id" },
      ),
      "authority",
    );
    const { createApiKey } = await import("../../src/lib/api-keys/service.ts");
    const key = await createApiKey({ businessId: w.businessId, userId: w.ownerId, createdBy: w.ownerId, name: `story-${RUN}`, environment: "test", scopes: ["leads:read", "leads:write"] });
    assert.ok(key, "API key not created");
    S.apiKey = key!.key;
    S.apiKeyId = key!.id;
  });

  async function post(body: unknown, idem: string | null) {
    const { POST } = await import("../../src/app/api/v1/leads/route.ts");
    const headers: Record<string, string> = { authorization: `Bearer ${S.apiKey}`, "content-type": "application/json", "x-forwarded-for": "127.0.0.9" };
    if (idem) headers["idempotency-key"] = idem;
    const response = await (POST as unknown as (r: Request) => Promise<Response>)(new Request("https://story.invalid/api/v1/leads", { method: "POST", headers, body: JSON.stringify(body) }));
    return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  }

  const payload = () => ({
    first_name: person.first, last_name: person.last, email: person.email, phone: person.phone, company_name: person.company,
    relationship: "THEY_CONTACTED_US",
    source: { type: "WEB_FORM", provider: "website", record_id: `web-${RUN}`, form_name: "Start a trial", utm_source: "google", utm_medium: "cpc", utm_campaign: "Ledgerly-UK" },
  });

  test("I1 POST with Idempotency-Key -> 201 CREATED; the same key again -> the first outcome, one lead", async () => {
    await check({ id: "I1", flow: "Public API -> ingest", scenario: "Idempotency-Key replay", expected: "201 CREATED then 200 with the same lead id; one lead, one touch; UTM stored; follow-up not auto-started" }, async () => {
      const first = await post(payload(), `idem-${RUN}-1`);
      assert.equal(first.status, 201, JSON.stringify(first));
      const data = (first.body as { data: { outcome: string; lead_id: string } }).data;
      S.leadId = data.lead_id;
      const replay = await post(payload(), `idem-${RUN}-1`);
      const replayData = (replay.body as { data: { outcome: string; lead_id: string; original_outcome?: string } }).data;
      assert.equal(replayData.lead_id, S.leadId);
      await H.runJobs();
      assert.equal((await leadByEmail(person.email)).length, 1);
      const touches = await touchesFor(S.leadId);
      assert.equal(touches.length, 1, `touches=${touches.length}`);
      assert.equal(touches[0].utm_campaign, "ledgerly-uk");
      const lead = await H.leadRow(S.leadId);
      assert.equal(lead.automation_active, false);
      return `first ${first.status} ${data.outcome}; replay ${replay.status} ${replayData.outcome}/${replayData.original_outcome ?? ""}; touches=1 utm_campaign=${touches[0].utm_campaign}; automation_active=false`;
    });
  });

  test("I2 no Idempotency-Key -> 400; wrong scope/unknown key -> 401", async () => {
    await check({ id: "I2", flow: "Public API guards", scenario: "missing Idempotency-Key; bad key", expected: "400 invalid_request; 401" }, async () => {
      const missing = await post(payload(), null);
      assert.equal(missing.status, 400, JSON.stringify(missing));
      const saved = S.apiKey;
      S.apiKey = `${saved.slice(0, -4)}XXXX`;
      const bad = await post(payload(), `idem-${RUN}-2`);
      S.apiKey = saved;
      assert.equal(bad.status, 401, JSON.stringify(bad));
      return `missing key ${missing.status}; bad key ${bad.status}`;
    });
  });

  test("I3 SAAS_SELF_SERVE: use case answered -> threshold -> approved trial link", async () => {
    await check({ id: "I3", flow: "Qualification + direct close (sign-up)", scenario: "lead texts in after the API create", expected: "one question, then PROPOSE_CHECKOUT with the approved trial link; team-size (optional) not asked" }, async () => {
      assert.ok(S.leadId, "no lead from I1");
      const t1 = await H.leadSays(person.phone, "Hi, I filled in the trial form on your site.");
      const t2 = await H.leadSays(person.phone, "Mainly to use it for invoicing and chasing late payers.");
      const all = [...t1.replies, ...t2.replies];
      const link = all.find((r) => r.includes("https://checkout.example.invalid/pay/team-trial"));
      assert.ok(link, `no trial link; outbound=${JSON.stringify((await H.outboundMessages(S.leadId)).map((m) => [m.direction, m.status, m.error_code, String(m.body).slice(0, 50)]))}; runs=${JSON.stringify(await H.latestRun(S.leadId)).slice(0, 300)}`);
      const opp = await openOpportunity(S.leadId);
      assert.equal(opp?.stage, "CHECKOUT_SENT");
      S.opportunityId = opp!.id as string;
      return `replies=${all.map((r) => JSON.stringify(r.slice(0, 60))).join(" | ")}; opp ${opp!.stage}`;
    });
  });

  test("I3b a person switches follow-up on; the conversation then closes on the trial link", async () => {
    await check({ id: "I3b", flow: "Direct close (sign-up) after resume", scenario: "lead.resume_follow_up, then the lead answers the use-case question", expected: "approved trial link sent, opportunity CHECKOUT_SENT" }, async () => {
      assert.ok(S.leadId, "no lead from I1");
      const resumed = await runOp("lead.resume_follow_up", { leadId: S.leadId });
      assert.equal(resumed.success, true, JSON.stringify(resumed));
      const t = await H.leadSays(person.phone, "It's mainly for invoicing and chasing late payers.");
      const link = t.replies.find((r) => r.includes("https://checkout.example.invalid/pay/team-trial"));
      assert.ok(link, `no trial link; replies=${JSON.stringify(t.replies)}; outbound=${JSON.stringify((await H.outboundMessages(S.leadId)).slice(-2).map((m) => [m.status, m.error_code]))}`);
      const opp = await openOpportunity(S.leadId);
      assert.equal(opp?.stage, "CHECKOUT_SENT");
      S.opportunityId = opp!.id as string;
      return `reply "${link!.slice(0, 80)}"; opp ${opp!.stage}`;
    });
  });

  test("I4 sign-up recorded manually as WON (not trackable automatically)", async () => {
    await check({ id: "I4", flow: "Opportunity close", scenario: "opportunity.close WON via API caller", expected: "WON with reason" }, async () => {
      assert.ok(S.opportunityId, "no opportunity from I3/I3b");
      const result = await runOp("opportunity.close", { opportunityId: S.opportunityId, outcome: "WON", reason: "Converted from trial to Team plan" }, "API");
      assert.equal(result.success, true, JSON.stringify(result));
      return "WON";
    });
  });

  after(async () => {
    if (S.apiKeyId) await admin.from("api_keys").delete().eq("id", S.apiKeyId);
  });
});

/* ================================================================== J */

describe("J. MCP create_lead (API-key bearer through /api/mcp)", () => {
  const S: Record<string, string> = {};
  const person = { first: "Jade", last: "Kowalski", email: H.testEmail("jade.kowalski"), phone: H.dramaPhone(), company: "Kowalski Print Ltd" };

  before(async () => {
    const w = H.mustWorld();
    const { createApiKey } = await import("../../src/lib/api-keys/service.ts");
    const key = await createApiKey({ businessId: w.businessId, userId: w.ownerId, createdBy: w.ownerId, name: `story-mcp-${RUN}`, environment: "test", scopes: ["leads:read", "leads:write"] });
    assert.ok(key);
    S.key = key!.key;
    S.keyId = key!.id;
  });

  async function rpc(method: string, params: Record<string, unknown>) {
    const { POST } = await import("../../src/app/api/mcp/route.ts");
    const response = await POST(new Request("https://story.invalid/api/mcp", { method: "POST", headers: { authorization: `Bearer ${S.key}`, "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "127.0.0.10" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) }));
    return { status: response.status, body: (await response.json().catch(async () => ({ raw: await response.text() }))) as Record<string, unknown> };
  }

  test("J1 tools/call create_lead -> CREATED; a retry -> same lead (MERGED/DUPLICATE); cold relationship refused", async () => {
    await check({ id: "J1", flow: "MCP -> ingest", scenario: "create_lead, retried, then FOUND_BY_US", expected: "1 lead, MCP provenance, retry does not create a second lead; FOUND_BY_US refused" }, async () => {
      const args = { firstName: person.first, lastName: person.last, email: person.email, phone: person.phone, companyName: person.company, relationshipType: "THEY_CONTACTED_US", relationshipDetail: "Asked via the website chat" };
      const first = await rpc("tools/call", { name: "create_lead", arguments: args });
      assert.equal(first.status, 200, JSON.stringify(first).slice(0, 300));
      const retry = await rpc("tools/call", { name: "create_lead", arguments: args });
      const cold = await rpc("tools/call", { name: "create_lead", arguments: { ...args, email: H.testEmail("cold.jade"), phone: undefined, relationshipType: "FOUND_BY_US" } });
      await H.runJobs();
      const leads = await leadByEmail(person.email);
      assert.equal(leads.length, 1, `leads=${leads.length}; first=${JSON.stringify(first).slice(0, 300)}`);
      S.leadId = leads[0].id as string;
      const touches = await touchesFor(S.leadId);
      assert.equal(touches[0].caller_type, "MCP_CLIENT", JSON.stringify(touches[0]));
      assert.equal((await leadByEmail(H.testEmail("cold.jade"))).length, 0, "FOUND_BY_US created a lead");
      const coldText = JSON.stringify(cold.body);
      return `lead ${S.leadId.slice(0, 8)} touches=${touches.length} (${touches.map((t) => t.ingest_outcome).join(",")}); cold refused: ${coldText.slice(0, 120)}`;
    });
  });

  after(async () => {
    if (S.keyId) await admin.from("api_keys").delete().eq("id", S.keyId);
  });
});

/* ================================================================== K */

describe("K. Zapier inbound webhook (app event RPC)", () => {
  const S: Record<string, string> = {};
  const secret = `whsec_story_${RUN}_abcdefghijklmnop`;
  const person = { first: "Kai", last: "Doyle", email: H.testEmail("kai.doyle"), company: "Doyle Freight Ltd" };

  before(async () => {
    H.signInAsOwner();
    const { installWorkspaceApp } = await import("../../src/lib/integrations/app-actions.ts");
    const result = await installWorkspaceApp({ app: "zapier", authMethod: "hmac_sha256", credentials: { signing_secret: secret }, label: "Story Zap" });
    assert.ok("id" in result && result.id, JSON.stringify(result));
    S.installId = (result as { id: string }).id;
  });

  async function send(body: Record<string, unknown>, sign = true) {
    const { POST } = await import("../../src/app/api/apps/[id]/events/route.ts");
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign ? createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex") : "0".repeat(64);
    const response = await POST(new Request(`https://story.invalid/api/apps/${S.installId}/events`, { method: "POST", headers: { "content-type": "application/json", "x-clientturn-timestamp": ts, "x-clientturn-signature": sig, "x-forwarded-for": "127.0.0.11" }, body: raw }), { params: Promise.resolve({ id: S.installId }) });
    return response.status;
  }

  test("K1 signed event -> app.ingest -> PROSPECT (not a lead); replay is one event; bad signature 401", async () => {
    await check({ id: "K1", flow: "Zapier -> app event -> prospect", scenario: "signed event, replayed, then unsigned", expected: "one prospect with provenance zapier, no lead, no contact; replay no second job; 401 unsigned" }, async () => {
      const event = { eventId: `zap-${RUN}-1`, eventType: "new_contact", firstName: person.first, lastName: person.last, email: person.email, company: person.company };
      const s1 = await send(event);
      const s2 = await send(event);
      const s3 = await send({ ...event, eventId: `zap-${RUN}-2` }, false);
      await H.runJobs();
      const { data: prospects } = await admin.from("prospects").select("*").eq("business_id", H.mustWorld().businessId).eq("email", person.email);
      const { data: events } = await admin.from("workspace_app_events").select("id").eq("install_id", S.installId);
      assert.equal(s1 < 300, true, `first ${s1}`);
      assert.equal(s3, 401);
      assert.equal(events?.length, 1, "replay stored a second event");
      assert.equal(prospects?.length, 1, JSON.stringify(prospects));
      assert.equal((await leadByEmail(person.email)).length, 0, "a connector event became a lead");
      const p0 = prospects![0] as Record<string, unknown>;
      return `statuses ${s1}/${s2}/${s3}; events=1; prospect status=${p0.status} source=${p0.source_type ?? p0.source ?? p0.origin}`;
    });
  });
});

/* ============================================================== L & M */

function crmStory(id: "L" | "M", provider: "hubspot" | "salesforce") {
  describe(`${id}. ${provider === "hubspot" ? "HubSpot" : "Salesforce"} pull (crm.pull, RECORD_ONLY)`, () => {
    const S: Record<string, string> = {};
    const person = { first: provider === "hubspot" ? "Lena" : "Marcus", last: provider === "hubspot" ? "Fischer" : "Oyelaran", email: H.testEmail(`${provider}.contact`), phone: H.dramaPhone(), company: provider === "hubspot" ? "Fischer Robotics Ltd" : "Oyelaran Estates Ltd" };

    before(async () => {
      S.integrationId = await connect(provider, provider === "salesforce" ? { config: { instanceUrl: "https://story-fake.my.salesforce.com" } } : {});
      await H.must(admin.from("crm_pull_settings").upsert({ integration_id: S.integrationId, business_id: H.mustWorld().businessId, provider_type: provider, enabled: true, updated_by: H.mustWorld().ownerId }, { onConflict: "integration_id" }), "pull settings");
      const modified = new Date(Date.now() + 5_000).toISOString();
      registerFake({
        name: `crm-${provider}`,
        match: (url) => (provider === "hubspot" ? url.hostname === "api.hubapi.com" : url.hostname === "story-fake.my.salesforce.com"),
        respond: (url) => {
          if (provider === "hubspot" && url.pathname === "/crm/v3/objects/contacts/search") {
            return json({ results: [{ id: `hs-${RUN}`, properties: { firstname: person.first, lastname: person.last, email: person.email, mobilephone: person.phone, company: person.company, jobtitle: "COO", createdate: modified, lastmodifieddate: modified } }] });
          }
          if (provider === "salesforce" && url.pathname.includes("/query")) {
            return json({ totalSize: 1, done: true, records: [{ Id: `00Q${RUN}AAA`, FirstName: person.first, LastName: person.last, Email: person.email, MobilePhone: person.phone, Company: person.company, Title: "Director", CreatedDate: modified, LastModifiedDate: modified }] });
          }
          return json({ message: "not faked" }, 404);
        },
      });
    });

    test(`${id}1 crm.pull -> CREATED, CRM touch, never auto-contacted`, async () => {
      await check({ id: `${id}1`, flow: `${provider} pull -> ingest`, scenario: "one record modified after the cursor", expected: "lead CREATED, touch CRM/provider, RECORD_ONLY (no SMS, no follow-up)" }, async () => {
        const { enqueue } = await import("../../src/lib/jobs/queue.ts");
        await enqueue("crm.pull", { integrationId: S.integrationId }, { businessId: H.mustWorld().businessId, idempotencyKey: `story-crm:${S.integrationId}:1` });
        const before = H.jobLog.length;
        await H.runJobs();
        // The first run only writes the cursor (initial = now); the record is
        // modified after it, so a second pull picks it up.
        await enqueue("crm.pull", { integrationId: S.integrationId }, { businessId: H.mustWorld().businessId, idempotencyKey: `story-crm:${S.integrationId}:2` });
        await H.runJobs();
        assert.deepEqual(H.failedJobs(before), []);
        const leads = await leadByEmail(person.email);
        const { data: setting } = await admin.from("crm_pull_settings").select("last_run_status, last_run_ingested, last_run_error").eq("integration_id", S.integrationId).single();
        assert.equal(leads.length, 1, `no lead; setting=${JSON.stringify(setting)}`);
        S.leadId = leads[0].id as string;
        const touches = await touchesFor(S.leadId);
        assert.equal(touches[0].source_type, "CRM");
        assert.equal(H.smsOutbox.filter((m) => m.to === person.phone).length, 0, "a CRM pull contacted the lead");
        return `lead ${S.leadId.slice(0, 8)} touch ${touches[0].source_type}/${touches[0].provider}; setting=${JSON.stringify(setting)}; no SMS`;
      });
    });

    // The CRM connection exists only for this story.
    after(async () => {
      await admin.from("crm_pull_settings").update({ enabled: false }).eq("integration_id", S.integrationId);
      await admin.from("integrations").delete().eq("id", S.integrationId);
    });
  });
}
crmStory("L", "hubspot");
crmStory("M", "salesforce");
