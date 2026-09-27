/**
 * Intent-driven, frequency-safe, cost-aware, measured re-engagement.
 * Pure: every module here loads without a database.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planDeadlineCheckIn,
  planNoShow,
  planNotNowResume,
  planWinBack,
  reengagementSendKey,
  statedDateOf,
  triggerOfSendKey,
  triggerSkipReason,
  WIN_BACK_DELAY_DAYS,
  type TriggerState,
} from "../src/lib/reengagement/triggers.ts";
import {
  classifyTouch,
  clampFrequencyCaps,
  DEFAULT_FREQUENCY_CAPS,
  evaluateFrequency,
  inEnquiryWindow,
  isDeadLead,
  touchesSinceEngagement,
} from "../src/lib/reengagement/frequency.ts";
import { bestSendTime, localParts, pickSendHour, nextSendSlot } from "../src/lib/reengagement/send-time.ts";
import { attributeOutcome, computeLoopOutcomes } from "../src/lib/reengagement/outcomes.ts";
import { reengagementCopy } from "../src/lib/reengagement/templates.ts";
import { chooseCostAwareChannel, parseCampaignChannelMode } from "../src/lib/follow-up/channel-strategy.ts";
import { chooseReengagementChannel } from "../src/lib/agents/policy.ts";
import { assignArm, HOLDOUT_ARM, reactivationArmReport, variantTemplate } from "../src/lib/learning/experiments.ts";
import { evaluateSend, type SendGuardSnapshot } from "../src/lib/jobs/send-core.ts";

const H = 3_600_000;
const D = 24 * H;
const at = (iso: string) => new Date(iso);

/* ------------------------------------------------------------- triggers */

