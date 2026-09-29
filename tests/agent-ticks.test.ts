/**
 * Background agents, end to end with fakes (background-agent QA, 2026-09-29).
 * Pure: no database, no voice provider, no model, no spend.
 *
 * The closing and re-engagement ticks run as their pure cores
 * (agents/tick-core.ts) over in-memory dependencies that behave like the
 * server wiring in ticks.ts: a queue that keeps one open row per (agent,
 * subject, type), a job queue that dedupes on the idempotency key, a policy
 * service. "Phone leads with AI" runs as its own core (voice-calls.ts
 * runAgentVoiceCalls) FIRST, and its touched leads are handed to the closing
 * tick exactly as the scheduler does (scheduler.ts), so calls versus texts,
 * approvals, caps and "no double contact" are proved on one run.
 *
 * Found by this suite and fixed: a direct-sale or sign-up lead who booked a
 * demo was filed BLOCKED "follow-up has done its job" every run (follow-up
 * stops at a booking); a closing nudge deleted the same lead's open call
 * approval whenever the voice tick had not covered it that run.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  replacesOpenQueueItem,
  runBookingTickCore,
  runReengagementTickCore,
  type AgentRow,
  type BookingTickDeps,
  type QueueInput,
  type ReengagementTickDeps,
  type StalledLead,
} from "../src/lib/agents/tick-core.ts";
import {
  agentCallingScope,
  closingRouteForGoal,
  runAgentVoiceCalls,
  type AgentCallRequestResult,
  type AgentVoiceAgent,
  type AgentVoiceDeps,
  type AgentVoiceEvent,
  type VoiceCandidate,
} from "../src/lib/agents/voice-calls.ts";
import { AgentBlocked, workForType } from "../src/lib/agents/policy.ts";

const NOW = new Date("2026-09-29T10:00:00.000Z");

/* ------------------------------------------------------------------ world */

type QueueRow = { agent_id: string; subject_id: string; item_type: string; status: string; subject_label: string; blocked_reason: string | null; subject_type: string };

class World {
  queue: QueueRow[] = [];
  jobs = new Map<string, { leadId: string }>();
  rearmed: string[] = [];
  policyRefuses = new Map<string, string>();
  calls: { leadId: string; route: string }[] = [];
  events: AgentVoiceEvent[] = [];
  campaigns: { id: string; status: string; size: number; channel: string }[] = [];
  clock = NOW;

  /** The server's upsertQueueItem, by the core's own replacement rule. */
  upsert(agent: AgentRow, item: QueueInput) {
    this.queue = this.queue.filter((row) => !(row.agent_id === agent.id && replacesOpenQueueItem(row, item)));
    this.queue.push({ agent_id: agent.id, subject_id: item.subjectId, item_type: item.itemType, status: item.status, subject_label: item.subjectLabel, blocked_reason: item.blockedReason, subject_type: item.subjectType ?? "LEAD" });
  }

  open(type: string) {
    return this.queue.filter((r) => r.item_type === type && (r.status === "PENDING" || r.status === "BLOCKED"));
  }
}

function lead(id: string, over: Partial<StalledLead> = {}): StalledLead {
  return {
    id,
    first_name: id,
    last_name: null,
    email: `${id}@example.co.uk`,
    phone: "+447700900123",
    opted_out: false,
    last_contact_at: "2026-09-26T09:00:00.000Z",
    automation_active: false,
    status: "QUALIFIED",
    archived_at: null,
    booked_at: null,
    human_takeover: false,
    goal: "B_BOOK_MEETING",
    ...over,
  };
}

function agentRow(over: Partial<AgentRow> = {}): AgentRow {
  return { id: "agent-1", business_id: "biz-1", autonomy: "AUTO", daily_prospect_cap: 25, service_id: null, conversion_goal_id: null, ...over };
}

