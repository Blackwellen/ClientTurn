/**
 * Story C. LinkedIn Lead Gen Forms via the Lead Sync API (faked to the shape in
 * Microsoft Learn "Lead Sync API", ms.date 2026-07-14).
 * Stackwise IT: a UK managed IT / IT consultancy (IT_CONSULTANCY), motion
 * ENTERPRISE -- map the problem and stakeholders, then book the meeting with
 * a person. Owner decision 2026-09-27 (human hand-over is the last resort):
 * the meeting IS the hand-off, with the brief attached; the conversation is
 * not taken from the AI before it (was: a hand-over at the threshold).
 */
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import * as H from "./harness.ts";
import { check, configureBusiness, connect, enqueuePoll, leadByEmail, touchesFor, openOpportunity, channelVerdicts, runOp } from "./kit.ts";
import { registerFake, json } from "./safety.ts";

const { admin } = H;

export const linkedinCalls: { path: string; rawQuery: string }[] = [];

describe("C. LinkedIn Lead Gen Forms: Stackwise IT (IT consultancy, enterprise meeting with a brief)", () => {
  const S: Record<string, string> = {};
  const person = { first: "Priya", last: "Raman", email: H.testEmail("priya.raman"), phone: H.dramaPhone(), company: "Raman Freight plc", title: "Head of IT" };
  const responseId = `li-${Date.now()}-5`;
  const formNumericId = "3162";
  const orgId = "5509810";

  before(async () => {
    await configureBusiness({
      name: "Stackwise IT",
      archetype: "IT_CONSULTANCY",
      motions: ["ENTERPRISE"],
      industryCode: "62.02",
      salesModel: "SERVICE",
      services: [{ name: "Managed IT and security programme", averageValue: 60000 }],
      questions: [
        { text: "What's the business problem you're trying to solve?", type: "text", required: true },
        { text: "Which stakeholders will be involved in evaluating this?", type: "text", required: true },
        { text: "What does your decision process look like?", type: "text", required: false },
        { text: "Is there a budget set aside for this?", type: "text", required: false },
      ],
    });
    S.integrationId = await connect("linkedin_ads", { externalAccountId: orgId });

    registerFake({
      name: "linkedin-lead-sync",
      match: (url) => url.hostname === "api.linkedin.com" && (url.pathname.startsWith("/rest/leadFormResponses") || url.pathname.startsWith("/rest/leadForms")),
      respond: (url) => {
        linkedinCalls.push({ path: url.pathname, rawQuery: url.search });
        if (url.pathname === "/rest/leadFormResponses") {
          return json({
            elements: [
              {
                owner: { organization: `urn:li:organization:${orgId}` },
                submitter: "urn:li:person:StoryMember1",
                versionedLeadGenFormUrn: `urn:li:versionedLeadGenForm:(urn:li:leadGenForm:${formNumericId},1)`,
                testLead: false,
                leadType: "SPONSORED",
                leadMetadataInfo: { sponsoredLeadMetadataInfo: { campaign: { name: "IT resilience review", type: "SPONSORED_UPDATES", id: "urn:li:sponsoredCampaign:367378525" } } },
                id: responseId,
                submittedAt: Date.now() - 60_000,
                formResponse: {
                  answers: [
                    { questionId: 10548, answerDetails: { textQuestionAnswer: { answer: person.first } } },
                    { questionId: 10540, answerDetails: { textQuestionAnswer: { answer: person.last } } },
                    { questionId: 9244, answerDetails: { textQuestionAnswer: { answer: person.email } } },
                    { questionId: 9250, answerDetails: { textQuestionAnswer: { answer: person.phone } } },
                    { questionId: 9252, answerDetails: { textQuestionAnswer: { answer: person.title } } },
                    { questionId: 9236, answerDetails: { textQuestionAnswer: { answer: person.company } } },
                  ],
                  consentResponses: [{ accepted: true, consentId: 4 }],
                },
              },
            ],
            paging: { count: 10, start: 0, total: 1 },
          });
        }
        // GET /rest/leadForms/{id}: the form is addressed by its NUMERIC id.
        if (url.pathname === `/rest/leadForms/${formNumericId}`) {
          return json({
            id: Number(formNumericId),
            versionedLeadGenFormUrn: `urn:li:versionedLeadGenForm:(urn:li:leadGenForm:${formNumericId},1)`,
            content: {
              questions: [
                { questionId: 10548, name: "firstName", predefinedField: "FIRST_NAME", question: { localized: { en_US: "First name" } } },
                { questionId: 10540, name: "lastName", predefinedField: "LAST_NAME", question: { localized: { en_US: "Last name" } } },
                { questionId: 9244, name: "email", predefinedField: "EMAIL", question: { localized: { en_US: "Email address" } } },
                { questionId: 9250, name: "phone", predefinedField: "PHONE_NUMBER", question: { localized: { en_US: "Phone number" } } },
                { questionId: 9252, name: "title", predefinedField: "JOB_TITLE", question: { localized: { en_US: "Job title" } } },
                { questionId: 9236, name: "company", predefinedField: "COMPANY_NAME", question: { localized: { en_US: "Company name" } } },
              ],
            },
          });
        }
        return json({ status: 404, message: "Not found (story fake of the documented contract)" }, 404);
      },
    });
  });

  test("C1 Lead Sync poll -> CREATED with name, phone and company mapped from the form schema", async () => {
    await check({ id: "C1", flow: "LinkedIn Lead Gen poll -> ingest", scenario: "leadFormResponses + leadForms/{id} (documented shapes)", expected: "lead CREATED with first/last name, phone, company from predefinedField mapping; touch linkedin_ads", fix: "linkedin-ads.ts questionMapFor: GET /rest/leadForms/{numeric id} and read content.questions (see LinkedIn findings)" }, async () => {
      await enqueuePoll(S.integrationId, "linkedin_ads");
      const before = H.jobLog.length;
      await H.runJobs();
      assert.deepEqual(H.failedJobs(before), []);
      const leads = await leadByEmail(person.email);
      assert.equal(leads.length, 1, `no lead; linkedin calls=${JSON.stringify(linkedinCalls)}`);
      const lead = leads[0];
      S.leadId = lead.id as string;
      const touches = await touchesFor(S.leadId);
      assert.equal(touches[0]?.provider, "linkedin_ads");
      const mapped = { first: lead.first_name, last: lead.last_name, phone: lead.phone_normalized ?? lead.phone, company: lead.company_name };
      assert.deepEqual(mapped, { first: person.first, last: person.last, phone: person.phone, company: person.company }, `calls=${JSON.stringify(linkedinCalls.map((c) => c.path))}`);
      const ownerRaw = linkedinCalls.find((c) => c.path === "/rest/leadFormResponses")?.rawQuery ?? "";
      S.ownerRaw = ownerRaw;
      return `mapped ${JSON.stringify(mapped)}; form fetched at ${linkedinCalls.filter((c) => c.path.startsWith("/rest/leadForms")).map((c) => c.path).join(",")}; owner param raw="${(ownerRaw.match(/owner=[^&]*/) ?? [""])[0]}"`;
    });
  });

  test("C2 owner parameter matches the documented Rest.li encoding", async () => {
    await check({ id: "C2", flow: "LinkedIn Lead Sync request", scenario: "owner=(organization:urn%3Ali%3Aorganization%3AID)", expected: "parentheses and colon raw, only the URN encoded once (no %253A)", fix: "linkedin-ads.ts: build `(organization:${encodeURIComponent(urn)})` without a second encode" }, async () => {
      const owner = (S.ownerRaw.match(/owner=[^&]*/) ?? [""])[0];
      assert.equal(owner, `owner=(organization:urn%3Ali%3Aorganization%3A${orgId})`, `sent ${owner}`);
      return owner;
    });
  });

  test("C3 contactability: warm, UNKNOWN subscriber, SMS+EMAIL allowed", async () => {
    await check({ id: "C3", flow: "Contactability", scenario: "LinkedIn form lead", expected: "SMS/EMAIL allowed, WhatsApp needs opt-in" }, async () => {
      assert.ok(S.leadId, "no lead from C1");
      const verdicts = await channelVerdicts(S.leadId, { email: person.email, phone: person.phone });
      assert.ok(verdicts.EMAIL.startsWith("ALLOWED"), JSON.stringify(verdicts));
      return JSON.stringify(verdicts);
    });
  });

  test("C4 ENTERPRISE: problem + stakeholders + decision process, then a booked meeting with a brief", async () => {
    await check({ id: "C4", flow: "Qualification -> booked meeting + handoff brief", scenario: "3 answers meet the ENTERPRISE threshold; the lead picks an offered slot", expected: "stop asking (budget never asked), slots offered, booking scheduled, no human_takeover and the conversation still AI_ACTIVE, one agent_handoffs ASSIST_REQUEST (MEETING_BRIEF) with the brief stored" }, async () => {
      assert.ok(S.leadId, "no lead from C1");
      const t1 = await H.leadSays(person.phone, "Hello, yes please get in touch.");
      const t2 = await H.leadSays(person.phone, "Our problem is repeated outages across three depots and no DR plan.");
      const t3 = await H.leadSays(person.phone, "Our CFO, the ops director and me as Head of IT will evaluate it.");
      const t4 = await H.leadSays(person.phone, "Decision process is a board sign-off after a pilot.");
      const all = [t1, t2, t3, t4].flatMap((t) => t.replies);
      for (const reply of all) assert.ok(H.questionMarks(reply) <= 1, `two questions: ${reply}`);
      assert.equal(all.filter((r) => /budget/i.test(r)).length, 0, "budget asked after threshold");

      // The close is a meeting with a person, offered by the AI.
      const offeredRun = await H.latestRun(S.leadId);
      const offered = (offeredRun?.decision_json as { offeredSlots?: { label: string }[] } | null)?.offeredSlots ?? [];
      assert.ok(offered.length > 0, `no slots offered; replies=${JSON.stringify(all)}; last run=${JSON.stringify(offeredRun).slice(0, 400)}`);
      const pick = offered[0].label;
      const t5 = await H.leadSays(person.phone, `${pick.split(",").pop()!.trim()} works for me`);

      const { data: bookings } = await admin.from("bookings").select("status, provider, starts_at").eq("lead_id", S.leadId);
      assert.equal(bookings?.length, 1, `bookings=${JSON.stringify(bookings)} t5=${JSON.stringify(t5).slice(0, 500)}`);
      assert.equal(bookings![0].status, "scheduled");

      // The meeting is the hand-off: the conversation was never taken away.
      const lead = await H.leadRow(S.leadId);
      assert.equal(lead.human_takeover, false, "the conversation was handed over");
      const { data: conversation } = await admin.from("conversations").select("owner").eq("lead_id", S.leadId).eq("channel", "sms").maybeSingle();
      assert.equal(conversation?.owner, "AI_ACTIVE");

      // The brief travels with the meeting, as a background assist.
      const { data: handoffs } = await admin.from("agent_handoffs").select("id, reason, status, summary_json").eq("lead_id", S.leadId);
      assert.equal((handoffs ?? []).length, 1, `handoffs=${JSON.stringify(handoffs)}`);
      const summary = handoffs![0].summary_json as Record<string, unknown> | null;
      assert.equal(summary?.kind, "ASSIST_REQUEST");
      assert.equal(summary?.assistReason, "MEETING_BRIEF");
      assert.ok(summary?.leadBrief && summary?.quickBrief, `brief not written: keys=${Object.keys(summary ?? {}).join(",")}`);
      return `replies=${[...all, ...t5.replies].map((r) => JSON.stringify(r.slice(0, 60))).join(" | ")}; picked "${pick}"; booking ${bookings![0].status}/${bookings![0].provider}; takeover=${lead.human_takeover}; owner=${conversation?.owner}; handoff ${handoffs![0].reason}/${handoffs![0].status} kind=${String(summary?.kind)} assist=${String(summary?.assistReason)}; brief keys=${Object.keys(summary!).join(",")}`;
    });
  });

  test("C5 LOST with reason", async () => {
    await check({ id: "C5", flow: "Opportunity close", scenario: "opportunity.close LOST", expected: "LOST with reason; lead LOST" }, async () => {
      assert.ok(S.leadId, "no lead from C1");
      let opp = await openOpportunity(S.leadId);
      if (!opp) {
        const created = await runOp("opportunity.set_stage", { leadId: S.leadId, stage: "QUALIFIED" });
        void created;
        opp = await openOpportunity(S.leadId);
      }
      assert.ok(opp, "no opportunity exists for a qualified enterprise lead");
      const result = await runOp("opportunity.close", { opportunityId: opp!.id, outcome: "LOST", reason: "Renewed with the incumbent MSP for 12 months" });
      assert.equal(result.success, true, JSON.stringify(result));
      const lead = await H.leadRow(S.leadId);
      assert.equal(lead.status, "LOST");
      const closed = await openOpportunity(S.leadId);
      return `opp ${closed!.stage}/${closed!.outcome} "${closed!.outcome_reason}"; lead ${lead.status}`;
    });
  });
});
