import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_VOICE_DEFAULT_DAILY_CAP,
  agentCallIdempotencyKey,
  agentCallNeedsApproval,
  agentCallRefusal,
  agentCallingScope,
  isCallApprovalItem,
  leadsForFollowUp,
  routeForApproval,
  agentVoiceOption,
  closingRouteForGoal,
  runAgentVoiceCalls,
  selectCallCandidates,
  type AgentVoiceAgent,
  type AgentVoiceAvailability,
  type AgentVoiceDeps,
  type AgentVoiceEvent,
  type VoiceCandidate,
} from "../src/lib/agents/voice-calls.ts";
import { callDisabledReason, callFixLink, drawerCallState, DRAWER_CALL_UNAVAILABLE, type CallButtonVoiceView } from "../src/lib/voice/call-button-state.ts";
import { requestCall } from "../src/lib/voice/runtime-core.ts";
import { serviceOperation } from "../src/lib/services/registry.ts";
import { BIZ, LEAD, VoiceWorld, leadRow } from "./voice-world.ts";

/**
 * "Phone leads with AI" (0176) and the manual "Call with AI" in the Leads
 * drawer. Fakes only: no database, no provider, no call, no spend.
 */

const AGENT_ID = "44444444-4444-4444-8444-444444444444";

/* ----------------------------------------------------------- manual button */

const usableView: CallButtonVoiceView = {
  entitlement: { allowed: true, locked: false, message: null },
  settings: { adminKillSwitch: false },
  integration: { ready: true },
  number: { e164: "+447700900111" },
};
const okLead = { phone: "+447700900123", optedOut: false, anonymised: false, archived: false };

describe("manual Call with AI gating", () => {
  test("a member on a callable lead gets an enabled button", () => {
    assert.equal(callDisabledReason({ role: "member", lead: okLead, view: usableView, latest: null }), null);
  });

  test("a viewer never gets an enabled button, whatever else is true", () => {
    assert.equal(callDisabledReason({ role: "viewer", lead: okLead, view: usableView, latest: null }), "Viewers can't place calls.");
  });

  test("each lead-level reason disables it with its own sentence", () => {
    assert.match(callDisabledReason({ role: "admin", lead: { ...okLead, phone: null }, view: usableView, latest: null }) ?? "", /no phone number/);
    assert.match(callDisabledReason({ role: "admin", lead: { ...okLead, optedOut: true }, view: usableView, latest: null }) ?? "", /opted out/);
    assert.match(callDisabledReason({ role: "admin", lead: { ...okLead, archived: true }, view: usableView, latest: null }) ?? "", /archived/);
    assert.match(callDisabledReason({ role: "admin", lead: okLead, view: usableView, latest: { inProgress: true } }) ?? "", /already in progress/);
  });

  test("workspace-level reasons come first and admins get the fix link", () => {
    const notReady: CallButtonVoiceView = { ...usableView, entitlement: { allowed: false, locked: false, message: "Complete your calling identity in Settings, Voice before calling." } };
    assert.match(callDisabledReason({ role: "admin", lead: okLead, view: notReady, latest: null }) ?? "", /calling identity/);
    assert.deepEqual(callFixLink("admin", notReady), { href: "/app/settings?section=voice&panel=overview", label: "Open voice settings" });
    assert.equal(callFixLink("member", notReady), null);
    const locked: CallButtonVoiceView = { ...usableView, entitlement: { allowed: false, locked: true, message: null } };
    assert.equal(callDisabledReason({ role: "viewer", lead: okLead, view: locked, latest: null }), "Voice is a paid feature and isn't on this plan.");
    assert.equal(callFixLink("member", locked)?.href, "/app/settings?section=billing");
  });

  test("the drawer state carries the reason, the number and the fix; an unreadable state is disabled", () => {
    const state = drawerCallState({ role: "owner", lead: okLead, view: usableView, latest: null });
    assert.deepEqual(state, { disabledReason: null, numberE164: "+447700900111", fix: null });
    assert.ok(DRAWER_CALL_UNAVAILABLE.disabledReason);
  });

  test("the lead page panel and the drawer share one rule", () => {
    const card = readFileSync("src/components/voice/lead-voice-card.tsx", "utf8");
    assert.match(card, /from "@\/lib\/voice\/call-button-state"/);
    assert.doesNotMatch(card, /export function callDisabledReason/);
  });
});

