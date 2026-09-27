/**
 * Story S: a lead with several interests (08 §B.20, migration 0144).
 *
 *   S1 a studio lead who came in on a website rebuild also wants the Growth
 *      subscription (a self-serve sign-up). The coordinator chooses the
 *      subscription (closest to its close): the approved checkout link for
 *      THAT offer is sent, and both interests are recorded;
 *   S2 the subscription is won. The lead is not closed: follow-up carries on
 *      for the website, and the lead is not WON while it is open (0144);
 *   S3 "can we book a call about the website?" books the meeting for the
 *      website interest, and no shared fact (team size, company size,
 *      timing) was ever asked on any turn.
 *
 * Same safety design as every story (README.md). Imported after Q (engine
 * LIVE). Migration 0144 is written, not applied: the checks that need its
 * columns (one opportunity per interest, the guarded close projection) run
 * when it is applied and are reported as "pending 0144" otherwise; the
 * conversation checks run either way.
 *
 * The model is scripted: it performs the NBA block's one move and, when the
 * block allows a light touch on the other interest, adds it.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as H from "./harness.ts";
import { check, configureBusiness, connect, disconnect } from "./kit.ts";
import { RUN } from "./safety.ts";

const { admin } = H;
const LINK_URL = "https://shop.example.invalid/checkout/growth-monthly";
const SHARED = ["TEAM_SIZE", "COMPANY_SIZE", "TIMING", "AUTHORITY"];

type RunRow = { id: string; outcome: string; error_code: string | null; decision_json: Record<string, unknown> };

async function runsFor(leadId: string): Promise<RunRow[]> {
  const { data } = await admin
    .from("conversation_agent_runs")
    .select("id, outcome, error_code, decision_json, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return (data ?? []) as RunRow[];
}

const focusOf = (run: RunRow | undefined) =>
  (run?.decision_json as { interests?: { primary?: { serviceName?: string; action?: string }; companion?: { kind?: string } | null } } | undefined)?.interests ?? null;
const askedDims = (runs: RunRow[]) =>
  runs.map((r) => (r.decision_json as { qi?: { nba?: { question_intent?: { dimension?: string } | null } } }).qi?.nba?.question_intent?.dimension).filter(Boolean) as string[];

/** The scripted model: the block's one move, plus the light touch when the block allows one. */
function severalAi(taskType: string, user: string): unknown | undefined {
  if (taskType !== "agent_decision") return undefined;
  const linkId = user.match(/use checkout_link_id ([a-z0-9_-]+)/)?.[1] ?? null;
  if (/propose PROPOSE_CHECKOUT/.test(user) && linkId) {
    let message = "Brilliant, here is the link to start your Growth subscription.";
    const ask = user.match(/After the link, one short sentence on ([^:]+): ask only this: (.+)$/m);
    const call = user.match(/After the link, one short sentence on (.+?): ask whether a quick call/m);
    if (ask) message += ` On the ${ask[1].toLowerCase()}, ${ask[2].charAt(0).toLowerCase()}${ask[2].slice(1)}`;
    else if (call) message += ` On the ${call[1].toLowerCase()}, would a quick call help?`;
    return { intent: "POSITIVE_REPLY", confidence: 0.93, proposed_action: "PROPOSE_CHECKOUT", checkout_link_id: linkId, message, extracted: [], reasoning_code: "SCRIPTED_CHECKOUT" };
  }
  if (/Move: stop qualifying and propose a meeting: offer the confirmed slots/.test(user) && !/^Before that, /m.test(user)) {
    return { intent: "BOOKING_REQUEST", confidence: 0.93, proposed_action: "SEND_BOOKING_OPTIONS", message: "Happy to set up a call about the website. Which of these times suits you best?", extracted: [], reasoning_code: "SCRIPTED_BOOK" };
  }
  const q = user.match(/ask only this[^:]*: (.+)$/m)?.[1]?.trim() ?? null;
  if (q) return { intent: "SERVICE_ENQUIRY", confidence: 0.92, proposed_action: "ASK_NEXT_QUESTION", message: `Thanks, that helps. ${q.replace(/ \(if it helps.*$/, "")}`, extracted: [], reasoning_code: "SCRIPTED_ASK" };
  if (/Move: answer their question|Move: share one useful point/.test(user)) {
    return { intent: "SERVICE_ENQUIRY", confidence: 0.9, proposed_action: "REPLY", message: "Thanks. We keep things simple and the team will follow up on the details.", extracted: [], reasoning_code: "SCRIPTED_INFORM" };
  }
  return undefined;
}

