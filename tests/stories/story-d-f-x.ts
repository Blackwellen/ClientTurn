/**
 * D  LinkedIn company-page engagement -> prospect -> promotion
 * E  Sales Navigator (SNAP)
 * F  Find Leads discovery -> prospect -> cold-email policy by subscriber type
 * X1-X5 cross-cutting: unsubscribe mid-flow, sole trader + accepted connection,
 *   concurrent duplicate submissions, reply during scheduled follow-up,
 *   human takeover then resume.
 */
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import * as H from "./harness.ts";
import { check, record, configureBusiness, connect, disconnect, leadByEmail, touchesFor, channelVerdicts, runOp } from "./kit.ts";
import { RUN, registerFake, removeFake, json } from "./safety.ts";

const { admin } = H;

/* ================================================================== D */

describe("D. LinkedIn company-page engagement (Community Management API, faked)", () => {
  const S: Record<string, string> = {};
  const commenter = "urn:li:person:StoryCommenter42";
  const versionsSeen: string[] = [];

  before(async () => {
    await configureBusiness({
      name: "Northlight Growth",
      archetype: "MARKETING_AGENCY",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "73.11",
      services: [{ name: "Paid social management", averageValue: 2500 }],
      questions: [{ text: "What are you looking to achieve with an agency?", type: "text", required: true }],
    });
    const integrationId = await connect("linkedin_ads", { externalAccountId: "5509810" });
    // What OAuth stores (identify -> external_account_id) is NOT what the
    // engagement provider reads (config.organizationId). Recorded as D0, then
    // set so the downstream path can be exercised.
    const { data: row } = await admin.from("integrations").select("config, external_account_id").eq("id", integrationId).single();
    const readable = Boolean((row?.config as Record<string, unknown> | null)?.organizationId || (row?.config as Record<string, unknown> | null)?.organizationUrn);
    record({ id: "D0", flow: "LinkedIn engagement config", scenario: "a Lead Gen connection as OAuth stores it (org id in external_account_id)", expected: "engagement provider finds the organisation", actual: readable ? "found" : `config=${JSON.stringify(row?.config)} external_account_id=${row?.external_account_id}: connectedPage() reads only config.organizationId/organizationUrn, so every real connection is 'unconfigured'`, result: readable ? "PASS" : "FAIL", evidence: "linkedin-engagement.ts connectedPage vs linkedin-ads.ts identify", fix: "read integrations.external_account_id as the organisation id (not applied: provider's use is barred by LinkedIn terms; owner decision)" });
    await admin.from("integrations").update({ config: { organizationId: "5509810" } }).eq("id", integrationId);
    // Documented behaviour (Microsoft Learn, Versioning, ms.date 2026-09-16):
    // a deprecated LinkedIn-Version (e.g. 202401) returns an error.
    registerFake({
      name: "linkedin-community",
      match: (url) => url.hostname === "api.linkedin.com" && (url.pathname.startsWith("/rest/posts") || url.pathname.startsWith("/rest/socialActions")),
      respond: (url, _m, _b, headers) => {
        const version = headers.get("linkedin-version") ?? "";
        versionsSeen.push(version);
        if (S.strictVersion === "1" && Number(version) < 202510) {
          return json({ status: 426, code: "NONEXISTENT_VERSION", message: `Requested version ${version} is not active` }, 426);
        }
        if (url.pathname.startsWith("/rest/posts")) return json({ elements: [{ id: "urn:li:share:7001" }] });
        // Comments carry the actor URN only -- no name (Comments API docs).
        return json({ elements: [{ id: "urn:li:comment:(urn:li:share:7001,9001)", actor: commenter, message: { text: "Interesting, how do you measure pipeline quality?" }, created: { time: Date.now() - 3_600_000 } }] });
      },
    });
  });

  // The LinkedIn engagement prospect source was removed (2026-09-26, owner
  // decision): LinkedIn's Restricted Uses forbid using member data to identify
  // sales prospects. D1-D3 now assert it stays gone.
  test("D1 no LinkedIn engagement prospect source is registered", async () => {
    await check({ id: "D1", flow: "LinkedIn engagement source", scenario: "registry after the removal", expected: "no linkedin_engagement provider" }, async () => {
      const { providerByKey } = await import("../../src/lib/find-leads/server/providers/registry.ts");
      assert.equal(providerByKey("linkedin_engagement"), null);
      return "absent";
    });
  });

  test("D2 engagement ingest creates no LinkedIn prospect", async () => {
    await check({ id: "D2", flow: "Engagement -> prospect", scenario: "a commenter on the company page", expected: "no prospect is created from LinkedIn engagement" }, async () => {
      const { ingestSocialEngagement } = await import("../../src/lib/find-leads/server/engagement-ingest.ts");
      const outcome = await ingestSocialEngagement(H.mustWorld().businessId, 20);
      const { data: prospects } = await admin.from("prospects").select("id").eq("business_id", H.mustWorld().businessId).eq("social_external_id", `linkedin_member:${commenter}`);
      assert.equal(prospects?.length ?? 0, 0, `outcome=${JSON.stringify(outcome)}`);
      return "none created";
    });
  });

  test("D3 no LinkedIn profile URL is fabricated", async () => {
    await check({ id: "D3", flow: "LinkedIn data quality", scenario: "profile URL for an app-scoped member id", expected: "no linkedin.com/in/<opaque id> URL anywhere" }, async () => {
      const { data } = await admin.from("prospects").select("linkedin_url, social_profile_url").eq("business_id", H.mustWorld().businessId);
      const fabricated = (data ?? []).filter((row) => `${row.linkedin_url ?? ""}${row.social_profile_url ?? ""}`.includes("StoryCommenter42"));
      assert.equal(fabricated.length, 0);
      return "none";
    });
  });

  test("D4 cleanup of the story connection", async () => {
    removeFake("linkedin-community");
    await disconnect("linkedin_ads");
  });
});