describe("the Leads drawer renders Call yourself and Call with AI", () => {
  const drawer = readFileSync("src/components/leads/lead-drawer.tsx", "utf8");
  const host = readFileSync("src/components/leads/lead-drawer-host.tsx", "utf8");
  const page = readFileSync("src/app/(app)/app/leads/page.tsx", "utf8");

  test("a split call group: the existing tel: call and the AI call through the shared dialog", () => {
    assert.match(drawer, /label="Call yourself"/);
    assert.match(drawer, /window\.location\.href = `tel:\$\{lead\.phone\}`/);
    assert.match(drawer, /label="Call with AI"/);
    assert.match(drawer, /<CallWithAiDialog/);
    // One calling path: the drawer never calls a server action of its own.
    assert.doesNotMatch(drawer, /requestVoiceCallAction/);
  });

  test("on narrow widths the AI call is in More, and hidden from the row", () => {
    assert.match(drawer, /className="-ml-px hidden rounded-l-none sm:inline-flex"/);
    assert.match(drawer, /<DropdownItem\s+className="sm:hidden"\s+icon=\{Bot\}/);
  });

  test("disabled states are explained accessibly, viewers are always disabled, admins get the fix link", () => {
    assert.match(drawer, /const aiCallReason = !canWrite \? "Viewers can't place calls\." : aiCall\.disabledReason;/);
    assert.match(drawer, /describedBy=\{aiCallHint \? aiCallHintId : undefined\}/);
    assert.match(drawer, /id=\{aiCallHintId\}/);
    assert.match(drawer, /aiCall\.fix\.href/);
    assert.match(drawer, /const aiCall = call \?\? DRAWER_CALL_UNAVAILABLE;/);
  });

  test("the state is computed on the server and passed down", () => {
    assert.match(page, /loadDrawerCallState\(workspace\.businessId, workspace\.userId, workspace\.role, detail\.lead\)/);
    assert.match(page, /call=\{call\}/);
    assert.match(host, /call=\{call\}/);
  });
});

/* ------------------------------------------------------------ agent option */

const avail = (over: Partial<AgentVoiceAvailability> = {}): AgentVoiceAvailability => ({
  schemaReady: true,
  voiceUsable: true,
  voiceReason: null,
  voiceLocked: false,
  aiMayCall: true,
  canManage: true,
  ...over,
});

