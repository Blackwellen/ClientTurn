/**
 * Voice P3 in the runtime (src/lib/voice/runtime-core.ts) with in-memory
 * fakes: the brief and the per-call overrides at dial time, the §26
 * voicemail, platform maintenance, the carrier id, post-call continuity and
 * the closing attribution, the §71 missed-call follow-up, the sealed
 * subaccount token, and OD-2's checkout line items. No network, no
 * database, no Stripe, no spend.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  dialCall,
  ingestVoiceEvent,
  planCallRetry,
  postProcessCall,
  provisionStep,
  requestCall,
  startProvisioning,
  type CallRow,
  type ChannelFacts,
  type VoiceDeps,
  type VoiceRepo,
} from "../src/lib/voice/runtime-core.ts";
import { VOICEMAIL_SCRIPT_VERSION } from "../src/lib/voice/retry-policy.ts";
import { PROVIDER_MAX_DURATION_SEC } from "../src/lib/voice/time-governor.ts";
import { CLOSING_VERSION, renderClosingLine } from "../src/lib/voice/opener.ts";
import { buildCallMemoryNote, mergeCallIntoMemory } from "../src/lib/voice/continuity.ts";
import { emptyMemory } from "../src/lib/opportunities/memory.ts";
import { planChangeItems, subscriptionCheckoutItems, voiceRemovalPlan, includesVoiceByDefault } from "../src/lib/billing/voice-line-items.ts";
import type { OutboundCallRequest, VoiceEvent } from "../src/lib/voice/providers/types.ts";
import type { TextChannel } from "../src/lib/voice/channel-orchestration.ts";
import { BIZ, LEAD, VoiceWorld, permissionRow, settingsRow, validDetails } from "./voice-world.ts";

/** The P2 world plus the optional P3 repo methods and deps. */
class P3World extends VoiceWorld {
  plans = new Map<string, { briefVersion: string | null; voicemailScriptVersion: string | null; premiumVoice?: boolean }>();
  agentSummaries = new Map<string, { summary: string; disposition: string; nextStep: string | null }>();
  memoryNotes: { callId: string; summary: string | null; nextStep: string | null }[] = [];
  attribution = new Map<string, { spoken: boolean; closingVersion: string }>();
  carrier = new Map<string, { sid: string; source: string }>();
  texts: { channel: TextChannel; body: string; sendKey: string }[] = [];
  channelFacts: ChannelFacts = { automatedSentAt: [], touchesSinceEngagement: 0, intentState: "MEDIUM", preferredChannel: null, sentSinceLastCall: [], whatsappWindowOpen: false };
  tokens: { sid: string; token: string | null }[] = [];
  tokenStored = false;
  maintenanceUntil: Date | null = null;
  briefCalls = 0;

  override repo(): VoiceRepo {
    const base = super.repo();
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the repo methods close over the world
    const w = this;
    return {
      ...base,
      async saveOutcome(input) {
        await base.saveOutcome(input);
        if (input.attribution) w.attribution.set(input.callId, input.attribution);
      },
      async upsertTelephonyAccount(input) {
        await base.upsertTelephonyAccount(input);
        w.tokens.push({ sid: input.subaccountSid, token: input.authToken ?? null });
        if (input.authToken) w.tokenStored = true;
      },
      async telephonyTokenStored() {
        return w.tokenStored;
      },
      async voicemailAlreadyLeft(_b, leadId, route) {
        return [...w.calls.values()].some((c) => c.lead_id === leadId && c.route === route && c.voicemail_left);
      },
      async recordCallPlan(callId, plan) {
        w.plans.set(callId, plan);
      },
      async loadCallPlan(callId) {
        return w.plans.get(callId) ?? null;
      },
      async loadAgentSummary(callId) {
        return w.agentSummaries.get(callId) ?? null;
      },
      async recordCallMemory({ callId, note }) {
        w.memoryNotes.push({ callId, summary: note.summary, nextStep: note.nextStep });
      },
      async findLiveCallsByNumbers({ fromE164, toE164 }) {
        return [...w.calls.values()].filter((c) => c.from_e164 === fromE164 && c.to_e164 === toE164 && ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION"].includes(c.state));
      },
      async recordCarrierCallSid(callId, sid, source) {
        const c = w.calls.get(callId);
        if (c && !c.carrier_call_sid) w.calls.set(callId, { ...c, carrier_call_sid: sid });
        w.carrier.set(callId, { sid, source });
      },
      async loadChannelFacts() {
        return w.channelFacts;
      },
      async queueFollowUpText(input) {
        if (w.texts.some((t) => t.sendKey === input.sendKey)) return false;
        w.texts.push({ channel: input.channel, body: input.body, sendKey: input.sendKey });
        return true;
      },
    };
  }

  override deps(): VoiceDeps {
    return {
      ...super.deps(),
      briefFor: async () => {
        this.briefCalls += 1;
        return { version: "brief.test", dynamicVariables: { call_brief: "PLAN", time_plan: "TIME", closing_line: "CLOSE", locked_preamble: "must not win" } };
      },
      maintenancePauseUntil: async () => this.maintenanceUntil,
    };
  }
}

async function queued(w: VoiceWorld, route: "QUALIFICATION" | "BOOKING_CLOSE" = "QUALIFICATION") {
  const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route, entryPoint: "OUTBOUND_DIAL", requestedBy: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { callId: string }).callId;
}