describe("trigger scheduling", () => {
  test("NOT_NOW: the check-in is due just after resume_at, and a retracted signal plans nothing", () => {
    const plan = planNotNowResume({ id: "s1", type: "NOT_NOW", resume_at: "2027-03-01T09:00:00.000Z" });
    assert.ok(plan);
    assert.equal(plan.trigger, "NOT_NOW_RESUME");
    assert.equal(plan.dueAt.toISOString(), "2027-03-01T09:30:00.000Z");
    assert.equal(plan.optimiseSendTime, true);
    assert.ok(plan.expiresAt > plan.dueAt);
    assert.equal(planNotNowResume({ id: "s1", type: "NOT_NOW", resume_at: "2027-03-01T09:00:00Z", retracted_at: "2026-10-01T00:00:00Z" }), null);
    assert.equal(planNotNowResume({ id: "s1", type: "NOT_NOW", resume_at: null }), null);
    assert.equal(planNotNowResume({ id: "s1", type: "TIMEFRAME", resume_at: "2027-03-01T09:00:00Z" }), null);
  });

  test("TIMEFRAME: stated date = flat_until - 7d; check-in the day after it; a past date is not a deadline", () => {
    const signal = { id: "t1", type: "TIMEFRAME", flat_until: "2026-12-08T00:00:00.000Z", observed_at: "2026-09-27T10:00:00.000Z" };
    assert.equal(statedDateOf(signal)?.toISOString(), "2026-12-01T00:00:00.000Z");
    const plan = planDeadlineCheckIn(signal);
    assert.equal(plan?.trigger, "DEADLINE_PASSED");
    assert.equal(plan?.dueAt.toISOString(), "2026-12-02T00:00:00.000Z");
    assert.equal(planDeadlineCheckIn({ ...signal, observed_at: "2026-12-05T00:00:00.000Z" }), null);
  });

  test("no-show: rebook within the hour, nudge at 24h, neither moved to a best hour", () => {
    const [rebook, nudge] = planNoShow({ id: "b1", noShowAt: "2026-09-28T10:00:00.000Z" });
    assert.equal(rebook.trigger, "NO_SHOW_REBOOK");
    assert.ok(rebook.dueAt.getTime() - Date.parse("2026-09-28T10:00:00.000Z") <= H);
    assert.equal(nudge.trigger, "NO_SHOW_NUDGE");
    assert.equal(nudge.dueAt.toISOString(), "2026-09-29T10:00:00.000Z");
    assert.equal(rebook.optimiseSendTime, false);
    assert.equal(nudge.optimiseSendTime, false);
    assert.deepEqual(planNoShow({ id: "b1", noShowAt: null }), []);
  });

  test("win-back delay is chosen by the loss reason", () => {
    const now = at("2026-09-27T12:00:00Z");
    const lostAt = "2026-09-20T12:00:00.000Z";
    const price = planWinBack({ reason: "[Price] chose a cheaper supplier", lostAt, now });
    assert.equal(price.action, "schedule");
    if (price.action === "schedule") {
      assert.ok(price.delayDays >= 60 && price.delayDays <= 90);
      assert.equal(price.dueAt.getTime(), Date.parse(lostAt) + price.delayDays * D);
    }
    const competitor = planWinBack({ reason: "[Competitor] went elsewhere", lostAt, now });
    assert.ok(competitor.action === "schedule" && competitor.delayDays >= 90 && competitor.delayDays <= 180);
    const timing = planWinBack({ reason: "[Timing] next year", lostAt, now, statedResumeAt: at("2027-01-15T09:00:00Z") });
    assert.ok(timing.action === "schedule" && timing.dueAt.toISOString() === "2027-01-15T09:00:00.000Z");
    const timingNoDate = planWinBack({ reason: "[Timing] later", lostAt, now });
    assert.ok(timingNoDate.action === "schedule" && timingNoDate.delayDays === WIN_BACK_DELAY_DAYS.Timing);
    // Inferred from untagged text.
    const inferred = planWinBack({ reason: "Budget was too tight this year", lostAt, now });
    assert.ok(inferred.action === "schedule" && inferred.category === "Price");
  });

  test("win-back is skipped for not-a-fit, do-not-contact, unknown and old losses", () => {
    const now = at("2026-09-27T12:00:00Z");
    const lostAt = "2026-09-20T12:00:00.000Z";
    assert.deepEqual(planWinBack({ reason: "[No need] they no longer need this", lostAt, now }), { action: "skip", reason: "not_a_fit" });
    assert.deepEqual(planWinBack({ reason: "[Price] asked not to be contacted again", lostAt, now }), { action: "skip", reason: "do_not_contact" });
    assert.deepEqual(planWinBack({ reason: "Not a fit for us", lostAt, now }), { action: "skip", reason: "do_not_contact" });
    assert.deepEqual(planWinBack({ reason: "[Other] misc", lostAt, now }), { action: "skip", reason: "unknown_reason" });
    assert.deepEqual(planWinBack({ reason: "[Price] x", lostAt: "2024-01-01T00:00:00Z", now }), { action: "skip", reason: "too_old" });
  });

  test("send keys carry the trigger", () => {
    assert.equal(triggerOfSendKey(reengagementSendKey("WIN_BACK", "abc")), "WIN_BACK");
    assert.equal(triggerOfSendKey("booking-reminder:x"), null);
    assert.equal(triggerOfSendKey("reengage:BOGUS:x"), null);
  });

  const base = (patch: Partial<TriggerState> = {}): TriggerState => ({
    trigger: "NOT_NOW_RESUME",
    now: at("2027-03-01T10:00:00Z"),
    expiresAt: at("2027-03-15T10:00:00Z"),
    enabled: true,
    lead: { status: "CONTACTED", optedOut: false, humanTakeover: false, automationActive: true, archived: false, anonymised: false, isTest: false },
    repliedSinceSource: false,
    bookedSinceSource: false,
    sourceCurrent: true,
    ...patch,
  });

  test("every stop condition cancels a trigger", () => {
    assert.equal(triggerSkipReason(base()), null);
    assert.equal(triggerSkipReason(base({ enabled: false })), "disabled");
    assert.equal(triggerSkipReason(base({ lead: null })), "lead_removed");
    assert.equal(triggerSkipReason(base({ lead: { ...base().lead!, optedOut: true } })), "opted_out");
    assert.equal(triggerSkipReason(base({ lead: { ...base().lead!, humanTakeover: true } })), "human_takeover");
    assert.equal(triggerSkipReason(base({ lead: { ...base().lead!, status: "WON" } })), "won");
    assert.equal(triggerSkipReason(base({ lead: { ...base().lead!, status: "LOST" } })), "lost");
    assert.equal(triggerSkipReason(base({ lead: { ...base().lead!, status: "BOOKED" } })), "booked");
    assert.equal(triggerSkipReason(base({ lead: { ...base().lead!, automationActive: false } })), "paused");
    assert.equal(triggerSkipReason(base({ repliedSinceSource: true })), "replied");
    assert.equal(triggerSkipReason(base({ sourceCurrent: false })), "superseded");
    assert.equal(triggerSkipReason(base({ now: at("2027-04-01T00:00:00Z") })), "expired");
  });

  test("no-show survives BOOKED (the missed meeting) but not a new booking; win-back needs LOST", () => {
    const booked = { ...base().lead!, status: "BOOKED" };
    assert.equal(triggerSkipReason(base({ trigger: "NO_SHOW_REBOOK", lead: booked })), null);
    assert.equal(triggerSkipReason(base({ trigger: "NO_SHOW_REBOOK", lead: booked, bookedSinceSource: true })), "rebooked");
    const lost = { ...base().lead!, status: "LOST", automationActive: false };
    assert.equal(triggerSkipReason(base({ trigger: "WIN_BACK", lead: lost })), null);
    assert.equal(triggerSkipReason(base({ trigger: "WIN_BACK", lead: { ...lost, status: "CONTACTED" } })), "reopened");
    assert.equal(triggerSkipReason(base({ trigger: "WIN_BACK", lead: { ...lost, optedOut: true } })), "opted_out");
  });
});