function bookingDeps(world: World, leads: StalledLead[], detail: string | null = null): BookingTickDeps {
  return {
    now: () => world.clock,
    stalled: async () => ({ candidates: leads.map((l) => ({ id: l.id })), leads, detail }),
    policy: async (_a, l) => (world.policyRefuses.has(l.id) ? { permitted: false, message: world.policyRefuses.get(l.id)! } : { permitted: true, message: "Allowed." }),
    queue: async (a, item) => world.upsert(a, item),
    rearm: async (_a, id) => void world.rearmed.push(id),
    enqueueAdvance: async (_a, id, key) => {
      if (!world.jobs.has(key)) world.jobs.set(key, { leadId: id });
    },
  };
}

/* ----------------------------------------------------------- the closing agent */

describe("closing agent tick: who it picks and what it does", () => {
  test("AUTO hands stalled leads back to follow-up: re-arms a paused automation, queues one advance per lead per day", async () => {
    const w = new World();
    const leads = [lead("amy"), lead("ben", { automation_active: true })];
    const r = await runBookingTickCore(bookingDeps(w, leads), agentRow());
    assert.equal(r.actioned, 2);
    assert.deepEqual(w.rearmed, ["amy"]);
    assert.equal(w.jobs.size, 2);
    assert.deepEqual(w.open("BOOKING"), []);
    assert.deepEqual(w.queue.map((q) => q.status), ["DONE", "DONE"]);
    // A second tick the same day: no second job for either lead.
    await runBookingTickCore(bookingDeps(w, leads), agentRow());
    assert.equal(w.jobs.size, 2);
    // Next day: a new nudge.
    w.clock = new Date("2026-09-30T10:00:00.000Z");
    await runBookingTickCore(bookingDeps(w, leads), agentRow());
    assert.equal(w.jobs.size, 4);
  });

  test("a review level lists leads for a person and changes nothing", async () => {
    for (const autonomy of ["REVIEW_ALL", "REVIEW_NEW"]) {
      const w = new World();
      const r = await runBookingTickCore(bookingDeps(w, [lead("amy")]), agentRow({ autonomy }));
      assert.equal(r.actioned, 1, autonomy);
      assert.equal(w.jobs.size, 0, autonomy);
      assert.deepEqual(w.rearmed, [], autonomy);
      assert.equal(w.open("BOOKING")[0].status, "PENDING", autonomy);
      assert.match(r.detail, /for you to chase/);
    }
  });

  test("stop conditions: a policy refusal, an opt-out, won or lost, archived: BLOCKED with the reason, never nudged", async () => {
    const w = new World();
    w.policyRefuses.set("sup", "This contact is suppressed on email.");
    const leads = [lead("sup"), lead("opt", { opted_out: true }), lead("won", { status: "WON" }), lead("arc", { archived_at: "2026-09-01T00:00:00Z" })];
    const r = await runBookingTickCore(bookingDeps(w, leads), agentRow());
    assert.equal(r.blocked, 4);
    assert.equal(r.actioned, 0);
    assert.equal(w.jobs.size, 0);
    const reasons = Object.fromEntries(w.open("BOOKING").map((q) => [q.subject_id, q.blocked_reason]));
    assert.match(reasons.sup ?? "", /suppressed/);
    assert.match(reasons.opt ?? "", /opted out/);
    assert.match(reasons.won ?? "", /won or lost/);
    assert.match(reasons.arc ?? "", /archived/);
  });

  test("a meeting lead who is booked is done; a sale lead who booked a demo but has not bought is listed for a person, never 'done'", async () => {
    const w = new World();
    const leads = [lead("meet", { status: "BOOKED", goal: "B_BOOK_MEETING" }), lead("sale", { status: "BOOKED", goal: "C_DIRECT_SALE" }), lead("trial", { status: "BOOKED", goal: "D_SIGNUP_TRIAL" })];
    const r = await runBookingTickCore(bookingDeps(w, leads), agentRow());
    const rows = Object.fromEntries(w.open("BOOKING").map((q) => [q.subject_id, q]));
    assert.equal(rows.meet.status, "BLOCKED");
    assert.equal(rows.sale.status, "PENDING");
    assert.match(rows.sale.subject_label, /booked, not bought yet/);
    assert.equal(rows.sale.blocked_reason, null);
    assert.equal(rows.trial.status, "PENDING");
    // Follow-up stops at a booking, so nothing is handed to it.
    assert.equal(w.jobs.size, 0);
    assert.match(r.detail, /2 booked a meeting but have not bought yet/);
  });

  test("the catalogue rule ('none of what this agent sells is left') stops the tick before anything", async () => {
    const w = new World();
    const r = await runBookingTickCore(bookingDeps(w, [lead("amy")], "None of the products or services this agent sells is still in the catalogue."), agentRow());
    assert.equal(r.actioned + r.blocked, 0);
    assert.equal(w.queue.length, 0);
  });

  test("one open row per lead and type across runs; a lead's open call approval is never deleted by a nudge", async () => {
    const w = new World();
    const agent = agentRow({ autonomy: "REVIEW_ALL" });
    // The call approval the voice tick opened for this lead on an earlier run.
    w.queue.push({ agent_id: agent.id, subject_id: "amy", item_type: "REVIEW", status: "BLOCKED", subject_label: "Call amy", blocked_reason: "Waiting for you", subject_type: "LEAD" });
    for (let i = 0; i < 3; i++) await runBookingTickCore(bookingDeps(w, [lead("amy")]), agent);
    assert.equal(w.open("BOOKING").length, 1);
    assert.equal(w.open("REVIEW").length, 1, "the approval survives");
  });
});

