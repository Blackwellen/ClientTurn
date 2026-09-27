/**
 * Story P. The direct-sale loop, end to end: a tracked Stripe checkout link,
 * one abandoned-checkout nudge, a signed Stripe webhook from the customer's
 * OWN Stripe account to the real route, then WON + the thank-you, and no
 * further nudge.
 *
 * Bramble Analytics: a UK SaaS (SAAS_SELF_SERVE) selling a £49/month plan
 * through a Stripe Payment Link. Nothing reaches Stripe: the webhook is
 * built and signed here with a fake signing secret, and the Payment Link URL
 * is never fetched.
 *
 * Needs migration 0143 (checkout_attempts, checkout_payments,
 * payment_endpoints). Until it is applied every step records BLOCKED with
 * that reason rather than failing: the story cannot prove a loop whose
 * tables do not exist.
 */
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import * as H from "./harness.ts";
import { check, configureBusiness, record, runOp, openOpportunity } from "./kit.ts";
import { RUN } from "./safety.ts";

const { admin } = H;

const STEPS = [
  ["P1", "Tracked checkout link", "lead qualifies -> PROPOSE_CHECKOUT", "Stripe link sent with client_reference_id=<opaque token>; checkout_attempts row SENT"],
  ["P2", "Abandoned-checkout nudge", "attempt 25h old -> checkout.nudge", "attempt ABANDONED; one nudge through the agent path, same tracked link"],
  ["P3", "Stripe webhook (customer's own account)", "signed checkout.session.completed -> real route", "200; webhook_events row; payment.confirm queued"],
  ["P4", "Payment -> WON + thank-you", "payment.confirm runs", "attempt PAID; opportunity WON with £49; automation off; thank-you SMS with onboarding text; opportunity.won emitted"],
  ["P5", "No nudge after payment", "nudge 2 due", "STOP PAID: no further SMS"],
  ["P6", "Idempotent redelivery", "same Stripe event again", "duplicate; still one payment, one thank-you"],
] as const;