/* ----------------------------------------------------- the send guard */

describe("send guard exemptions for re-engagement messages", () => {
  const snap = (patch: Partial<SendGuardSnapshot>): SendGuardSnapshot => ({
    lead: { status: "CONTACTED", optedOut: false, humanTakeover: false, automationActive: true, hasReplied: true },
    channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false },
    quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
    origin: "automation",
    ...patch,
  });
  test("a plain automation step stops on reply; a NOT_NOW check-in does not", () => {
    assert.deepEqual(evaluateSend(snap({})), { action: "abort", reason: "replied" });
    assert.deepEqual(evaluateSend(snap({ reengagement: "NOT_NOW_RESUME" })), { action: "send" });
  });
  test("win-back reaches a LOST, paused lead; opt-out, takeover, WON and suppression still bind", () => {
    const lost = { status: "LOST", optedOut: false, humanTakeover: false, automationActive: false, hasReplied: true };
    assert.deepEqual(evaluateSend(snap({ lead: lost, reengagement: "WIN_BACK" })), { action: "send" });
    assert.equal(evaluateSend(snap({ lead: lost })).action, "abort");
    assert.deepEqual(evaluateSend(snap({ lead: { ...lost, optedOut: true }, reengagement: "WIN_BACK" })), { action: "abort", reason: "opted_out" });
    assert.deepEqual(evaluateSend(snap({ lead: { ...lost, humanTakeover: true }, reengagement: "WIN_BACK" })), { action: "abort", reason: "human_takeover" });
    assert.deepEqual(evaluateSend(snap({ lead: { ...lost, status: "WON" }, reengagement: "WIN_BACK" })), { action: "abort", reason: "won" });
    assert.deepEqual(
      evaluateSend(snap({ lead: lost, reengagement: "WIN_BACK", channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: true } })),
      { action: "abort", reason: "suppressed" },
    );
  });
  test("no-show messages pass the BOOKED stop but a paused lead stays paused; quiet hours still defer", () => {
    const booked = { status: "BOOKED", optedOut: false, humanTakeover: false, automationActive: true, hasReplied: false };
    assert.deepEqual(evaluateSend(snap({ lead: booked, reengagement: "NO_SHOW_REBOOK" })), { action: "send" });
    assert.deepEqual(evaluateSend(snap({ lead: { ...booked, automationActive: false }, reengagement: "NO_SHOW_REBOOK" })), { action: "abort", reason: "paused" });
    const quiet = { enabled: true, start: "00:00", end: "23:59", timezone: "UTC" };
    assert.equal(evaluateSend(snap({ lead: booked, reengagement: "NO_SHOW_REBOOK", quietHours: quiet }), at("2026-09-28T12:00:00Z")).action, "reschedule");
  });
  test("the exemption is honoured for automation origin only", () => {
    const lost = { status: "LOST", optedOut: false, humanTakeover: false, automationActive: true, hasReplied: false };
    assert.equal(evaluateSend(snap({ origin: "campaign", lead: lost, reengagement: "WIN_BACK" })).action, "abort");
  });
});