/* ------------------------------------------------------- the re-engagement agent */

function reengageDeps(w: World, opts: { ownOpen?: boolean; mailbox?: boolean; sms?: boolean; eligible?: string[] } = {}): ReengagementTickDeps & { audienceChannel: string | null } {
  const deps = {
    audienceChannel: null as string | null,
    ownOpenCampaign: async () => Boolean(opts.ownOpen),
    channels: async () => ({ mailbox: Boolean(opts.mailbox), sms: Boolean(opts.sms) }),
    audience: async (_a: AgentRow, channel: string) => {
      deps.audienceChannel = channel;
      return { matched: (opts.eligible ?? []).length + 3, eligibleLeadIds: opts.eligible ?? [] };
    },
    draftCampaign: async (_a: AgentRow, input: { channel: string; size: number }) => {
      const id = `camp-${w.campaigns.length + 1}`;
      w.campaigns.push({ id, status: "DRAFT", size: input.size, channel: input.channel });
      return id;
    },
    queue: async (a: AgentRow, item: QueueInput) => w.upsert(a, item),
  };
  return deps as never;
}

describe("re-engagement agent tick", () => {
  test("drafts one campaign, capped at the daily limit, on the cheapest connected channel; never launches", async () => {
    const w = new World();
    const eligible = Array.from({ length: 40 }, (_, i) => `q${i}`);
    const deps = reengageDeps(w, { mailbox: true, sms: true, eligible });
    const r = await runReengagementTickCore(deps, agentRow({ daily_prospect_cap: 25, autonomy: "AUTO" }));
    assert.equal(r.actioned, 25);
    assert.equal(deps.audienceChannel, "email");
    assert.deepEqual(w.campaigns.map((c) => [c.status, c.size]), [["DRAFT", 25]]);
    assert.equal(w.open("REENGAGE")[0].subject_type, "CAMPAIGN");
    assert.match(r.detail, /Review and launch it in Reactivation/);
    // The core has no launch path at all (campaign.launch is closed to agents).
    assert.ok(!("launch" in deps));
  });

  test("no double contact: its own open campaign stops a new draft", async () => {
    const w = new World();
    const r = await runReengagementTickCore(reengageDeps(w, { ownOpen: true, mailbox: true, eligible: ["a"] }), agentRow());
    assert.equal(r.actioned, 0);
    assert.equal(w.campaigns.length, 0);
  });

  test("no channel that can send: blocked with the fix; nobody eligible: nothing drafted", async () => {
    const w = new World();
    await assert.rejects(runReengagementTickCore(reengageDeps(w, {}), agentRow()), (e: unknown) => e instanceof AgentBlocked && /Connect a mailbox or Twilio SMS/.test(e.message));
    const r = await runReengagementTickCore(reengageDeps(w, { sms: true, eligible: [] }), agentRow());
    assert.equal(r.actioned, 0);
    assert.equal(w.campaigns.length, 0);
  });
});