/* ================================================================== E */

describe("E. Sales Navigator (SNAP)", () => {
  test("E1 not applicable without a partner token", () => {
    record({
      id: "E1",
      flow: "Sales Navigator SNAP",
      scenario: "provider reachable without a real token?",
      expected: "run only if reachable without a real token",
      actual: "LINKEDIN_SNAP_ACCESS_TOKEN unset (removed for the run); SNAP is closed to new partners (Microsoft Learn /linkedin/sales, ms.date 2025-05-22) and the provider's endpoints (salesApiLeadSearch / salesApiAccountSearch) are not documented SNAP APIs",
      result: "NOT APPLICABLE",
      evidence: "configured() false; see LinkedIn findings",
    });
  });
});

/* ================================================================== F */

describe("F. Find Leads discovery -> prospects -> cold email policy (Companies House verdicts, faked)", () => {
  const S: Record<string, string> = {};
  const firms = [
    { name: "Harbourline Robotics Ltd", domain: "harbourline.example", ch: { title: "HARBOURLINE ROBOTICS LTD", company_number: "12345678", company_type: "ltd", company_status: "active" }, email: "ops@harbourline.example" },
    { name: "Jo Smith Design", domain: "josmithdesign.example", ch: null, email: "jo@josmithdesign.example", soleTrader: true },
    { name: "Brightfield Partners", domain: "brightfield.example", ch: null, email: "hello@brightfield.example" },
  ];

  before(async () => {
    // The workspace permits business websites and the corporate register as
    // cold-outreach sources (Settings -> Data controls).
    await H.must(admin.from("business_data_controls").upsert({ business_id: H.mustWorld().businessId, allowed_sources: ["BUSINESS_WEBSITE", "PUBLIC_CORPORATE_REGISTER"] }, { onConflict: "business_id" }), "data controls");
    registerFake({
      name: "companies-house",
      match: (url) => url.hostname === "api.company-information.service.gov.uk",
      respond: (url) => {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const firm = firms.find((f) => f.name.toLowerCase() === q);
        return json({ items: firm?.ch ? [firm.ch] : [] });
      },
    });
  });

  test("F1 Companies House verdicts classify subscriber type (free first-party register)", async () => {
    await check({ id: "F1", flow: "Find Leads enrichment", scenario: "lookupCompany via faked register", expected: "Ltd -> CORPORATE; not found -> UNKNOWN", evidence: "companies-house.ts lookupCompany" }, async () => {
      const { lookupCompany } = await import("../../src/lib/find-leads/server/providers/companies-house.ts");
      const verdicts = [];
      for (const firm of firms) verdicts.push(await lookupCompany(firm.name));
      assert.equal(verdicts[0].subscriberType, "CORPORATE", JSON.stringify(verdicts[0]));
      assert.equal(verdicts[2].subscriberType, "UNKNOWN");
      S.verdicts = JSON.stringify(verdicts.map((v) => v.subscriberType));
      return S.verdicts;
    });
  });

  test("F2 prospects (website provenance) -> COLD email: corporate allowed, sole trader blocked, unknown review", async () => {
    await check({ id: "F2", flow: "Cold email policy", scenario: "three prospects from business websites", expected: "CORPORATE ALLOWED; SOLE_TRADER BLOCKED_SUBSCRIBER_TYPE; UNKNOWN REVIEW_SUBSCRIBER_TYPE" }, async () => {
      const w = H.mustWorld();
      const types = ["CORPORATE", "SOLE_TRADER", "UNKNOWN"];
      const results: Record<string, string> = {};
      const { evaluate } = await import("../../src/lib/policy/service.ts");
      for (let i = 0; i < firms.length; i += 1) {
        const firm = firms[i];
        const { data: company } = await admin.from("prospect_companies").insert({ business_id: w.businessId, name: firm.name, domain: firm.domain, website_url: `https://${firm.domain}`, dedupe_key: `story:${RUN}:${firm.domain}`, subscriber_type: types[i], registry_reason: firm.ch ? "Companies House (faked)" : null, location_json: { country: "GB" } }).select("id").single();
        const { data: prospect } = await admin.from("prospects").insert({ business_id: w.businessId, company_id: company!.id, first_name: "Owner", email: firm.email, status: "DISCOVERED", subscriber_type: types[i], source_provider: "website_contacts", is_test: true }).select("id").single();
        await admin.from("prospect_data_sources").insert({ business_id: w.businessId, prospect_id: prospect!.id, company_id: company!.id, field_name: "email", provider: "website_contacts", source_type: "WEBSITE", source_url: `https://${firm.domain}/contact`, confidence: 0.9 });
        const decision = await evaluate({ businessId: w.businessId, subject: { type: "PROSPECT", id: prospect!.id, email: firm.email }, channel: "EMAIL", campaignType: "COLD", permissionOnly: true, record: false } as never);
        results[types[i]] = `${decision.outcome}/${decision.reasonCode}`;
      }
      assert.ok(results.CORPORATE.startsWith("ALLOWED"), JSON.stringify(results));
      assert.ok(results.SOLE_TRADER.startsWith("BLOCKED"), JSON.stringify(results));
      assert.ok(!results.UNKNOWN.startsWith("ALLOWED"), JSON.stringify(results));
      return JSON.stringify(results);
    });
  });

  test("F3 the full sourcing run (Places + website + register) is not exercised here", () => {
    record({ id: "F3", flow: "Find Leads sourcing run", scenario: "createRun -> sourcing.run with faked Places/website", expected: "prospects persisted by the run", actual: "Not run: the 2,340-line sourcing.run handler (AI planning, budgets, waterfall) was out of scope for this pass; F1/F2 cover the register verdict and the policy it drives on stored prospects", result: "BLOCKED", evidence: "scope" });
  });
});