describe("agent option gating", () => {
  test("which agent types phone, and on which routes", () => {
    assert.deepEqual(agentCallingScope("BOOKING"), { applies: true, work: ["CLOSING"], routes: ["BOOKING_CLOSE", "DIRECT_CLOSE"] });
    assert.equal(agentCallingScope("COMBINED").applies, true);
    assert.equal(agentCallingScope("SOURCING").applies, false);
    assert.equal(agentCallingScope("REENGAGEMENT").applies, false);
    assert.equal(closingRouteForGoal("C_DIRECT_SALE"), "DIRECT_CLOSE");
    assert.equal(closingRouteForGoal("D_SIGNUP_TRIAL"), "DIRECT_CLOSE");
    assert.equal(closingRouteForGoal("B_BOOK_MEETING"), "BOOKING_CLOSE");
    assert.equal(closingRouteForGoal(null), "BOOKING_CLOSE");
  });

  test("selectable only when voice is usable; otherwise disabled with the reason and the fix for admins", () => {
    assert.equal(agentVoiceOption("BOOKING", avail()).selectable, true);
    const notReady = agentVoiceOption("BOOKING", avail({ voiceUsable: false, voiceReason: "Your dedicated calling number isn't active yet." }));
    assert.equal(notReady.selectable, false);
    assert.equal(notReady.reason, "Your dedicated calling number isn't active yet.");
    assert.equal(notReady.fixHref, "/app/settings?section=voice&panel=overview");
    const locked = agentVoiceOption("COMBINED", avail({ voiceUsable: false, voiceLocked: true, voiceReason: "Voice is a paid feature." }));
    assert.equal(locked.fixHref, "/app/settings?section=billing");
    assert.equal(agentVoiceOption("BOOKING", avail({ schemaReady: false })).selectable, false);
    assert.equal(agentVoiceOption("SOURCING", avail()).selectable, false);
    const member = agentVoiceOption("BOOKING", avail({ canManage: false, voiceUsable: false, voiceReason: "x" }));
    assert.equal(member.selectable, false);
    assert.equal(member.fixHref, null);
  });

  test("with the workspace's Phone leads off, the option is selectable but says it needs the permission", () => {
    const o = agentVoiceOption("BOOKING", avail({ aiMayCall: false }));
    assert.equal(o.selectable, true);
    assert.equal(o.needsCallPermission, true);
  });

  test("the option is off by default and the wizard only sends it when selectable", () => {
    const field = readFileSync("src/components/agents/agent-voice-calls-field.tsx", "utf8");
    assert.match(field, /DEFAULT_AGENT_VOICE_VALUE: AgentVoiceValue = \{ enabled: false/);
    const wizard = readFileSync("src/components/agents/agent-wizard.tsx", "utf8");
    assert.match(wizard, /agentVoiceOption\(type, voiceAvailability!\)\.selectable/);
    const sql = readFileSync("supabase/migrations/0176_agent_voice_calls.sql", "utf8");
    assert.match(sql, /voice_calls_enabled boolean not null default false/);
    assert.match(sql, /voice_daily_call_cap integer not null default 20/);
  });
});

/* ---------------------------------------------- server refusal (AGENT) */

const runningAgent = { status: "ACTIVE", agentType: "BOOKING", voiceCallsEnabled: true, dailyCallCap: 20 };

describe("the voice.request_call refusal for an AGENT caller", () => {
  test("a running closing agent with the option and the permission on, under its cap, may ask", () => {
    assert.equal(agentCallRefusal({ agent: runningAgent, aiMayCall: true, callsToday: 0, route: "BOOKING_CLOSE" }), null);
  });

  test("each missing condition refuses with its own reason", () => {
    assert.equal(agentCallRefusal({ agent: null, aiMayCall: true, callsToday: 0, route: "BOOKING_CLOSE" })?.reason, "AGENT_NOT_FOUND");
    assert.equal(agentCallRefusal({ agent: { ...runningAgent, status: "PAUSED" }, aiMayCall: true, callsToday: 0, route: "BOOKING_CLOSE" })?.reason, "AGENT_NOT_RUNNING");
    assert.equal(agentCallRefusal({ agent: { ...runningAgent, voiceCallsEnabled: false }, aiMayCall: true, callsToday: 0, route: "BOOKING_CLOSE" })?.reason, "AGENT_VOICE_OFF");
    assert.equal(agentCallRefusal({ agent: { ...runningAgent, agentType: "SOURCING" }, aiMayCall: true, callsToday: 0, route: "BOOKING_CLOSE" })?.reason, "AGENT_TYPE_CANNOT_CALL");
    assert.equal(agentCallRefusal({ agent: runningAgent, aiMayCall: true, callsToday: 0, route: "QUALIFICATION" })?.reason, "ROUTE_NOT_ALLOWED");
    assert.equal(agentCallRefusal({ agent: runningAgent, aiMayCall: true, callsToday: 20, route: "BOOKING_CLOSE" })?.reason, "AGENT_DAILY_CALL_CAP");
  });

  test("the agent's option never stands in for the workspace permission", () => {
    const r = agentCallRefusal({ agent: runningAgent, aiMayCall: false, callsToday: 0, route: "BOOKING_CLOSE" });
    assert.equal(r?.reason, "AI_CALL_PERMISSION_OFF");
    assert.equal(r?.code, "POLICY_BLOCKED");
  });

  test("the handler applies it to AGENT callers only, and only an agent may name an agent", () => {
    const op = readFileSync("src/lib/services/operations/voice.ts", "utf8");
    assert.match(op, /if \(context\.caller === "AGENT"\) \{\s+if \(!args\.agentId\)/);
    assert.match(op, /const refusal = agentCallRefusal\(facts\);/);
    assert.match(op, /\} else if \(args\.agentId\) \{\s+throw new ServiceError\("FORBIDDEN_SCOPE"/);
    // An agent is never a person, so it never skips the human-takeover hold.
    assert.match(op, /requestedBy: context\.caller === "AGENT" \? null : context\.userId/);
  });
});

describe("permission is never widened implicitly", () => {
  test("switching an agent's calls on does not write What the AI may do", () => {
    const src = readFileSync("src/lib/services/operations/agent-voice.ts", "utf8");
    const setVoice = src.slice(src.indexOf('defineOperation("agent.set_voice_calls"'), src.indexOf('defineOperation("ai_settings.allow_calls"'));
    assert.doesNotMatch(setVoice, /commercial_authority/);
    assert.doesNotMatch(setVoice, /ai_permissions/);
    assert.match(setVoice, /call_permission_off/);
  });

  test("allowing calls is its own UI-only, admin operation, audited; agents cannot reach either", () => {
    const allow = serviceOperation("ai_settings.allow_calls");
    assert.deepEqual(allow?.callers, ["UI"]);
    assert.equal(allow?.minimumRole, "admin");
    const set = serviceOperation("agent.set_voice_calls");
    assert.equal(set?.callers?.includes("AGENT"), false);
    assert.equal(set?.risk, "FINANCIAL");
    const src = readFileSync("src/lib/services/operations/agent-voice.ts", "utf8");
    assert.match(src, /action: "commercial_authority\.ai_updated"/);
    assert.match(src, /const capabilities = \{ \.\.\.current\.capabilities, call: true \};/);
  });

  test("the saveAgent action switches calls on through agent.set_voice_calls only", () => {
    const actions = readFileSync("src/lib/agents/actions.ts", "utf8");
    const save = actions.slice(actions.indexOf("export async function saveAgent("), actions.indexOf("const voiceCallsSchema"));
    assert.match(save, /"agent\.set_voice_calls"/);
    assert.doesNotMatch(save, /ai_settings\.allow_calls/);
  });

  test("voice.request_call admits AGENT (checked in the handler)", () => {
    assert.ok(serviceOperation("voice.request_call")?.callers?.includes("AGENT"));
  });
});

/* ------------------------------------------------------------- the tick */

function cand(id: string, over: Partial<VoiceCandidate> = {}): VoiceCandidate {
  return {
    leadId: id,
    label: `Lead ${id}`,
    route: "BOOKING_CLOSE",
    phone: "+447700900200",
    optedOut: false,
    humanTakeover: false,
    openCall: false,
    calledOnRoute: false,
    ...over,
  };
}

function agent(over: Partial<AgentVoiceAgent> = {}): AgentVoiceAgent {
  return { id: AGENT_ID, businessId: BIZ, name: "Closer", agentType: "BOOKING", status: "ACTIVE", autonomy: "AUTO", voiceCallsEnabled: true, dailyCallCap: AGENT_VOICE_DEFAULT_DAILY_CAP, ...over };
}

class FakeTick {
  requests: { leadId: string; route: string }[] = [];
  events: AgentVoiceEvent[] = [];
  candidateList: VoiceCandidate[] = [];
  qualificationList: VoiceCandidate[] = [];
  callsToday = 0;
  aiMayCall = true;
  voice = { usable: true, reason: null as string | null };
  held: Date | null = null;
  refuse = new Map<string, { code: string; message: string }>();
  existing = new Set<string>();
  approvals: string[] = [];
  openApprovals = new Set<string>();
  approvalsToday = 0;
  deps(): AgentVoiceDeps {
    return {
      now: () => new Date("2026-09-28T11:00:00.000Z"),
      maintenancePausedUntil: async () => this.held,
      voiceStatus: async () => this.voice,
      aiMayCall: async () => this.aiMayCall,
      callsSince: async () => this.callsToday,
      approvalsSince: async () => this.approvalsToday,
      requestApproval: async (_a, c) => {
        if (this.openApprovals.has(c.leadId)) return { ok: true, existing: true };
        this.openApprovals.add(c.leadId);
        this.approvals.push(c.leadId);
        return { ok: true, existing: false };
      },
      candidates: async (_a, work) => (work === "CLOSING" ? this.candidateList : this.qualificationList),
      requestCall: async (_a, leadId, route) => {
        this.requests.push({ leadId, route });
        const refusal = this.refuse.get(leadId);
        if (refusal) return { ok: false, ...refusal };
        return { ok: true, callId: `call-${leadId}`, existing: this.existing.has(leadId), deferredReason: null };
      },
      record: async (_a, e) => {
        this.events.push(e);
      },
    };
  }
}

describe("the agent tick requests calls only for eligible leads", () => {
  test("off, or a type that never phones: nothing is asked for and nothing recorded", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("a")];
    assert.equal((await runAgentVoiceCalls(f.deps(), agent({ voiceCallsEnabled: false }))).requested, 0);
    assert.equal((await runAgentVoiceCalls(f.deps(), agent({ agentType: "SOURCING" }))).requested, 0);
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.events, []);
  });

  test("skips leads without a phone, opted out, taken over, with a call open or already called on the route", async () => {
    const f = new FakeTick();
    f.candidateList = [
      cand("ok1"),
      cand("nophone", { phone: null }),
      cand("optout", { optedOut: true }),
      cand("takeover", { humanTakeover: true }),
      cand("open", { openCall: true }),
      cand("called", { calledOnRoute: true }),
      cand("ok2", { route: "DIRECT_CLOSE" }),
    ];
    const r = await runAgentVoiceCalls(f.deps(), agent());
    assert.deepEqual(f.requests, [
      { leadId: "ok1", route: "BOOKING_CLOSE" },
      { leadId: "ok2", route: "DIRECT_CLOSE" },
    ]);
    assert.equal(r.requested, 2);
    assert.equal(f.events.filter((e) => e.eventType === "VOICE_CALL_REQUESTED").length, 2);
  });

  test("a combined agent phones closing leads, then new leads on QUALIFICATION, each lead once", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("x")];
    f.qualificationList = [cand("x", { route: "QUALIFICATION" }), cand("y", { route: "QUALIFICATION" })];
    await runAgentVoiceCalls(f.deps(), agent({ agentType: "COMBINED" }));
    assert.deepEqual(f.requests, [
      { leadId: "x", route: "BOOKING_CLOSE" },
      { leadId: "y", route: "QUALIFICATION" },
    ]);
  });

  test("the lead's own refusal (consent, TPS, hours...) is recorded and the tick moves on; a workspace refusal stops it", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("a"), cand("b"), cand("c")];
    f.refuse.set("a", { code: "POLICY_BLOCKED", message: "This number is on the TPS register." });
    f.refuse.set("b", { code: "PLAN_LIMIT", message: "You're out of voice minutes." });
    const r = await runAgentVoiceCalls(f.deps(), agent());
    assert.deepEqual(f.requests.map((x) => x.leadId), ["a", "b"]);
    assert.equal(r.blocked, 2);
    assert.equal(r.requested, 0);
    assert.ok(f.events.some((e) => e.eventType === "VOICE_CALL_REFUSED" && e.detail === "This number is on the TPS register."));
  });

  test("voice unusable or maintenance: nothing is asked for", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("a")];
    f.voice = { usable: false, reason: "You're out of voice minutes." };
    const r = await runAgentVoiceCalls(f.deps(), agent());
    assert.equal(r.requested, 0);
    assert.equal(f.events[0]?.eventType, "VOICE_CALLS_BLOCKED");
    const g = new FakeTick();
    g.candidateList = [cand("a")];
    g.held = new Date("2026-09-28T13:00:00.000Z");
    await runAgentVoiceCalls(g.deps(), agent());
    assert.deepEqual(g.requests, []);
  });

  test("with Phone leads off, nothing is asked for and the timeline says why", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("a")];
    f.aiMayCall = false;
    const r = await runAgentVoiceCalls(f.deps(), agent());
    assert.deepEqual(f.requests, []);
    assert.match(r.detail, /Phone leads is off/);
    assert.equal(f.events[0]?.title, "AI calls are waiting for permission");
  });
});