function lastRequest(w: VoiceWorld): OutboundCallRequest {
  return w.voice!.log.filter((l) => l.method === "startOutboundCall").at(-1)!.arg as OutboundCallRequest;
}

function ended(callId: string, pid: string, outcome: "NO_ANSWER" | "VOICEMAIL" | "COMPLETED", durationSec = 0): VoiceEvent {
  return {
    provider: "retell",
    dedupeKey: `${pid}:call_ended`,
    occurredAt: null,
    providerCallId: pid,
    metadata: { voice_call_id: callId },
    type: "CALL_ENDED",
    outcome,
    durationSec,
    disconnectionReason: outcome === "VOICEMAIL" ? "voicemail_reached" : outcome === "NO_ANSWER" ? "dial_no_answer" : "user_hangup",
  } as VoiceEvent;
}

describe("dial: the brief and the per-call overrides", () => {
  test("the brief's variables travel with the call, and the locked opener always wins", async () => {
    const w = new P3World();
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const req = lastRequest(w);
    assert.equal(w.briefCalls, 1);
    assert.equal(req.dynamicVariables.call_brief, "PLAN");
    assert.equal(req.dynamicVariables.closing_line, "CLOSE");
    assert.match(req.dynamicVariables.locked_preamble, /^This is an AI assistant calling from Acme Studio/);
    assert.equal(req.overrides?.maxCallDurationMs, PROVIDER_MAX_DURATION_SEC * 1000);
    assert.equal(w.plans.get(id)?.briefVersion, "brief.test");
  });

  test("a brief that throws never fails the call", async () => {
    const w = new P3World();
    const deps = { ...w.deps(), briefFor: async () => { throw new Error("context down"); } };
    const id = await queued(w);
    const r = await dialCall(deps, id);
    assert.equal(r.status, "DIALLED");
    assert.equal(lastRequest(w).dynamicVariables.call_brief, undefined);
  });

  test("§26 voicemail: hang up unless voicemail is on AND the basis allows an automated message", async () => {
    const off = new P3World();
    await dialCall(off.deps(), await queued(off));
    assert.deepEqual(lastRequest(off).overrides?.voicemail, { mode: "HANG_UP" });

    const numberOnly = new P3World();
    numberOnly.settings = settingsRow({ voicemail_enabled: true });
    numberOnly.permissions.set(LEAD, permissionRow({ consent_scope: ["SMS", "PHONE_NUMBER_PROVIDED"], call_consent_wording: null }));
    // A number-only lead cannot even be called by the AI: the voicemail question never arises.
    const refused = await requestCall(numberOnly.deps(), { businessId: BIZ, leadId: LEAD, route: "QUALIFICATION", entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    assert.equal(refused.ok, false);

    const on = new P3World();
    on.settings = settingsRow({ voicemail_enabled: true });
    const id = await queued(on);
    await dialCall(on.deps(), id);
    const vm = lastRequest(on).overrides?.voicemail;
    assert.equal(vm?.mode, "STATIC_TEXT");
    assert.match((vm as { text: string }).text, /^Hello, this is an AI assistant calling from Acme Studio about the enquiry you sent us/);
    assert.match((vm as { text: string }).text, /We will try you again at another time\./);
    assert.equal(on.plans.get(id)?.voicemailScriptVersion, VOICEMAIL_SCRIPT_VERSION);
  });

  test("§26: once per request; the AMD outcome marks it left and the next attempt hangs up", async () => {
    const w = new P3World();
    w.settings = settingsRow({ voicemail_enabled: true });
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    await ingestVoiceEvent(w.deps(), ended(id, pid, "VOICEMAIL"));
    await postProcessCall(w.deps(), { callId: id });
    assert.equal(w.calls.get(id)!.voicemail_left, true);
    const retry = await planCallRetry(w.deps(), id);
    assert.equal(retry.status, "RETRY_QUEUED");
    const next = (retry as { callId: string }).callId;
    w.now = new Date(w.now.getTime() + 25 * 60 * 60_000);
    await dialCall(w.deps(), next);
    assert.deepEqual(lastRequest(w).overrides?.voicemail, { mode: "HANG_UP" });
  });
});

describe("the voice profile at dial time, and premium minutes at settle", () => {
  test("a standard voice rides on the call; minutes settle to the second", async () => {
    const w = new P3World();
    w.settings = settingsRow({ voice_profile: { voiceId: "cartesia-Willa" } });
    const id = await queued(w);
    await dialCall(w.deps(), id);
    assert.equal(lastRequest(w).overrides?.voice?.voice_id, "cartesia-Willa");
    assert.equal(w.plans.get(id)?.premiumVoice, false);
  });

  test("an accepted premium voice marks the call premium and settles at the premium factor", async () => {
    const w = new P3World();
    w.settings = settingsRow({ voice_profile: { voiceId: "11labs-Amy", premiumAccepted: true } });
    const id = await queued(w);
    await dialCall(w.deps(), id);
    assert.equal(lastRequest(w).overrides?.voice?.voice_id, "11labs-Amy");
    assert.equal(w.plans.get(id)?.premiumVoice, true);
    const pid = w.calls.get(id)!.provider_call_id!;
    w.voice!.calls.get(pid)!.transcript = [{ role: "user", content: "Yes, go on.", startMs: 0, endMs: 1000 }];
    await ingestVoiceEvent(w.deps(), ended(id, pid, "COMPLETED", 120));
    const r = await postProcessCall(w.deps(), { callId: id });
    assert.equal((r as { billedSec: number }).billedSec, 174);
    assert.ok(w.costs.some((c) => c.idempotencyKey.endsWith(":premium:estimate")));
  });

  test("a premium voice without the surcharge accepted is never sent", async () => {
    const w = new P3World();
    w.settings = settingsRow({ voice_profile: { voiceId: "11labs-Amy" } });
    const id = await queued(w);
    await dialCall(w.deps(), id);
    assert.equal(lastRequest(w).overrides?.voice?.voice_id, undefined);
    assert.equal(w.plans.get(id)?.premiumVoice, false);
  });
});

describe("platform maintenance holds outbound calls (never drops them)", () => {
  test("a queued dial during APP_OFFLINE is re-scheduled for after the window", async () => {
    const w = new P3World();
    const id = await queued(w);
    w.maintenanceUntil = new Date(w.now.getTime() + 30 * 60_000);
    const r = await dialCall(w.deps(), id);
    assert.equal(r.status, "DEFERRED");
    assert.equal((r as { reason: string }).reason, "MAINTENANCE_WINDOW");
    assert.equal(w.providerCalls(), 0);
    assert.equal(w.calls.get(id)!.state, "QUEUED");
    assert.ok(w.jobs.some((j) => j.type === "voice.dial" && j.runAt?.getTime() === w.maintenanceUntil!.getTime()));
    // After the window the same call dials.
    w.now = new Date(w.maintenanceUntil.getTime() + 1000);
    w.maintenanceUntil = null;
    assert.equal((await dialCall(w.deps(), id)).status, "DIALLED");
  });

  test("a new request during the window is booked for after it, with the reason", async () => {
    const w = new P3World();
    w.maintenanceUntil = new Date(w.now.getTime() + 20 * 60_000);
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: "QUALIFICATION", entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    assert.equal(r.ok, true);
    assert.equal((r as { deferredReason: string }).deferredReason, "MAINTENANCE_WINDOW");
    assert.equal((r as { scheduledFor: string }).scheduledFor, w.maintenanceUntil.toISOString());
  });

  test("READ_ONLY (no hold) and an unreadable state do not pause calls", async () => {
    const w = new P3World();
    const id = await queued(w);
    const deps = { ...w.deps(), maintenancePauseUntil: async () => { throw new Error("status unavailable"); } };
    assert.equal((await dialCall(deps, id)).status, "DIALLED");
  });
});

describe("the carrier id (P2 gap c)", () => {
  test("Retell's telephony identifier is recorded once, so Twilio callbacks match the call", async () => {
    const w = new P3World();
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    const sid = `CA${"1".repeat(32)}`;
    await ingestVoiceEvent(w.deps(), { provider: "retell", type: "CALL_STARTED", dedupeKey: `${pid}:call_started`, occurredAt: null, providerCallId: pid, metadata: { voice_call_id: id, carrier_call_sid: sid } } as VoiceEvent);
    assert.equal(w.carrier.get(id)?.source, "RETELL_TELEPHONY_ID");
    const twilio = await ingestVoiceEvent(w.deps(), { provider: "twilio", type: "CALL_RINGING", dedupeKey: `${sid}:ringing`, occurredAt: null, providerCallId: sid } as VoiceEvent);
    assert.notEqual(twilio.status, "UNMATCHED");
  });

  test("otherwise a Twilio callback is matched on the number pair to the ONE live call, and recorded", async () => {
    const w = new P3World();
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const c = w.calls.get(id)!;
    const sid = `CA${"2".repeat(32)}`;
    const r = await ingestVoiceEvent(w.deps(), { provider: "twilio", type: "CALL_RINGING", dedupeKey: `${sid}:ringing`, occurredAt: null, providerCallId: sid, metadata: { carrier_from: c.from_e164!, carrier_to: c.to_e164! } } as VoiceEvent);
    assert.notEqual(r.status, "UNMATCHED");
    assert.deepEqual(w.carrier.get(id), { sid, source: "NUMBER_PAIR_MATCH" });
    assert.equal(w.calls.get(id)!.carrier_call_sid, sid);
  });

  test("no live call between the numbers: unmatched, nothing recorded", async () => {
    const w = new P3World();
    const r = await ingestVoiceEvent(w.deps(), { provider: "twilio", type: "CALL_RINGING", dedupeKey: "x:ringing", occurredAt: null, providerCallId: `CA${"3".repeat(32)}`, metadata: { carrier_from: "+447700900111", carrier_to: "+447700900999" } } as VoiceEvent);
    assert.equal(r.status, "UNMATCHED");
    assert.equal(w.carrier.size, 0);
  });
});

describe("post-call: continuity, the agent's summary and the closing attribution", () => {
  async function answeredCall(w: P3World, agentTurns: string[]) {
    const id = await queued(w);
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    const fake = w.voice!.calls.get(pid)!;
    fake.transcript = [
      { role: "agent", content: "This is an AI assistant calling from Acme Studio.", startMs: 0, endMs: 3000 },
      { role: "user", content: "Yes, now is fine. We need a new website by March.", startMs: 3500, endMs: 7000 },
      ...agentTurns.map((t, i) => ({ role: "agent" as const, content: t, startMs: 8000 + i * 1000, endMs: 8500 + i * 1000 })),
    ];
    await ingestVoiceEvent(w.deps(), { ...ended(id, pid, "COMPLETED", 150), type: "CALL_ENDED" } as VoiceEvent);
    return id;
  }

  test("the agent's own summary wins, and the call joins the lead's shared memory", async () => {
    const w = new P3World();
    const closing = renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text;
    const id = await answeredCall(w, ["Great, I will send a booking link.", closing]);
    w.agentSummaries.set(id, { summary: "Needs a new site by March; wants a call with Jo.", disposition: "CONVERSATION", nextStep: "Jo to call on Thursday" });
    const r = await postProcessCall(w.deps(), { callId: id, providerSummary: "Provider summary." });
    assert.equal(r.status, "COMPLETE");
    assert.equal(w.outcomes.get(id)?.summary, "Needs a new site by March; wants a call with Jo.");
    assert.ok(w.nextActions.some((a) => /Agreed on the call: Jo to call on Thursday/.test(a)));
    assert.deepEqual(w.memoryNotes.at(-1), { callId: id, summary: "Needs a new site by March; wants a call with Jo.", nextStep: "Jo to call on Thursday" });
    assert.deepEqual(w.attribution.get(id), { spoken: true, closingVersion: CLOSING_VERSION });
  });

  test("attribution_spoken is false when the line was not said", async () => {
    const w = new P3World();
    const id = await answeredCall(w, ["Understood. We will not call you again."]);
    await postProcessCall(w.deps(), { callId: id });
    assert.equal(w.attribution.get(id)?.spoken, false);
  });

  test("the memory merge adds a dated call fact, the commitment and the objections, keeping earlier ones", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    const prev = { ...emptyMemory(now), facts: ["Budget: about £5k"], objections: [{ key: "TIMING", label: "Timing" }] };
    const note = buildCallMemoryNote({ endedAt: now.toISOString(), route: "BOOKING_CLOSE", disposition: "MEETING_BOOKED", summary: "Booked a call for Tuesday.", nextStep: "Tuesday 10am call", objectionKeys: ["PRICE", "TIMING"] });
    const m = mergeCallIntoMemory(prev, note, now);
    assert.deepEqual(m.facts, ["Budget: about £5k", "Phone booking call on 2026-09-28: Booked a call for Tuesday."]);
    assert.deepEqual(m.commitments, ["From the call: Tuesday 10am call"]);
    assert.deepEqual(m.objections.map((o) => o.key), ["TIMING", "PRICE"]);
    assert.equal(m.nextAction, "Tuesday 10am call");
  });
});

describe("§71: a missed call is followed by ONE text, and the retry call stays scheduled", () => {
  async function missed(w: P3World, id: string) {
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    await ingestVoiceEvent(w.deps(), ended(id, pid, "NO_ANSWER"));
    await postProcessCall(w.deps(), { callId: id });
    return planCallRetry(w.deps(), id);
  }

  test("first miss: an SMS through the ordinary send path, then the retry call", async () => {
    const w = new P3World();
    const id = await queued(w);
    const r = await missed(w, id);
    assert.equal(r.status, "RETRY_QUEUED");
    assert.equal((r as { followUp: string }).followUp, "SMS");
    assert.equal(w.texts.length, 1);
    assert.equal(w.texts[0].sendKey, `voice-missed:${id}`);
    assert.match(w.texts[0].body, /^Hi Priya, this is Acme Studio\. We tried to call you/);
    // Once per call: a replayed retry job sends nothing more.
    await planCallRetry(w.deps(), id);
    assert.equal(w.texts.length, 1);
  });

  test("second miss with an open WhatsApp window: WhatsApp", async () => {
    const w = new P3World();
    w.channelFacts = { ...w.channelFacts, sentSinceLastCall: ["SMS"], whatsappWindowOpen: true };
    const id = await queued(w);
    const r = await missed(w, id);
    assert.equal((r as { followUp: string }).followUp, "WHATSAPP");
    assert.equal(w.texts[0].channel, "WHATSAPP");
  });

  test("the frequency guard holds the text; the retry call is unaffected", async () => {
    const w = new P3World();
    w.channelFacts = { ...w.channelFacts, automatedSentAt: [new Date(w.now.getTime() - 60 * 60_000).toISOString()] };
    const id = await queued(w);
    const r = await missed(w, id);
    assert.equal(r.status, "RETRY_QUEUED");
    assert.equal(w.texts.length, 0);
  });
});

describe("P2 gap b: the subaccount's auth token is stored sealed", () => {
  test("created with the subaccount, and back-filled once for a subaccount made before", async () => {
    const w = new P3World();
    w.details = validDetails();
    await startProvisioning(w.deps(), BIZ);
    await provisionStep(w.deps(), BIZ);
    const stored = w.tokens.find((t) => t.token);
    assert.ok(stored, "a token was handed to the repo to seal");
    assert.match(stored!.token!, /^fake-token-/);
    // A second step does not fetch it again.
    const fetched = w.numbersProvider!.log.filter((l) => l.method === "subaccountAuthToken").length;
    await provisionStep(w.deps(), BIZ);
    assert.equal(w.numbersProvider!.log.filter((l) => l.method === "subaccountAuthToken").length, fetched);
  });
});

describe("OD-2: Pro checkout carries the £100 voice item by default", () => {
  const base = { planPriceId: "price_pro_m", voiceAddonPriceId: "price_voice" };
  test("monthly Pro: plan + voice; removable; Starter/Growth and annual: plan only", () => {
    assert.deepEqual(subscriptionCheckoutItems({ ...base, plan: "pro", interval: "month" }).items, [{ price: "price_pro_m", quantity: 1 }, { price: "price_voice", quantity: 1 }]);
    assert.equal(subscriptionCheckoutItems({ ...base, plan: "pro", interval: "month", includeVoice: false }).voiceUnavailableReason, "OPTED_OUT");
    assert.equal(subscriptionCheckoutItems({ ...base, plan: "growth", interval: "month" }).items.length, 1);
    assert.equal(subscriptionCheckoutItems({ ...base, plan: "pro", interval: "year" }).voiceUnavailableReason, "ANNUAL");
    assert.equal(subscriptionCheckoutItems({ ...base, plan: "pro", interval: "month", voiceAddonPriceId: null }).voiceUnavailableReason, "PRICE_NOT_CONFIGURED");
    assert.equal(includesVoiceByDefault("pro", "month"), true);
  });

  test("an upgrade to Pro adds the voice item once, and swaps only the plan item", () => {
    const up = planChangeItems({ planItemId: "si_plan", targetPriceId: "price_pro_m", targetPlan: "pro", interval: "month", existingPriceIds: ["price_growth_m"], voiceAddonPriceId: "price_voice" });
    assert.deepEqual(up.items, [{ id: "si_plan", price: "price_pro_m" }, { price: "price_voice", quantity: 1 }]);
    const again = planChangeItems({ planItemId: "si_plan", targetPriceId: "price_pro_m", targetPlan: "pro", interval: "month", existingPriceIds: ["price_growth_m", "price_voice"], voiceAddonPriceId: "price_voice" });
    assert.equal(again.voiceAdded, false);
    assert.equal(planChangeItems({ planItemId: "si_plan", targetPriceId: "price_pro_m", targetPlan: "pro", interval: "month", existingPriceIds: [], voiceAddonPriceId: "price_voice", includeVoice: false }).voiceAdded, false);
  });

  test("remove voice: only the voice item; the number is kept to the period end unless its own item is held", () => {
    const items = [
      { id: "si_plan", priceId: "price_pro_m", currentPeriodEnd: 1_790_000_000 },
      { id: "si_voice", priceId: "price_voice", currentPeriodEnd: 1_790_000_000 },
    ];
    const plan = voiceRemovalPlan({ plan: "pro", items, voiceAddonPriceId: "price_voice", numberPriceId: "price_number" });
    assert.deepEqual(plan, { ok: true, itemId: "si_voice", releaseNumberAt: new Date(1_790_000_000 * 1000).toISOString(), keepsNumber: false });
    const keeps = voiceRemovalPlan({ plan: "pro", items: [...items, { id: "si_num", priceId: "price_number", currentPeriodEnd: 1 }], voiceAddonPriceId: "price_voice", numberPriceId: "price_number" });
    assert.equal(keeps.ok && keeps.keepsNumber, true);
    assert.deepEqual(voiceRemovalPlan({ plan: "growth", items, voiceAddonPriceId: "price_voice", numberPriceId: null }), { ok: false, reason: "NOT_PRO" });
  });
});

// Keeps the type import used even if a future edit drops a test.
export type _Row = CallRow;