/* ------------------------------------------- one scheduled run: calls, then texts */

type CallWorld = {
  world: World;
  voiceUsable: boolean;
  aiMayCall: boolean;
  maintenanceUntil: Date | null;
  callsToday: number;
  approvals: Map<string, boolean>;
  refuse: Map<string, { code: string; message: string }>;
  candidates: VoiceCandidate[];
};

function voiceDeps(cw: CallWorld): AgentVoiceDeps {
  return {
    now: () => NOW,
    maintenancePausedUntil: async () => cw.maintenanceUntil,
    voiceStatus: async () => ({ usable: cw.voiceUsable, reason: cw.voiceUsable ? null : "Voice needs a calling number." }),
    aiMayCall: async () => cw.aiMayCall,
    callsSince: async () => cw.callsToday,
    approvalsSince: async () => [...cw.approvals.values()].filter(Boolean).length,
    requestApproval: async (_a, c) => {
      const existing = cw.approvals.get(c.leadId) === true;
      cw.approvals.set(c.leadId, true);
      if (!existing) cw.world.queue.push({ agent_id: "agent-1", subject_id: c.leadId, item_type: "REVIEW", status: "BLOCKED", subject_label: `Call ${c.label}`, blocked_reason: "Waiting for you", subject_type: "LEAD" });
      return { ok: true, existing };
    },
    candidates: async (_a, work) => cw.candidates.filter((c) => (work === "QUALIFICATION" ? c.route === "QUALIFICATION" : c.route !== "QUALIFICATION")),
    requestCall: async (_a, leadId, route): Promise<AgentCallRequestResult> => {
      const refused = cw.refuse.get(leadId);
      if (refused) return { ok: false, ...refused };
      cw.world.calls.push({ leadId, route });
      return { ok: true, callId: `call-${leadId}`, existing: false, deferredReason: null };
    },
    record: async (_a, event) => void cw.world.events.push(event),
  };
}

function candidate(l: StalledLead, over: Partial<VoiceCandidate> = {}): VoiceCandidate {
  return { leadId: l.id, label: l.id, route: closingRouteForGoal(l.goal), phone: l.phone, optedOut: l.opted_out, humanTakeover: l.human_takeover, openCall: false, calledOnRoute: false, ...over };
}

const voiceAgent = (over: Partial<AgentVoiceAgent> = {}): AgentVoiceAgent => ({
  id: "agent-1",
  businessId: "biz-1",
  name: "Closer",
  agentType: "BOOKING",
  status: "ACTIVE",
  autonomy: "AUTO",
  voiceCallsEnabled: true,
  dailyCallCap: 20,
  ...over,
});

/** The scheduler's order (scheduler.ts): the voice tick first, its touched leads skipped by the closing tick. */
async function scheduledRun(cw: CallWorld, leads: StalledLead[], agent: AgentVoiceAgent) {
  const voice = await runAgentVoiceCalls(voiceDeps(cw), agent);
  const closing = await runBookingTickCore(bookingDeps(cw.world, leads), agentRow({ autonomy: agent.autonomy }), new Set(voice.touchedLeadIds));
  const texted = new Set([...cw.world.jobs.values()].map((j) => j.leadId));
  return { voice, closing, texted };
}

function callWorld(over: Partial<CallWorld> = {}): CallWorld {
  return { world: new World(), voiceUsable: true, aiMayCall: true, maintenanceUntil: null, callsToday: 0, approvals: new Map(), refuse: new Map(), candidates: [], ...over };
}