describe("caps and idempotency", () => {
  test("selection returns each lead once, at most the remaining count, and says why others were skipped", () => {
    const { toCall, skipped } = selectCallCandidates([cand("a"), cand("a", { route: "QUALIFICATION" }), cand("b"), cand("c", { phone: null })], 1);
    assert.deepEqual(toCall.map((c) => c.leadId), ["a"]);
    assert.deepEqual(skipped.map((s) => s.leadId), ["c"]);
  });

  test("never more than the daily cap, counting calls already asked for today", async () => {
    const f = new FakeTick();
    f.candidateList = Array.from({ length: 10 }, (_, i) => cand(`l${i}`));
    f.callsToday = 17;
    const r = await runAgentVoiceCalls(f.deps(), agent({ dailyCallCap: 20 }));
    assert.equal(f.requests.length, 3);
    assert.equal(r.requested, 3);
    const g = new FakeTick();
    g.candidateList = [cand("a")];
    g.callsToday = 20;
    await runAgentVoiceCalls(g.deps(), agent({ dailyCallCap: 20 }));
    assert.deepEqual(g.requests, []);
  });

  test("the cap is clamped to 1..100", async () => {
    const f = new FakeTick();
    f.candidateList = Array.from({ length: 150 }, (_, i) => cand(`l${i}`));
    await runAgentVoiceCalls(f.deps(), agent({ dailyCallCap: 5000 }));
    assert.equal(f.requests.length, 100);
  });

  test("a call that already existed is not counted or recorded twice", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("a")];
    f.existing.add("a");
    const r = await runAgentVoiceCalls(f.deps(), agent());
    assert.equal(r.requested, 0);
    assert.equal(f.events.length, 0);
  });

  test("the idempotency key is per agent, lead and route", () => {
    assert.equal(agentCallIdempotencyKey("ag", "ld", "BOOKING_CLOSE"), "agent-voice:ag:ld:BOOKING_CLOSE");
    assert.notEqual(agentCallIdempotencyKey("ag", "ld", "QUALIFICATION"), agentCallIdempotencyKey("ag", "ld", "BOOKING_CLOSE"));
  });

  test("the runtime: two concurrent agent requests for one lead and route make one call (voiceCallKey), attributed to the agent", async () => {
    const w = new VoiceWorld();
    const input = { businessId: BIZ, leadId: LEAD, route: "BOOKING_CLOSE" as const, entryPoint: "OUTBOUND_DIAL" as const, requestedBy: null, requestedByAgentId: AGENT_ID };
    const [a, b] = await Promise.all([requestCall(w.deps(), input), requestCall(w.deps(), input)]);
    assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
    if (!a.ok || !b.ok) return;
    assert.equal(a.callId, b.callId);
    assert.deepEqual([a.existing, b.existing].sort(), [false, true]);
    assert.equal(w.calls.size, 1);
    const row = [...w.calls.values()][0] as unknown as { requested_by_agent_id?: string };
    assert.equal(row.requested_by_agent_id, AGENT_ID);
    // One dial job, and never flagged as a person's own request.
    const dials = w.jobs.filter((j) => j.type === "voice.dial");
    assert.equal(dials.length, 1);
    assert.equal((dials[0].payload as { personRequested?: boolean }).personRequested, undefined);
  });

  test("the runtime: an agent's call keeps the human-takeover hold, even with a user id on it", async () => {
    const w = new VoiceWorld();
    w.leads.set(LEAD, leadRow(LEAD, { human_takeover: true }));
    const r = await requestCall(w.deps(), {
      businessId: BIZ,
      leadId: LEAD,
      route: "BOOKING_CLOSE",
      entryPoint: "OUTBOUND_DIAL",
      requestedBy: "55555555-5555-4555-8555-555555555555",
      requestedByAgentId: AGENT_ID,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.ok) assert.equal(r.deferredReason, "HUMAN_ACTIVE");
  });

  test("the runtime: a manual call is never attributed to an agent", async () => {
    const w = new VoiceWorld();
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: "QUALIFICATION", entryPoint: "OUTBOUND_DIAL", requestedBy: "55555555-5555-4555-8555-555555555555" });
    assert.equal(r.ok, true);
    const row = [...w.calls.values()][0] as unknown as Record<string, unknown>;
    assert.equal("requested_by_agent_id" in row, false);
  });
});