describe("P. Direct-sale loop: Bramble Analytics (SaaS, Stripe Payment Link)", () => {
  const S: Record<string, string> = {};
  const person = { first: "Hannah", last: "Okafor", email: H.testEmail("hannah.okafor"), phone: H.dramaPhone() };
  const SIGNING_SECRET = `whsec_story_${RUN.replace(/[^A-Za-z0-9]/g, "")}0123456789abcdef`;
  const LINK_URL = "https://buy.stripe.com/test_storyBrambleTeam49";
  let blocked: string | null = null;

  before(async () => {
    // A GET: a HEAD on a missing table comes back without an error.
    const probe = await admin.from("checkout_attempts").select("id").limit(1);
    if (probe.error) {
      blocked = `migration 0143 not applied (${probe.error.code ?? probe.error.message})`;
      return;
    }
    const { canStoreSecrets } = await import("../../src/lib/security/secret-box.ts");
    if (!canStoreSecrets()) {
      blocked = "CREDENTIAL_ENCRYPTION_KEY is not set, so the Stripe signing secret cannot be stored";
      return;
    }

    await configureBusiness({
      name: "Bramble Analytics",
      archetype: "B2B_SAAS",
      motions: ["SAAS_SELF_SERVE"],
      industryCode: "62.01",
      salesModel: "SAAS",
      services: [{ name: "Bramble Team plan", averageValue: 588, publicPrice: "£49 per month" }],
      questions: [{ text: "What would you mainly use Bramble for?", type: "text", required: true }],
    });
    const w = H.mustWorld();
    await H.must(
      admin.from("commercial_authority").upsert(
        {
          business_id: w.businessId,
          enabled: true,
          approved_checkout_links: [
            {
              id: "team-monthly",
              label: "Team plan",
              product: "Bramble Team plan",
              url: LINK_URL,
              price_text: "£49 per month",
              currency: "GBP",
              billing_interval: "month",
              onboarding_text: "Your workspace invite is on its way to your inbox.",
            },
          ],
          max_discount_percent: 0,
          requires_human_above_value_minor: null,
          abandoned_checkout_enabled: true,
          abandoned_checkout_delay_hours: 24,
          abandoned_checkout_max_nudges: 2,
          abandoned_checkout_gap_hours: 48,
          updated_by: w.ownerId,
        },
        { onConflict: "business_id" },
      ),
      "authority",
    );

    // The customer's Stripe endpoint, through the real settings actions.
    const actions = await import("../../src/lib/payments/actions.ts");
    const created = await actions.createStripePaymentEndpoint();
    assert.equal(created.ok, true, JSON.stringify(created));
    const saved = await actions.saveStripeSigningSecret(SIGNING_SECRET);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const { data: endpoint } = await admin.from("payment_endpoints").select("id").eq("business_id", w.businessId).eq("kind", "STRIPE").single();
    S.endpointId = (endpoint as { id: string }).id;

    // The lead: an API create, as story I, then follow-up switched on.
    const { createApiKey } = await import("../../src/lib/api-keys/service.ts");
    const key = await createApiKey({ businessId: w.businessId, userId: w.ownerId, createdBy: w.ownerId, name: `story-p-${RUN}`, environment: "test", scopes: ["leads:read", "leads:write"] });
    const { POST } = await import("../../src/app/api/v1/leads/route.ts");
    const response = await (POST as unknown as (r: Request) => Promise<Response>)(
      new Request("https://story.invalid/api/v1/leads", {
        method: "POST",
        headers: { authorization: `Bearer ${key!.key}`, "content-type": "application/json", "idempotency-key": `p-${RUN}`, "x-forwarded-for": "127.0.0.21" },
        body: JSON.stringify({
          first_name: person.first,
          last_name: person.last,
          email: person.email,
          phone: person.phone,
          relationship: "THEY_CONTACTED_US",
          source: { type: "WEB_FORM", provider: "website", record_id: `web-p-${RUN}`, form_name: "Start now" },
        }),
      }),
    );
    assert.equal(response.status, 201);
    S.leadId = ((await response.json()) as { data: { lead_id: string } }).data.lead_id;
    await H.runJobs();
    const resumed = await runOp("lead.resume_follow_up", { leadId: S.leadId });
    assert.equal(resumed.success, true, JSON.stringify(resumed));
  });

  function blockedStep(index: number) {
    const [id, flow, scenario, expected] = STEPS[index];
    record({ id, flow, scenario, expected, actual: `BLOCKED: ${blocked}`, result: "BLOCKED", evidence: scenario });
  }

  test("P1 the checkout link goes out tracked", async () => {
    if (blocked) return blockedStep(0);
    await check({ id: STEPS[0][0], flow: STEPS[0][1], scenario: STEPS[0][2], expected: STEPS[0][3] }, async () => {
      const t1 = await H.leadSays(person.phone, "Hi, I'd like to get started with Bramble.");
      const t2 = await H.leadSays(person.phone, "Mainly for tracking our sales pipeline across the team.");
      const all = [...t1.replies, ...t2.replies];
      const sent = all.find((r) => r.includes(LINK_URL));
      assert.ok(sent, `no checkout link; replies=${JSON.stringify(all)}`);
      const match = sent!.match(/client_reference_id=([A-Za-z0-9_-]+)/);
      assert.ok(match, `link not tracked: ${sent}`);
      assert.ok(!sent!.includes(S.leadId), "the lead id must never be the reference");
      const { data: attempt } = await admin.from("checkout_attempts").select("*").eq("lead_id", S.leadId).single();
      assert.equal((attempt as { token: string }).token, match![1]);
      assert.equal((attempt as { status: string }).status, "SENT");
      S.attemptId = (attempt as { id: string }).id;
      S.token = match![1];
      return `sent "${sent!.slice(0, 90)}"; attempt ${S.attemptId.slice(0, 8)} SENT`;
    });
  });

  test("P2 an unpaid attempt gets one nudge through the agent path", async () => {
    if (blocked) return blockedStep(1);
    await check({ id: STEPS[1][0], flow: STEPS[1][1], scenario: STEPS[1][2], expected: STEPS[1][3] }, async () => {
      assert.ok(S.attemptId, "no attempt from P1");
      // Time travel: the link went out 25 hours ago.
      await H.must(admin.from("checkout_attempts").update({ sent_at: new Date(Date.now() - 25 * 3_600_000).toISOString() }).eq("id", S.attemptId), "backdate");
      const before = H.smsOutbox.length;
      const beforeJobs = H.jobLog.length;
      await H.runJobs({ fastForward: ["checkout.nudge"], skip: [] });
      const nudges = H.smsOutbox.slice(before).filter((m) => m.to === person.phone);
      assert.deepEqual(H.failedJobs(beforeJobs), []);
      const { data: attempt } = await admin.from("checkout_attempts").select("status, nudges_sent").eq("id", S.attemptId).single();
      assert.equal((attempt as { status: string }).status, "ABANDONED");
      assert.equal(nudges.length, 1, `nudges=${JSON.stringify(nudges)}`);
      assert.ok(nudges[0].body.includes(`client_reference_id=${S.token}`), nudges[0].body);
      assert.equal((attempt as { nudges_sent: number }).nudges_sent, 1);
      return `nudge "${nudges[0].body.slice(0, 90)}"`;
    });
  });

  test("P3 a signed Stripe webhook reaches the real route", async () => {
    if (blocked) return blockedStep(2);
    await check({ id: STEPS[2][0], flow: STEPS[2][1], scenario: STEPS[2][2], expected: STEPS[2][3] }, async () => {
      assert.ok(S.token, "no token from P1");
      const { signStripePayload } = await import("../../src/lib/payments/signatures.ts");
      const eventId = `evt_story_${RUN.replace(/[^A-Za-z0-9]/g, "")}`;
      const payload = JSON.stringify({
        id: eventId,
        object: "event",
        type: "checkout.session.completed",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: `cs_test_${RUN.replace(/[^A-Za-z0-9]/g, "")}`,
            object: "checkout.session",
            mode: "subscription",
            subscription: `sub_story_${RUN.replace(/[^A-Za-z0-9]/g, "")}`,
            payment_status: "paid",
            amount_total: 4900,
            currency: "gbp",
            client_reference_id: S.token,
            customer_details: { email: "someone.else@example.invalid" },
          },
        },
      });
      S.payload = payload;
      const { POST } = await import("../../src/app/api/webhooks/payments/stripe/[endpointId]/route.ts");
      const call = () =>
        POST(
          new Request(`https://story.invalid/api/webhooks/payments/stripe/${S.endpointId}`, {
            method: "POST",
            headers: { "content-type": "application/json", "stripe-signature": signStripePayload(payload, SIGNING_SECRET, Math.floor(Date.now() / 1000)), "x-forwarded-for": "127.0.0.22" },
            body: payload,
          }),
          { params: Promise.resolve({ endpointId: S.endpointId }) },
        );
      H.mustWorld().createdGlobal.webhookEvents.push({ provider: "stripe_payments", id: `${S.endpointId}:${eventId}` });
      const response = await call();
      assert.equal(response.status, 200, await response.clone().text());
      // A forged signature is refused.
      const forged = await POST(
        new Request(`https://story.invalid/api/webhooks/payments/stripe/${S.endpointId}`, {
          method: "POST",
          headers: { "content-type": "application/json", "stripe-signature": signStripePayload(payload, "whsec_wrong_secret_000000000000", Math.floor(Date.now() / 1000)) },
          body: payload,
        }),
        { params: Promise.resolve({ endpointId: S.endpointId }) },
      );
      assert.equal(forged.status, 400);
      const { data: inbox } = await admin.from("webhook_events").select("status").eq("provider", "stripe_payments").eq("external_event_id", `${S.endpointId}:${eventId}`);
      assert.equal(inbox?.length, 1);
      return `200; forged 400; webhook_events=${inbox?.[0]?.status}`;
    });
  });

  test("P4 the payment closes the deal WON and thanks the lead", async () => {
    if (blocked) return blockedStep(3);
    await check({ id: STEPS[3][0], flow: STEPS[3][1], scenario: STEPS[3][2], expected: STEPS[3][3] }, async () => {
      const before = H.smsOutbox.length;
      const beforeJobs = H.jobLog.length;
      await H.runJobs();
      assert.deepEqual(H.failedJobs(beforeJobs), []);
      const { data: attempt } = await admin.from("checkout_attempts").select("status, amount_minor, currency").eq("id", S.attemptId).single();
      assert.equal((attempt as { status: string }).status, "PAID");
      const opp = await openOpportunity(S.leadId);
      assert.equal(opp?.outcome, "WON", JSON.stringify(opp));
      assert.equal(Number(opp?.value), 49);
      const lead = await H.leadRow(S.leadId);
      assert.equal(lead.status, "WON");
      assert.equal(lead.automation_active, false);
      const thanks = H.smsOutbox.slice(before).filter((m) => m.to === person.phone);
      assert.equal(thanks.length, 1, JSON.stringify(thanks));
      assert.match(thanks[0].body, /Thank you, Hannah! Your payment for Bramble Team plan has come through\. Your workspace invite is on its way/);
      const events = (await H.domainEventsFor([opp!.id as string])).map((e) => e.type);
      assert.ok(events.includes("opportunity.won"), events.join(","));
      const { data: payment } = await admin.from("checkout_payments").select("status, match_kind, mrr_minor").eq("lead_id", S.leadId).single();
      assert.equal((payment as { status: string }).status, "MATCHED");
      assert.equal((payment as { match_kind: string }).match_kind, "TOKEN");
      return `attempt PAID; opp WON £${opp!.value}; lead WON, automation off; thank-you "${thanks[0].body.slice(0, 80)}"; events ${events.join(">")}`;
    });
  });

  test("P5 no nudge after payment", async () => {
    if (blocked) return blockedStep(4);
    await check({ id: STEPS[4][0], flow: STEPS[4][1], scenario: STEPS[4][2], expected: STEPS[4][3] }, async () => {
      await H.must(admin.from("checkout_attempts").update({ sent_at: new Date(Date.now() - 80 * 3_600_000).toISOString() }).eq("id", S.attemptId), "backdate");
      const before = H.smsOutbox.length;
      await H.runJobs({ fastForward: ["checkout.nudge"] });
      const after = H.smsOutbox.slice(before).filter((m) => m.to === person.phone);
      assert.equal(after.length, 0, JSON.stringify(after));
      const { data: attempt } = await admin.from("checkout_attempts").select("status, nudges_sent").eq("id", S.attemptId).single();
      assert.equal((attempt as { status: string }).status, "PAID");
      assert.equal((attempt as { nudges_sent: number }).nudges_sent, 1);
      return "no SMS; attempt still PAID with 1 nudge";
    });
  });

  test("P6 a redelivered event changes nothing", async () => {
    if (blocked) return blockedStep(5);
    await check({ id: STEPS[5][0], flow: STEPS[5][1], scenario: STEPS[5][2], expected: STEPS[5][3] }, async () => {
      const { signStripePayload } = await import("../../src/lib/payments/signatures.ts");
      const { POST } = await import("../../src/app/api/webhooks/payments/stripe/[endpointId]/route.ts");
      const response = await POST(
        new Request(`https://story.invalid/api/webhooks/payments/stripe/${S.endpointId}`, {
          method: "POST",
          headers: { "content-type": "application/json", "stripe-signature": signStripePayload(S.payload, SIGNING_SECRET, Math.floor(Date.now() / 1000)), "x-forwarded-for": "127.0.0.23" },
          body: S.payload,
        }),
        { params: Promise.resolve({ endpointId: S.endpointId }) },
      );
      const body = (await response.json()) as { duplicate?: boolean };
      assert.equal(body.duplicate, true);
      const before = H.smsOutbox.length;
      await H.runJobs();
      assert.equal(H.smsOutbox.slice(before).filter((m) => m.to === person.phone).length, 0);
      const { count } = await admin.from("checkout_payments").select("id", { count: "exact", head: true }).eq("lead_id", S.leadId);
      assert.equal(count, 1);
      return "duplicate acknowledged; 1 payment; no second thank-you";
    });
  });
});