describe("S. Several interests: Northlight Studio (website rebuild + Growth subscription)", () => {
  const state: { leadId: string | null; phone: string | null; websiteId: string | null; subscriptionId: string | null; has0144: boolean } = {
    leadId: null,
    phone: null,
    websiteId: null,
    subscriptionId: null,
    has0144: false,
  };

  before(async () => {
    await configureBusiness({
      name: "Northlight Studio",
      archetype: "CREATIVE_WEB_STUDIO",
      motions: ["BOOK_MEETING_B2B"],
      industryCode: "62.01",
      salesModel: "AGENCY",
      bookingMode: "google_calendar",
      services: [
        { name: "Website rebuild", averageValue: 9000, publicPrice: "from £6,000" },
        { name: "Growth subscription", averageValue: 1200, publicPrice: "£100 per month" },
      ],
      questions: [{ text: "What would you like the new site to do for the business?", type: "text", required: false }],
    });
    const w = H.mustWorld();
    const { data: services } = await admin.from("services").select("id, name").eq("business_id", w.businessId).eq("active", true);
    state.websiteId = (services ?? []).find((s) => s.name === "Website rebuild")?.id ?? null;
    state.subscriptionId = (services ?? []).find((s) => s.name === "Growth subscription")?.id ?? null;
    await H.must(
      admin
        .from("services")
        .update({ offer_profile: { motion: "SAAS_SELF_SERVE", goal: "D_SIGNUP_TRIAL", checkoutLinkId: "growth-monthly" } })
        .eq("id", state.subscriptionId!),
      "subscription offer profile",
    );
    await H.must(
      admin.from("commercial_authority").upsert(
        {
          business_id: w.businessId,
          enabled: true,
          approved_checkout_links: [
            { id: "growth-monthly", label: "Growth monthly", product: "Growth subscription", url: LINK_URL, price_text: "£100 per month", currency: "GBP" },
          ],
          max_discount_percent: 0,
          requires_human_above_value_minor: null,
          updated_by: w.ownerId,
        },
        { onConflict: "business_id" },
      ),
      "authority",
    );
    await connect("google_calendar", { config: { calendarId: "primary" } });
    const probe = await admin.from("opportunities").select("service_id").limit(1);
    state.has0144 = !probe.error;
    H.scriptAi(severalAi);
    H.signInAsOwner();
  });

  after(async () => {
    H.scriptAi(null);
    await disconnect("google_calendar").catch(() => undefined);
    await admin.from("commercial_authority").update({ enabled: false }).eq("business_id", H.mustWorld().businessId);
  });

  test("S1 the subscription closes first: its own checkout link; both interests recorded", async () => {
    await check(
      {
        id: "S1",
        flow: "Several interests (engine LIVE)",
        scenario: "form lead on Website rebuild also asks to sign up for the Growth subscription",
        expected: "coordinator picks Growth subscription (CTA_SIGNUP); the growth-monthly link is sent; one question at most; an interest recorded for each service",
      },
      async () => {
        const { ingestLead } = await import("../../src/lib/ingest/service.ts");
        const person = { email: H.testEmail("sasha.interests"), phone: H.dramaPhone() };
        const lead = await ingestLead({
          businessId: H.mustWorld().businessId,
          serviceId: state.websiteId!,
          source: { type: "AD_FORM", provider: "meta", providerRecordId: `s-${RUN}-sasha`, formId: "FORM_S", caller: { type: "SYSTEM", id: "story" }, submittedAt: new Date().toISOString() },
          person: { firstName: "Sasha", lastName: "Story", email: person.email, phone: person.phone, companyName: "Sasha Ltd", postcode: "LS6 2AB" },
        });
        await H.runJobs();
        state.leadId = lead.leadId as string;
        state.phone = person.phone;
        const t = await H.leadSays(
          person.phone,
          "Hi, we're a team of 12. We need a website rebuild before our launch in March, and we'd also like to sign up for the Growth subscription to handle our monthly SEO reporting.",
        );
        const run = (await runsFor(state.leadId)).slice(-1)[0];
        const focus = focusOf(run);
        assert.equal(focus?.primary?.serviceName, "Growth subscription", `focus ${JSON.stringify(focus)}; run ${run?.outcome}/${run?.error_code}`);
        assert.ok(t.replies.some((r) => r.includes("shop.example.invalid/checkout/growth-monthly")), `no checkout link: ${JSON.stringify(t.replies)}; run ${JSON.stringify(run?.decision_json).slice(0, 600)}`);
        for (const r of t.replies) assert.ok(H.questionMarks(r) <= 1, `two questions: ${r}`);
        const { data: facts } = await admin
          .from("lead_qualification_facts")
          .select("service_id, source_ref")
          .eq("lead_id", state.leadId)
          .eq("dimension", "SERVICE_NEEDED")
          .is("superseded_at", null);
        assert.ok((facts ?? []).some((f) => f.service_id === state.subscriptionId && String(f.source_ref).includes("#interest")), `no subscription interest: ${JSON.stringify(facts)}`);
        let opps = "pending 0144";
        if (state.has0144) {
          const { data } = await admin.from("opportunities").select("service_id, stage, outcome, goal").eq("lead_id", state.leadId);
          const sub = (data ?? []).find((o) => o.service_id === state.subscriptionId);
          const web = (data ?? []).find((o) => o.service_id === state.websiteId);
          assert.ok(sub && web, `one opportunity per interest expected: ${JSON.stringify(data)}`);
          assert.equal(sub!.stage, "CHECKOUT_SENT");
          opps = `subscription ${sub!.stage}/${sub!.goal}, website ${web!.stage}/${web!.goal}`;
        }
        return `focus ${focus?.primary?.serviceName} ${focus?.primary?.action}${focus?.companion ? ` + ${focus.companion.kind}` : ""}; reply "${t.replies[0]?.slice(0, 90)}"; opportunities: ${opps}`;
      },
    );
  });

  test("S2 winning the subscription does not close the website interest", async () => {
    await check(
      {
        id: "S2",
        flow: "Close one interest",
        scenario: "the subscription is paid and closed WON",
        expected: "the website opportunity stays OPEN, the lead is not WON and its follow-up carries on (0144)",
      },
      async () => {
        if (!state.has0144) return "pending 0144: the per-interest close needs the migration's close_opportunity; not exercised";
        const { data } = await admin.from("opportunities").select("id, service_id").eq("lead_id", state.leadId!).eq("outcome", "OPEN");
        const sub = (data ?? []).find((o) => o.service_id === state.subscriptionId);
        assert.ok(sub, "no open subscription opportunity");
        const { closeOpportunity } = await import("../../src/lib/opportunities/service.ts");
        const closed = await closeOpportunity({ businessId: H.mustWorld().businessId, opportunityId: sub!.id, outcome: "WON", reason: "Paid for the Growth subscription (story)." });
        const lead = await H.leadRow(state.leadId!);
        assert.notEqual(lead.status, "WON", `lead closed while the website is open (${closed.leadStatus})`);
        const { data: still } = await admin.from("opportunities").select("service_id, outcome").eq("lead_id", state.leadId!).eq("outcome", "OPEN");
        assert.ok((still ?? []).some((o) => o.service_id === state.websiteId), "website interest closed too");
        const { data: row } = await admin.from("leads").select("automation_active, won_at").eq("id", state.leadId!).single();
        return `subscription WON; lead ${lead.status} (won_at ${row?.won_at ? "stamped" : "empty"}); website OPEN; automation_active ${row?.automation_active}`;
      },
    );
  });

  test("S3 the website meeting is booked, and no shared fact was asked twice (or at all once known)", async () => {
    await check(
      {
        id: "S3",
        flow: "Book the other interest",
        scenario: "lead asks to book a call about the website, then picks a slot",
        expected: "coordinator picks Website rebuild (CTA_BOOK); slots offered; the chosen slot booked; TEAM_SIZE / COMPANY_SIZE / TIMING never asked",
      },
      async () => {
        const t1 = await H.leadSays(state.phone!, "For the website, can we book a call to talk it through?");
        const runs = await runsFor(state.leadId!);
        const last = runs.slice(-1)[0];
        const focus = focusOf(last);
        assert.equal(focus?.primary?.serviceName, "Website rebuild", `focus ${JSON.stringify(focus)}; replies ${JSON.stringify(t1.replies)}`);
        const offered = (last?.decision_json as { offeredSlots?: { label: string }[] }).offeredSlots ?? [];
        assert.ok(offered.length > 0, `no slots; replies=${JSON.stringify(t1.replies)}; run ${last?.outcome}/${last?.error_code} ${JSON.stringify(last?.decision_json).slice(0, 700)}`);
        const t2 = await H.leadSays(state.phone!, `${offered[0].label.split(",").pop()!.trim()} please`);
        const { data: bookings } = await admin.from("bookings").select("status").eq("lead_id", state.leadId!);
        assert.equal(bookings?.length, 1, `bookings=${JSON.stringify(bookings)}; replies=${JSON.stringify(t2.replies)}`);
        const asked = askedDims(await runsFor(state.leadId!));
        for (const dim of SHARED) assert.ok(!asked.includes(dim), `shared fact ${dim} asked: ${asked.join(",")}`);
        let opp = "pending 0144";
        if (state.has0144) {
          const { data } = await admin.from("opportunities").select("service_id, stage, outcome").eq("lead_id", state.leadId!);
          const web = (data ?? []).find((o) => o.service_id === state.websiteId && o.outcome === "OPEN");
          assert.equal(web?.stage, "MEETING_BOOKED", JSON.stringify(data));
          opp = `website ${web?.stage}`;
        }
        return `focus ${focus?.primary?.serviceName} ${focus?.primary?.action}; slots ${offered.length}; booking ${bookings![0].status}; questions asked: ${asked.join(",") || "none"}; ${opp}`;
      },
    );
  });
});