/* ------------------------------------------------- the frequency guard */

describe("contact-frequency guard", () => {
  const now = at("2026-09-27T12:00:00Z");
  const caps = DEFAULT_FREQUENCY_CAPS;
  const run = (sent: string[], patch: Partial<Parameters<typeof evaluateFrequency>[0]> = {}) =>
    evaluateFrequency({ now, automatedSentAt: sent, caps, touchesSinceEngagement: 0, intentState: "MEDIUM", ...patch });

  test("defaults are 1/day, 3/week, 6/30 days, dead after 4", () => {
    assert.deepEqual(caps, { perDay: 1, perWeek: 3, per30Days: 6, deadAfter: 4 });
  });
  test("nothing sent: allowed", () => assert.deepEqual(run([]), { action: "allow" }));
  test("one touch in the last 24h: deferred until the day frees", () => {
    const verdict = run([new Date(now.getTime() - 3 * H).toISOString()]);
    assert.equal(verdict.action, "defer");
    if (verdict.action === "defer") {
      assert.equal(verdict.reason, "daily_cap");
      assert.equal(verdict.at.getTime(), now.getTime() + 21 * H);
    }
  });
  test("three in the week: skipped with a reason", () => {
    const verdict = run([1.5, 2, 3].map((d) => new Date(now.getTime() - d * D).toISOString()));
    assert.equal(verdict.action, "skip");
    if (verdict.action === "skip") assert.equal(verdict.reason, "weekly_cap");
  });
  test("a week that frees within 48h defers instead", () => {
    const verdict = run([2, 4, 6.5].map((d) => new Date(now.getTime() - d * D).toISOString()));
    assert.equal(verdict.action, "defer");
  });
  test("six in 30 days: skipped (monthly)", () => {
    const verdict = run([8, 10, 12, 15, 20, 25].map((d) => new Date(now.getTime() - d * D).toISOString()));
    assert.ok(verdict.action === "skip" && verdict.reason === "monthly_cap");
  });
  test("the enquiry window lifts the day and week caps for the enquiry's own sequence only", () => {
    const recent = [new Date(now.getTime() - 10 * 60_000).toISOString()];
    assert.equal(run(recent, { inEnquiryWindow: true }).action, "allow");
    assert.equal(inEnquiryWindow({ loop: "sequence", leadCreatedAt: new Date(now.getTime() - H).toISOString(), now }), true);
    assert.equal(inEnquiryWindow({ loop: "campaign", leadCreatedAt: new Date(now.getTime() - H).toISOString(), now }), false);
    assert.equal(inEnquiryWindow({ loop: "sequence", leadCreatedAt: new Date(now.getTime() - 4 * D).toISOString(), now }), false);
  });
  test("caps clamp to safe bounds and stay consistent", () => {
    assert.deepEqual(clampFrequencyCaps({ perDay: 99, perWeek: 0, per30Days: -1, deadAfter: 1 }), { perDay: 3, perWeek: 3, per30Days: 3, deadAfter: 2 });
    assert.deepEqual(clampFrequencyCaps(null), DEFAULT_FREQUENCY_CAPS);
  });
  test("classification: replies, manual, system and reminders are exempt; loops are named", () => {
    assert.equal(classifyTouch({ origin: "manual", sendKey: "m" }).automated, false);
    assert.equal(classifyTouch({ origin: "system", sendKey: "s" }).automated, false);
    assert.equal(classifyTouch({ origin: "agent_handover", sendKey: "x" }).automated, false);
    assert.equal(classifyTouch({ origin: "automation", sendKey: "booking-reminder:1" }).automated, false);
    assert.equal(classifyTouch({ origin: "agent", sendKey: "agent:1", agentTriggerIsReply: true }).automated, false);
    assert.equal(classifyTouch({ origin: "agent", sendKey: "agent:1", agentTriggerIsReply: null }).automated, false);
    assert.deepEqual(classifyTouch({ origin: "agent", sendKey: "agent:1", agentTriggerIsReply: false, agentRunKey: "reengage:NOT_NOW_RESUME:s" }), { automated: true, loop: "not_now_resume" });
    assert.deepEqual(classifyTouch({ origin: "agent", sendKey: "agent:1", agentTriggerIsReply: false, agentRunKey: "checkout-nudge:a:1" }), { automated: true, loop: "checkout_nudge" });
    assert.deepEqual(classifyTouch({ origin: "automation", sendKey: "step:1" }), { automated: true, loop: "sequence" });
    assert.deepEqual(classifyTouch({ origin: "automation", sendKey: "reengage:WIN_BACK:o" }), { automated: true, loop: "win_back" });
    assert.deepEqual(classifyTouch({ origin: "campaign", sendKey: "campaign:c:1" }), { automated: true, loop: "campaign" });
    assert.deepEqual(classifyTouch({ origin: "campaign", sendKey: "campaign:c:1", agentDraftedCampaign: true }), { automated: true, loop: "reengage_agent" });
  });
  test("the send gate calls the guard before billing, and the checkout nudge hook is exported", () => {
    const store = readFileSync(new URL("../src/lib/jobs/handlers/send-store.ts", import.meta.url), "utf8");
    assert.ok(store.indexOf("frequencyGateForMessage(") < store.indexOf("billingSendGate({"));
    const service = readFileSync(new URL("../src/lib/reengagement/service.ts", import.meta.url), "utf8");
    assert.match(service, /export async function checkAutomatedTouchAllowed/);
  });
});