describe("surfaces", () => {
  test("the call card says which agent called", () => {
    const card = readFileSync("src/components/voice/call-card.tsx", "utf8");
    assert.match(card, /Called by \{card\.calledBy\}/);
  });

  test("the agents list and detail show whether AI calling is on and the recent count", () => {
    const cardSrc = readFileSync("src/components/agents/agent-card.tsx", "utf8");
    assert.match(cardSrc, /AI calls on · \$\{agent\.voiceCalls\.calls7d/);
    const tabs = readFileSync("src/components/agents/agent-tabs.tsx", "utf8");
    assert.match(tabs, /label="AI phone calls"/);
    assert.match(tabs, /<AgentVoiceCallsForm/);
  });
});

/* ----------------------------------- owner decisions 2026-09-28 (2 and 3) */

describe("no double contact: the call is the touch", () => {
  test("leads this run's call covers are left out of its text follow-up", () => {
    const { leads, covered } = leadsForFollowUp([{ id: "a" }, { id: "b" }, { id: "c" }], new Set(["b"]));
    assert.deepEqual(leads.map((l) => l.id), ["a", "c"]);
    assert.equal(covered, 1);
  });

  test("the run reports requested, queued-or-live and approval-waiting leads as touched; refused ones are not", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("asked"), cand("open", { openCall: true }), cand("refused"), cand("waiting", { approvalPending: true })];
    f.refuse.set("refused", { code: "POLICY_BLOCKED", message: "This number is on the TPS register." });
    const r = await runAgentVoiceCalls(f.deps(), agent());
    assert.deepEqual([...r.touchedLeadIds].sort(), ["asked", "open", "waiting"]);
  });

  test("the scheduler phones first, then hands the covered leads to the closing tick to skip", () => {
    const scheduler = readFileSync("src/lib/agents/scheduler.ts", "utf8");
    assert.ok(scheduler.indexOf("runAgentVoiceTick(") < scheduler.indexOf("for (const work of workForType("));
    assert.match(scheduler, /calledLeadIds = new Set\(voice\.touchedLeadIds\)/);
    assert.match(scheduler, /runBookingTick\(agent, calledLeadIds\)/);
    const ticks = readFileSync("src/lib/agents/ticks.ts", "utf8");
    assert.match(ticks, /const \{ leads, covered \} = leadsForFollowUp\(stalled\.leads, calledLeadIds\);/);
  });

  test("a cancelled or refused call leaves the lead to follow-up next run (only this run's set is skipped)", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("x", { calledOnRoute: true })];
    const r = await runAgentVoiceCalls(f.deps(), agent());
    assert.deepEqual(r.touchedLeadIds, []);
  });
});