describe("one scheduled run: 'Phone leads with AI', then follow-up (no double contact)", () => {
  test("AUTO: callable leads are phoned on their goal's route and not texted; the rest are texted", async () => {
    const cw = callWorld();
    const meet = lead("meet");
    const sale = lead("sale", { goal: "C_DIRECT_SALE" });
    const nophone = lead("nophone", { phone: null });
    const leads = [meet, sale, nophone];
    cw.candidates = leads.map((l) => candidate(l));
    const { voice, texted } = await scheduledRun(cw, leads, voiceAgent());
    assert.deepEqual(cw.world.calls, [
      { leadId: "meet", route: "BOOKING_CLOSE" },
      { leadId: "sale", route: "DIRECT_CLOSE" },
    ]);
    assert.equal(voice.requested, 2);
    assert.deepEqual([...texted], ["nophone"]);
  });

  test("a lead's own refusal (consent, TPS, hours) leaves that lead to follow-up; a workspace refusal stops calling and everyone is texted", async () => {
    const cw = callWorld();
    const leads = [lead("a"), lead("b"), lead("c")];
    cw.candidates = leads.map((l) => candidate(l));
    cw.refuse.set("a", { code: "NO_CONSENT", message: "No consent to call." });
    cw.refuse.set("b", { code: "PLAN_LIMIT", message: "No minutes left." });
    const { texted } = await scheduledRun(cw, leads, voiceAgent());
    assert.deepEqual(cw.world.calls, []);
    assert.deepEqual([...texted].sort(), ["a", "b", "c"]);
    assert.ok(cw.world.events.some((e) => e.eventType === "VOICE_CALL_REFUSED" && e.leadId === "b"));
  });

  test("the daily call cap: at most the cap is phoned (calls already made today count); the rest are texted", async () => {
    const cw = callWorld({ callsToday: 18 });
    const leads = ["a", "b", "c", "d"].map((id) => lead(id));
    cw.candidates = leads.map((l) => candidate(l));
    const { texted } = await scheduledRun(cw, leads, voiceAgent({ dailyCallCap: 20 }));
    assert.equal(cw.world.calls.length, 2);
    assert.deepEqual([...texted].sort(), ["c", "d"]);
  });

  test("a review level never dials: each call becomes an approval, those leads are not texted, approvals count toward the cap", async () => {
    const cw = callWorld();
    const leads = [lead("a"), lead("b")];
    cw.candidates = leads.map((l) => candidate(l));
    const first = await scheduledRun(cw, leads, voiceAgent({ autonomy: "REVIEW_ALL" }));
    assert.deepEqual(cw.world.calls, []);
    assert.equal(first.voice.awaitingApproval, 2);
    assert.equal(first.texted.size, 0);
    // The next run: still waiting, still one approval each, still not texted, and the approvals used the cap.
    cw.candidates = leads.map((l) => candidate(l, { approvalPending: true }));
    const second = await scheduledRun(cw, leads, voiceAgent({ autonomy: "REVIEW_ALL", dailyCallCap: 2 }));
    assert.equal(cw.world.open("REVIEW").length, 2);
    assert.equal(second.texted.size, 0);
  });

  test("'Phone leads' off, voice unusable or maintenance: nobody is phoned, everyone is texted, and a waiting approval survives the nudge", async () => {
    for (const blocker of ["permission", "voice", "maintenance"] as const) {
      const cw = callWorld({
        aiMayCall: blocker !== "permission",
        voiceUsable: blocker !== "voice",
        maintenanceUntil: blocker === "maintenance" ? new Date(NOW.getTime() + 3_600_000) : null,
      });
      cw.world.queue.push({ agent_id: "agent-1", subject_id: "a", item_type: "REVIEW", status: "BLOCKED", subject_label: "Call a", blocked_reason: "Waiting for you", subject_type: "LEAD" });
      const leads = [lead("a"), lead("b")];
      cw.candidates = leads.map((l) => candidate(l));
      const { texted } = await scheduledRun(cw, leads, voiceAgent());
      assert.deepEqual(cw.world.calls, [], blocker);
      assert.deepEqual([...texted].sort(), ["a", "b"], blocker);
      assert.equal(cw.world.open("REVIEW").length, 1, `${blocker}: the approval is still there`);
    }
  });

  test("which agents phone: closing and combined only; sourcing and re-engagement never; the combined agent does all three jobs", () => {
    assert.equal(agentCallingScope("BOOKING").applies, true);
    assert.equal(agentCallingScope("COMBINED").applies, true);
    assert.equal(agentCallingScope("SOURCING").applies, false);
    assert.equal(agentCallingScope("REENGAGEMENT").applies, false);
    assert.deepEqual(workForType("COMBINED"), ["SOURCING", "BOOKING", "REENGAGEMENT"]);
  });
});