describe("dead-lead rule", () => {
  test("stops after N unanswered touches at LOW intent or below", () => {
    assert.equal(isDeadLead({ touchesSinceEngagement: 4, intentState: "LOW", deadAfter: 4 }), true);
    assert.equal(isDeadLead({ touchesSinceEngagement: 4, intentState: null, deadAfter: 4 }), true);
    assert.equal(isDeadLead({ touchesSinceEngagement: 3, intentState: "LOW", deadAfter: 4 }), false);
    assert.equal(isDeadLead({ touchesSinceEngagement: 9, intentState: "MEDIUM", deadAfter: 4 }), false);
    assert.equal(isDeadLead({ touchesSinceEngagement: 9, intentState: "EXPLORATORY", deadAfter: 4 }), false);
  });
  test("engagement (a reply or an open) restarts the count", () => {
    const sent = ["2026-09-01T10:00:00Z", "2026-09-05T10:00:00Z", "2026-09-10T10:00:00Z", "2026-09-15T10:00:00Z"];
    assert.equal(touchesSinceEngagement({ automatedSentAt: sent, lastEngagedAt: null }), 4);
    assert.equal(touchesSinceEngagement({ automatedSentAt: sent, lastEngagedAt: "2026-09-06T00:00:00Z" }), 2);
  });
  test("the guard skips a dead lead first, even inside the caps", () => {
    const verdict = evaluateFrequency({ now: new Date(), automatedSentAt: [], caps: DEFAULT_FREQUENCY_CAPS, touchesSinceEngagement: 4, intentState: "LOW" });
    assert.ok(verdict.action === "skip" && verdict.reason === "dead_lead");
  });
});