/* ================================================================== X */

describe("X. Cross-cutting stories", () => {
  const S: Record<string, string> = {};

  before(async () => {
    await configureBusiness({
      name: "Northlight Growth",
      archetype: "MARKETING_AGENCY",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "73.11",
      services: [{ name: "Paid social management", averageValue: 2500 }],
      questions: [
        { text: "What are you looking to achieve with an agency?", type: "text", required: true },
        { text: "When would you want someone to start?", type: "text", required: true },
      ],
    });
  });

  async function adLead(label: string) {
    const { ingestLead } = await import("../../src/lib/ingest/service.ts");
    const person = { email: H.testEmail(label), phone: H.dramaPhone() };
    const result = await ingestLead({
      businessId: H.mustWorld().businessId,
      source: { type: "AD_FORM", provider: "meta", providerRecordId: `x-${RUN}-${label}`, formId: "FORM_X", caller: { type: "SYSTEM", id: "story" }, submittedAt: new Date().toISOString() },
      person: { firstName: label.split(".")[0].replace(/^./, (c) => c.toUpperCase()), lastName: "Story", email: person.email, phone: person.phone, companyName: `${label} Ltd` },
    });
    await H.runJobs();
    return { ...person, leadId: result.leadId as string };
  }

  test("X1 unsubscribe mid-flow: STOP on SMS is SMS-only; email one-click unsubscribes email; plain English stops everything", async () => {
    await check({ id: "X1", flow: "Opt-out", scenario: "STOP (SMS) then RFC 8058 email unsubscribe then 'stop contacting me'", expected: "after STOP: SMS blocked, EMAIL allowed, opted_out false; after email unsubscribe: EMAIL blocked; after plain-English: opted_out true" }, async () => {
      const p = await adLead("uma.stop");
      await H.leadSays(p.phone, "STOP");
      const afterStop = await channelVerdicts(p.leadId, p);
      const lead1 = await H.leadRow(p.leadId);
      assert.ok(afterStop.SMS.startsWith("BLOCKED"), JSON.stringify(afterStop));
      assert.ok(afterStop.EMAIL.startsWith("ALLOWED"), JSON.stringify(afterStop));
      assert.equal(lead1.opted_out, false);
      const { POST } = await import("../../src/app/api/unsubscribe/[token]/route.ts");
      const response = await POST(new Request(`https://story.invalid/api/unsubscribe/${lead1.unsubscribe_token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "127.0.0.12" }, body: "List-Unsubscribe=One-Click" }), { params: Promise.resolve({ token: String(lead1.unsubscribe_token) }) });
      await H.runJobs();
      const afterEmail = await channelVerdicts(p.leadId, p);
      assert.equal(response.status, 200);
      assert.ok(afterEmail.EMAIL.startsWith("BLOCKED"), JSON.stringify(afterEmail));
      const replies = await H.leadSays(p.phone, "Please stop contacting me");
      const lead2 = await H.leadRow(p.leadId);
      const events = (await H.domainEventsFor([p.leadId])).map((e) => e.type).filter((t) => t.startsWith("contact."));
      assert.equal(lead2.opted_out, true);
      assert.equal(replies.replies.length, 0, `a reply was sent to an opted-out lead: ${replies.replies}`);
      return `after STOP ${JSON.stringify(afterStop)}; email unsub ${response.status} -> EMAIL ${afterEmail.EMAIL}; plain-English -> opted_out=true; events=${events.join(",")}`;
    });
  });

  test("X2 sole trader who accepted a LinkedIn connection: conversation-only", async () => {
    await check({ id: "X2", flow: "Individual-subscriber policy", scenario: "SOLE_TRADER + ACCEPTED_SOCIAL_CONNECTION", expected: "SOCIAL and EMAIL only ALLOWED with NON_PROMOTIONAL_ONLY (conversation-only), never promotional" }, async () => {
      const w = H.mustWorld();
      const { data: prospect } = await admin.from("prospects").insert({ business_id: w.businessId, first_name: "Sam", last_name: "Trader", email: H.testEmail("sam.trader"), status: "DISCOVERED", subscriber_type: "SOLE_TRADER", social_platform: "LINKEDIN", social_external_id: `linkedin_member:urn:li:person:Sam${RUN}`, is_test: true }).select("id").single();
      const { recordPermission, evaluate } = await import("../../src/lib/policy/service.ts");
      await recordPermission({ businessId: w.businessId, subject: { type: "PROSPECT", id: prospect!.id }, relationshipType: "ACCEPTED_SOCIAL_CONNECTION", relationshipDetail: "Accepted our LinkedIn connection request", subscriberType: "SOLE_TRADER" } as never);
      const social = await evaluate({ businessId: w.businessId, subject: { type: "PROSPECT", id: prospect!.id, social: `linkedin_member:urn:li:person:Sam${RUN}` }, channel: "SOCIAL", campaignType: "WARM", permissionOnly: true, record: false } as never);
      const email = await evaluate({ businessId: w.businessId, subject: { type: "PROSPECT", id: prospect!.id, email: H.testEmail("sam.trader") }, channel: "EMAIL", campaignType: "WARM", permissionOnly: true, record: false } as never);
      const req = (social as { requirements?: string[] }).requirements ?? [];
      assert.equal(social.outcome, "ALLOWED", JSON.stringify(social));
      assert.ok(req.includes("NON_PROMOTIONAL_ONLY"), JSON.stringify(social));
      const emailReq = (email as { requirements?: string[] }).requirements ?? [];
      assert.ok(email.outcome !== "ALLOWED" || emailReq.includes("NON_PROMOTIONAL_ONLY"), `email promotional allowed: ${JSON.stringify(email)}`);
      return `SOCIAL ${social.outcome} [${req.join(",")}]; EMAIL ${email.outcome} [${emailReq.join(",")}]`;
    });
  });

  test("X3 the same person from two sources at the same instant: one lead, two touches", async () => {
    await check({ id: "X3", flow: "Identity race", scenario: "two ingests in parallel (Meta ad form + API)", expected: "1 lead, 2 touches, no error" }, async () => {
      const { ingestLead } = await import("../../src/lib/ingest/service.ts");
      const email = H.testEmail("race.person");
      const phone = H.dramaPhone();
      const base = { businessId: H.mustWorld().businessId, person: { firstName: "Rae", lastName: "Parallel", email, phone } };
      const results = await Promise.allSettled([
        ingestLead({ ...base, source: { type: "AD_FORM", provider: "meta", providerRecordId: `race-meta-${RUN}`, caller: { type: "SYSTEM" } } } as never),
        ingestLead({ ...base, source: { type: "API", provider: "api", providerRecordId: `race-api-${RUN}`, caller: { type: "API_KEY" } }, relationship: "THEY_CONTACTED_US" } as never),
      ]);
      await H.runJobs();
      const leads = await leadByEmail(email);
      assert.equal(leads.length, 1, `leads=${leads.length}; ${JSON.stringify(results).slice(0, 300)}`);
      const touches = await touchesFor(leads[0].id as string);
      assert.equal(touches.length, 2, JSON.stringify(touches.map((t) => t.provider)));
      return `outcomes=${results.map((r) => (r.status === "fulfilled" ? (r.value as { outcome: string }).outcome : `rejected:${String(r.reason).slice(0, 60)}`)).join(",")}; 1 lead, touches=${touches.map((t) => `${t.provider}:${t.ingest_outcome}`).join(",")}`;
    });
  });

  test("X4 a reply during a scheduled follow-up stops the next automated step (send gate re-check)", async () => {
    await check({ id: "X4", flow: "Follow-up stop conditions", scenario: "step 1 sent, step 2 scheduled, lead replies, step 2 fast-forwarded", expected: "no second automated SMS; run stopped (replied)" }, async () => {
      const p = await adLead("xena.reply");
      const automatedBefore = (await H.outboundMessages(p.leadId)).filter((m) => m.direction === "outbound" && m.origin === "automation").length;
      assert.equal(automatedBefore, 1, "step 1 not sent");
      await H.inboundSms(p.phone, "Yes, interested");
      // Only the inbound processing; the agent turn is skipped so it cannot mask the check.
      await H.runJobs({ skip: ["agent.run"] });
      await H.runJobs({ fastForward: ["automation.advance", "message.send"], skip: ["agent.run"] });
      const automatedAfter = (await H.outboundMessages(p.leadId)).filter((m) => m.direction === "outbound" && m.origin === "automation");
      const { data: runs } = await admin.from("automation_runs").select("state, stop_reason").eq("lead_id", p.leadId);
      assert.equal(automatedAfter.length, 1, `automated=${JSON.stringify(automatedAfter.map((m) => m.status))}`);
      S.xenaPhone = p.phone;
      S.xenaLead = p.leadId;
      return `automated sends ${automatedBefore} -> ${automatedAfter.length}; run=${JSON.stringify(runs)}`;
    });
  });

  test("X5 human takeover then resume", async () => {
    await check({ id: "X5", flow: "Takeover", scenario: "lead.takeover, inbound reply, lead.resume_follow_up, inbound reply", expected: "no agent reply during takeover (notification only); agent replies again after resume" }, async () => {
      const p = await adLead("theo.takeover");
      const taken = await runOp("lead.takeover", { leadId: p.leadId });
      assert.equal(taken.success, true, JSON.stringify(taken));
      const during = await H.leadSays(p.phone, "Hello, is anyone there?");
      assert.equal(during.replies.length, 0, `agent replied during takeover: ${during.replies}`);
      const resumed = await runOp("lead.resume_follow_up", { leadId: p.leadId });
      assert.equal(resumed.success, true, JSON.stringify(resumed));
      const afterResume = await H.leadSays(p.phone, "We'd like more pipeline from paid social, that's what we're looking to achieve.");
      assert.ok(afterResume.replies.length >= 1, `no agent reply after resume; run=${JSON.stringify(await H.latestRun(p.leadId)).slice(0, 300)}`);
      return `during takeover: 0 replies; after resume: "${afterResume.replies[0].slice(0, 70)}"`;
    });
  });
});
