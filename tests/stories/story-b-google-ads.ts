/**
 * Story B. Google Ads lead forms: poller AND webhook.
 * Pixelforge Studio: a UK web design and development studio (CREATIVE_WEB_STUDIO)
 * selling fixed-scope websites, motion DIRECT_B2B, closing by approved checkout.
 */
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import * as H from "./harness.ts";
import { check, configureBusiness, connect, enqueuePoll, leadByEmail, touchesFor, openOpportunity, channelVerdicts, runOp } from "./kit.ts";
import { RUN, registerFake, json } from "./safety.ts";

const { admin } = H;

describe("B. Google Ads (poller + webhook): Pixelforge Studio (web studio, direct close by checkout)", () => {
  const S: Record<string, string> = {};
  const person = { first: "Oliver", last: "Nwosu", email: H.testEmail("oliver.nwosu", "example.invalid"), phone: H.dramaPhone(), company: "Nwosu Logistics Ltd" };
  const submissionId = `GAB${Date.now()}`;

  before(async () => {
    await configureBusiness({
      name: "Pixelforge Studio",
      archetype: "CREATIVE_WEB_STUDIO",
      motions: ["DIRECT_B2B"],
      industryCode: "62.01",
      salesModel: "SERVICE",
      services: [{ name: "Starter website", averageValue: 2950, publicPrice: "£2,950" }],
      questions: [
        { text: "What's the scope of the project: roughly how many pages?", type: "text", required: true },
        { text: "When do you need it live?", type: "text", required: true },
        { text: "Is there a budget you're working to?", type: "text", required: false },
      ],
    });
    const w = H.mustWorld();
    await H.must(
      admin.from("commercial_authority").upsert(
        {
          business_id: w.businessId,
          enabled: true,
          approved_checkout_links: [
            { id: "starter-site", label: "Starter website", product: "5-page website build", url: "https://checkout.example.invalid/pay/starter-site", price_text: "£2,950", currency: "GBP" },
          ],
          max_discount_percent: 0,
          requires_human_above_value_minor: null,
          updated_by: w.ownerId,
        },
        { onConflict: "business_id" },
      ),
      "commercial authority",
    );
    S.integrationId = await connect("google_ads", { externalAccountId: "1234567890", webhookSecret: `gk_${RUN}` });

    registerFake({
      name: "google-ads-api",
      match: (url) => url.hostname === "googleads.googleapis.com",
      respond: (url) => {
        if (url.pathname.endsWith("/customers/1234567890/googleAds:search")) {
          return json({
            results: [
              {
                leadFormSubmissionData: {
                  resourceName: `customers/1234567890/leadFormSubmissionData/${submissionId}`,
                  assetId: 9001,
                  campaignId: 7001,
                  adGroupId: 7002,
                  creativeId: 7003,
                  submissionDateTime: new Date(Date.now() - 120_000).toISOString().slice(0, 19).replace("T", " ") + "+00:00",
                  leadFormSubmissionFields: [
                    { fieldType: "FULL_NAME", fieldValue: `${person.first} ${person.last}` },
                    { fieldType: "EMAIL", fieldValue: person.email },
                    { fieldType: "PHONE_NUMBER", fieldValue: person.phone },
                  ],
                },
              },
            ],
          });
        }
        return json({ error: { message: "not faked" } }, 404);
      },
    });
  });

  test("B1 poller (faked Google Ads API) -> CREATED with google_ads touch and campaign ids", async () => {
    await check({ id: "B1", flow: "Google Ads poll -> ingest", scenario: "lead_source.poll reads lead_form_submission_data", expected: "lead CREATED, touch google_ads with campaign/adgroup/creative, first SMS" }, async () => {
      await enqueuePoll(S.integrationId, "google_ads");
      const before = H.jobLog.length;
      await H.runJobs();
      assert.deepEqual(H.failedJobs(before), []);
      const leads = await leadByEmail(person.email);
      assert.equal(leads.length, 1);
      S.leadId = leads[0].id as string;
      const touches = await touchesFor(S.leadId);
      assert.equal(touches.length, 1);
      assert.equal(touches[0].provider, "google_ads");
      assert.equal(touches[0].campaign_id, "7001");
      const sms = H.smsOutbox.filter((m) => m.to === person.phone);
      assert.ok(sms.length >= 1, "no first-touch SMS");
      return `lead ${S.leadId.slice(0, 8)} intake=${leads[0].intake_method}/${leads[0].created_via}; touch record=${touches[0].provider_record_id}; campaign=7001; SMS#1 sent`;
    });
  });

  test("B2 the same submission redelivered by the webhook is one touch (DUPLICATE), not a second", async () => {
    await check({ id: "B2", flow: "Google Ads webhook idempotency", scenario: "webhook lead_id == poller submission id", expected: "no second touch: both paths dedupe on Google's own id", fix: "normalise the poller's providerRecordId to the submission id (last path segment of resourceName) so it equals the webhook's lead_id -- UNVERIFIED that Google's webhook lead_id equals that id" }, async () => {
      const { POST } = await import("../../src/app/api/webhooks/google-ads/route.ts");
      const body = JSON.stringify({ lead_id: submissionId, form_id: 9001, campaign_id: 7001, adgroup_id: 7002, creative_id: 7003, google_key: `gk_${RUN}`, user_column_data: [
        { column_id: "FULL_NAME", string_value: `${person.first} ${person.last}` },
        { column_id: "EMAIL", string_value: person.email },
      ] });
      const response = await POST(new Request(`https://story.invalid/api/webhooks/google-ads?integration=${S.integrationId}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.4" }, body }));
      H.mustWorld().createdGlobal.webhookEvents.push({ provider: "google_ads", id: submissionId });
      assert.equal(response.status, 200);
      await H.runJobs();
      const touches = await touchesFor(S.leadId);
      assert.equal(touches.length, 1, `touches=${touches.map((t) => `${t.provider}:${t.provider_record_id}:${t.ingest_outcome}`).join(" , ")}`);
      return "1 touch";
    });
  });

  test("B3 bad google_key is refused 403 and nothing is recorded", async () => {
    await check({ id: "B3", flow: "Google Ads webhook auth", scenario: "wrong google_key", expected: "403, no webhook_events row" }, async () => {
      const { POST } = await import("../../src/app/api/webhooks/google-ads/route.ts");
      const body = JSON.stringify({ lead_id: `BAD_${RUN}`, google_key: "wrong-key", user_column_data: [{ column_id: "EMAIL", string_value: H.testEmail("intruder") }] });
      const response = await POST(new Request(`https://story.invalid/api/webhooks/google-ads?integration=${S.integrationId}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.5" }, body }));
      const { data } = await admin.from("webhook_events").select("id").eq("provider", "google_ads").like("external_event_id", `%BAD_${RUN}%`);
      assert.equal(response.status, 403);
      assert.equal(data?.length, 0);
      return "403; 0 rows";
    });
  });

  test("B4 contactability (warm)", async () => {
    await check({ id: "B4", flow: "Contactability", scenario: "ad-form lead, +44 mobile", expected: "SMS + EMAIL allowed; WhatsApp not without opt-in" }, async () => {
      const verdicts = await channelVerdicts(S.leadId, { email: person.email, phone: person.phone });
      assert.ok(verdicts.SMS.startsWith("ALLOWED"), JSON.stringify(verdicts));
      assert.ok(verdicts.EMAIL.startsWith("ALLOWED"), JSON.stringify(verdicts));
      assert.ok(!verdicts.WHATSAPP.startsWith("ALLOWED"), JSON.stringify(verdicts));
      return JSON.stringify(verdicts);
    });
  });

  test("B5 DIRECT_B2B qualification then approved checkout link (commercial_authority on)", async () => {
    await check({ id: "B5", flow: "Adaptive qualification + direct close", scenario: "scope, timing answered -> threshold -> PROPOSE_CHECKOUT", expected: "one question per message, budget never asked, checkout URL sent, opportunity CHECKOUT_SENT" }, async () => {
      const t1 = await H.leadSays(person.phone, "Hi, yes we need a new website.");
      const t2 = await H.leadSays(person.phone, "About 6 pages plus a blog, the scope is a brochure site.");
      const t3 = await H.leadSays(person.phone, "We need it live by November.");
      const all = [...t1.replies, ...t2.replies, ...t3.replies];
      for (const reply of all) assert.ok(H.questionMarks(reply) <= 1, `two questions: ${reply}`);
      assert.equal(all.filter((r) => /budget/i.test(r)).length, 0, "budget asked after threshold");
      const checkout = all.find((r) => r.includes("https://checkout.example.invalid/pay/starter-site"));
      assert.ok(checkout, `no checkout link sent: ${JSON.stringify({ t1, t2, t3 }).slice(0, 700)}`);
      const opp = await openOpportunity(S.leadId);
      assert.equal(opp?.stage, "CHECKOUT_SENT", `opp=${JSON.stringify(opp)}`);
      S.opportunityId = opp!.id as string;
      return `replies: ${all.map((r) => JSON.stringify(r.slice(0, 60))).join(" | ")}; opp ${opp!.stage} link=${opp!.checkout_link_id}`;
    });
  });

  test("B6 WON (paid via checkout) with reason", async () => {
    await check({ id: "B6", flow: "Opportunity close", scenario: "opportunity.close WON", expected: "WON, reason, lead WON" }, async () => {
      assert.ok(S.opportunityId, "no opportunity from B5");
      const result = await runOp("opportunity.close", { opportunityId: S.opportunityId, outcome: "WON", reason: "Paid the Starter website checkout" });
      assert.equal(result.success, true, JSON.stringify(result));
      const lead = await H.leadRow(S.leadId);
      assert.equal(lead.status, "WON");
      return `lead WON; events=${(await H.domainEventsFor([S.leadId, S.opportunityId])).map((e) => e.type).join(">")}`;
    });
  });
});