/* ------------------------------------------------------ channel choice */

describe("cheapest channel first", () => {
  const all = { sms: true, email: true };
  test("an unengaged lead gets email; SMS only when email is unusable", () => {
    assert.equal(chooseCostAwareChannel({ engaged: false, available: all, leadHas: all }), "email");
    assert.equal(chooseCostAwareChannel({ engaged: false, available: all, leadHas: { sms: true, email: false } }), "sms");
    assert.equal(chooseCostAwareChannel({ engaged: false, available: { sms: true, email: false }, leadHas: all }), "sms");
    assert.equal(chooseCostAwareChannel({ engaged: false, available: { sms: false, email: false }, leadHas: all }), null);
  });
  test("an engaged lead stays on their channel", () => {
    assert.equal(chooseCostAwareChannel({ engaged: true, available: all, leadHas: all }), "sms");
    assert.equal(chooseCostAwareChannel({ engaged: true, preferred: "email", available: all, leadHas: all }), "email");
    assert.equal(chooseCostAwareChannel({ engaged: true, preferred: "sms", available: all, leadHas: { sms: false, email: true } }), "email");
  });
  test("force SMS, and campaign channel modes", () => {
    assert.equal(chooseCostAwareChannel({ engaged: false, forceSms: true, available: all, leadHas: all }), "sms");
    assert.equal(parseCampaignChannelMode("cost_aware"), "cost_aware");
    assert.equal(parseCampaignChannelMode(undefined), "sms");
  });
  test("the re-engagement agent reuses the rule", () => {
    assert.equal(chooseReengagementChannel({ mailbox: true, sms: true }), "email");
    assert.equal(chooseReengagementChannel({ mailbox: false, sms: true }), "sms");
    assert.equal(chooseReengagementChannel({ mailbox: false, sms: false }), null);
  });
});

/* ------------------------------------------------------------ send time */

describe("best send time", () => {
  const tz = "Europe/London";
  const quiet = { enabled: true, start: "20:00", end: "08:00", timezone: tz };
  test("the lead's own reply hour wins, then the workspace's, then Tue-Thu 10:00", () => {
    const lead = ["2026-09-01T13:05:00Z", "2026-09-08T13:40:00Z", "2026-09-10T08:00:00Z"]; // 14:xx BST twice
    assert.deepEqual(pickSendHour({ leadReplies: lead, workspaceHistogram: null, timeZone: tz }), { hour: 14, source: "lead" });
    const workspace = new Array(24).fill(0);
    workspace[11] = 25;
    assert.deepEqual(pickSendHour({ leadReplies: [], workspaceHistogram: workspace, timeZone: tz }), { hour: 11, source: "workspace" });
    assert.deepEqual(pickSendHour({ leadReplies: [], workspaceHistogram: [1, 2], timeZone: tz }), { hour: 10, source: "default" });
  });
  test("a late-night reply hour is kept inside the working day", () => {
    const lead = ["2026-09-01T22:00:00Z", "2026-09-02T22:10:00Z"];
    assert.equal(pickSendHour({ leadReplies: lead, workspaceHistogram: null, timeZone: tz }).hour, 18);
  });
  test("the default lands on Tue-Thu at 10:00 local, never before notBefore", () => {
    const notBefore = at("2026-09-26T09:00:00Z"); // Saturday
    const slot = nextSendSlot({ notBefore, hour: 10, source: "default", timeZone: tz, quietHours: quiet });
    const parts = localParts(slot, tz);
    assert.ok([2, 3, 4].includes(parts.dow));
    assert.equal(parts.hour, 10);
    assert.ok(slot >= notBefore);
  });
  test("bestSendTime is never earlier than notBefore and never in quiet hours", () => {
    const notBefore = at("2026-09-29T15:00:00Z");
    const result = bestSendTime({ notBefore, leadReplies: [], workspaceHistogram: null, timeZone: tz, quietHours: quiet });
    assert.ok(result.at >= notBefore);
    const hour = localParts(result.at, tz).hour;
    assert.ok(hour >= 8 && hour < 20);
  });
});