describe("approval levels: a review-level agent never dials", () => {
  test("only AUTO dials without a person", () => {
    assert.equal(agentCallNeedsApproval("AUTO"), false);
    assert.equal(agentCallNeedsApproval("REVIEW_ALL"), true);
    assert.equal(agentCallNeedsApproval("REVIEW_NEW"), true);
  });

  test("on a review level each call becomes an approval item, and nothing is asked of voice", async () => {
    for (const autonomy of ["REVIEW_ALL", "REVIEW_NEW"]) {
      const f = new FakeTick();
      f.candidateList = [cand("a"), cand("b")];
      const r = await runAgentVoiceCalls(f.deps(), agent({ autonomy }));
      assert.deepEqual(f.requests, [], autonomy);
      assert.deepEqual(f.approvals, ["a", "b"]);
      assert.equal(r.awaitingApproval, 2);
      assert.equal(r.requested, 0);
      assert.deepEqual([...r.touchedLeadIds].sort(), ["a", "b"]);
      assert.equal(f.events.filter((e) => e.eventType === "VOICE_CALL_APPROVAL_REQUESTED").length, 2);
    }
  });

  test("an open approval is not duplicated on the next run, and waiting approvals count toward the cap", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("a", { approvalPending: true }), cand("b"), cand("c")];
    f.approvalsToday = 19;
    const r = await runAgentVoiceCalls(f.deps(), agent({ autonomy: "REVIEW_ALL", dailyCallCap: 20 }));
    assert.deepEqual(f.approvals, ["b"]);
    assert.equal(r.awaitingApproval, 1);
  });

  test("the approval gates still apply: Phone leads off creates no approval", async () => {
    const f = new FakeTick();
    f.candidateList = [cand("a")];
    f.aiMayCall = false;
    await runAgentVoiceCalls(f.deps(), agent({ autonomy: "REVIEW_ALL" }));
    assert.deepEqual(f.approvals, []);
  });

  test("the approval item is the agent queue's existing review item", () => {
    assert.equal(isCallApprovalItem({ itemType: "REVIEW", subjectType: "LEAD", status: "BLOCKED" }), true);
    assert.equal(isCallApprovalItem({ itemType: "REVIEW", subjectType: "PROSPECT", status: "BLOCKED" }), false);
    assert.equal(isCallApprovalItem({ itemType: "REVIEW", subjectType: "LEAD", status: "DONE" }), false);
  });

  test("the approved call's route is worked out when the person approves", () => {
    assert.equal(routeForApproval({ qualificationState: "PENDING", stalledGoal: null }), "QUALIFICATION");
    assert.equal(routeForApproval({ qualificationState: "QUALIFIED", stalledGoal: "C_DIRECT_SALE" }), "DIRECT_CLOSE");
    assert.equal(routeForApproval({ qualificationState: "QUALIFIED", stalledGoal: "B_BOOK_MEETING" }), "BOOKING_CLOSE");
    assert.equal(routeForApproval({ qualificationState: "QUALIFIED", stalledGoal: null }), null);
    assert.equal(routeForApproval({ qualificationState: "NOT_QUALIFIED", stalledGoal: null }), null);
  });

  test("approving dials as the agent, never as the person, through voice.request_call; claimed once", () => {
    const decl = serviceOperation("agent.decide_call");
    assert.deepEqual(decl?.callers, ["UI"]);
    assert.equal(decl?.risk, "EXTERNAL");
    const src = readFileSync("src/lib/services/operations/agent-voice.ts", "utf8");
    const handler = src.slice(src.indexOf('defineOperation("agent.decide_call"'));
    assert.match(handler, /"voice\.request_call",\s+\{ leadId: item\.subject_id, route, agentId: item\.agent_id \}/);
    assert.match(handler, /userId: null,\s+role: "member",\s+caller: "AGENT",/);
    assert.match(handler, /confirmationSource: "person"/);
    assert.match(handler, /\.in\("status", \[\.\.\.CALL_APPROVAL_OPEN_STATUSES\]\)/);
    assert.match(handler, /idempotencyKey: `agent-call-approval:\$\{item\.id\}`/);
  });

  test("the queue shows Approve call and Decline to members", () => {
    const tabs = readFileSync("src/components/agents/agent-tabs.tsx", "utf8");
    assert.match(tabs, /callApproval && canDecideCalls && <AgentCallDecision/);
    const page = readFileSync("src/app/(app)/app/agents/[id]/page.tsx", "utf8");
    assert.match(page, /canDecideCalls=\{hasRole\(workspace\.role, "member"\)\}/);
  });
});