/* ------------------------------------------------ experiment assignment */

describe("reactivation experiment arms", () => {
  const experiment = {
    id: "exp-1",
    holdoutPercent: 10,
    variants: [
      { key: "A", label: "Control" },
      { key: "B", label: "B", templates: { "0": "Hi {{first_name}}, variant B", "1": "B follow-up" } },
    ],
  };
  test("assignment is deterministic and roughly balanced, with a holdout", () => {
    const leads = Array.from({ length: 4000 }, (_, i) => `lead-${i}`);
    const arms = leads.map((lead) => assignArm(experiment, lead));
    assert.deepEqual(leads.map((lead) => assignArm(experiment, lead)), arms);
    const count = (arm: string) => arms.filter((a) => a === arm).length;
    assert.ok(count(HOLDOUT_ARM) > 250 && count(HOLDOUT_ARM) < 550);
    assert.ok(Math.abs(count("A") - count("B")) < 400);
  });
  test("variant copy per stage; control uses the campaign's own", () => {
    assert.equal(variantTemplate(experiment, "B", 0), "Hi {{first_name}}, variant B");
    assert.equal(variantTemplate(experiment, "B", 1), "B follow-up");
    assert.equal(variantTemplate(experiment, "A", 0), null);
  });
  test("the report says not enough data until every arm has 100 leads, and never ranks on replies", () => {
    const small = reactivationArmReport({
      variants: experiment.variants,
      metric: "BOOKING",
      minSamplePerArm: 100,
      counts: [
        { arm: "A", leads: 60, meetings: 1, sales: 0, salesValue: 0, optOuts: 0, replies: 40 },
        { arm: "B", leads: 60, meetings: 9, sales: 1, salesValue: 500, optOuts: 0, replies: 2 },
      ],
    });
    assert.equal(small.result.verdict, "NOT_ENOUGH_DATA");
    assert.ok(small.rows.every((row) => !row.enoughData));
    const big = reactivationArmReport({
      variants: experiment.variants,
      metric: "BOOKING",
      minSamplePerArm: 100,
      counts: [
        { arm: "A", leads: 400, meetings: 8, sales: 0, salesValue: 0, optOuts: 2, replies: 200 },
        { arm: "B", leads: 400, meetings: 40, sales: 5, salesValue: 5000, optOuts: 2, replies: 20 },
        { arm: HOLDOUT_ARM, leads: 80, meetings: 1, sales: 0, salesValue: 0, optOuts: 0, replies: 0 },
      ],
    });
    assert.equal(big.result.winner, "B");
    assert.equal(big.rows[big.rows.length - 1].arm, HOLDOUT_ARM);
  });
});

/* ------------------------------------------------------ outcome metrics */

describe("per-loop outcome metrics", () => {
  test("last-touch attribution inside the window", () => {
    const touches = [
      { loop: "sequence" as const, sentAt: "2026-09-01T10:00:00Z" },
      { loop: "win_back" as const, sentAt: "2026-09-10T10:00:00Z" },
    ];
    assert.equal(attributeOutcome(touches, "2026-09-05T10:00:00Z"), "sequence");
    assert.equal(attributeOutcome(touches, "2026-09-12T10:00:00Z"), "win_back");
    assert.equal(attributeOutcome(touches, "2026-08-01T10:00:00Z"), null);
    assert.equal(attributeOutcome(touches, "2026-12-01T10:00:00Z"), null);
  });
  test("meetings, sales, value, opt-outs, cost; ranked by outcomes, not replies", () => {
    const outcomes = computeLoopOutcomes({
      touches: [
        { loop: "campaign", leadId: "a", sentAt: "2026-09-01T10:00:00Z", channel: "sms", smsSegments: 2, tokens: 0 },
        { loop: "campaign", leadId: "b", sentAt: "2026-09-01T10:00:00Z", channel: "sms", smsSegments: 1, tokens: 0 },
        { loop: "win_back", leadId: "c", sentAt: "2026-09-02T10:00:00Z", channel: "email", smsSegments: 0, tokens: 1200, complained: true },
      ],
      leads: [
        { leadId: "a", bookedAt: [], won: [], inbound: [{ at: "2026-09-01T11:00:00Z", classification: "POSITIVE_INTEREST" }] },
        { leadId: "b", bookedAt: [], won: [], inbound: [{ at: "2026-09-01T12:00:00Z", classification: "UNSUBSCRIBE" }, { at: "2026-09-01T12:05:00Z", classification: "AUTO_RESPONSE" }] },
        { leadId: "c", bookedAt: ["2026-09-03T10:00:00Z"], won: [{ at: "2026-09-20T10:00:00Z", value: 2500 }], inbound: [] },
      ],
    });
    assert.equal(outcomes[0].loop, "win_back", "the loop that sold ranks first despite a 0% reply rate");
    const winBack = outcomes[0];
    assert.equal(winBack.meetings, 1);
    assert.equal(winBack.sales, 1);
    assert.equal(winBack.salesValue, 2500);
    assert.equal(winBack.complaints, 1);
    assert.equal(winBack.tokens, 1200);
    assert.equal(winBack.replyRate, 0);
    const campaign = outcomes[1];
    assert.equal(campaign.leadsReached, 2);
    assert.equal(campaign.smsSegments, 3);
    assert.equal(campaign.optOuts, 1);
    assert.equal(campaign.replies, 2);
    assert.equal(campaign.replyRate, 1);
  });
});

/* ------------------------------------------------------------ templates */

describe("deterministic copy", () => {
  const values = { firstName: "Sam", businessName: "Northlight", serviceName: "SEO retainer", bookingLink: "https://cal.example/northlight" };
  test("no-show offers only the times it was given, and the booking link", () => {
    const copy = reengagementCopy({ trigger: "NO_SHOW_REBOOK", values, slots: ["Tue 30 Sep, 10:00am", "Wed 1 Oct, 2:00pm"] });
    assert.match(copy.body, /Tue 30 Sep, 10:00am, Wed 1 Oct, 2:00pm/);
    assert.match(copy.body, /cal\.example/);
    const none = reengagementCopy({ trigger: "NO_SHOW_REBOOK", values: { ...values, bookingLink: null } });
    assert.doesNotMatch(none.body, /\d{1,2}:\d{2}/);
  });
  test("a price win-back includes only an approved offer, never a discount", () => {
    const withOffer = reengagementCopy({ trigger: "WIN_BACK", values, lossCategory: "Price", offer: { label: "Starter plan", priceText: "£49 per month", url: "https://pay.example/x" } });
    assert.match(withOffer.body, /Starter plan is £49 per month: https:\/\/pay\.example\/x/);
    const without = reengagementCopy({ trigger: "WIN_BACK", values, lossCategory: "Price" });
    assert.doesNotMatch(without.body, /£|%|discount/i);
  });
});
