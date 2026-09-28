/**
 * Inbound return calls (§25), over injected dependencies: pure orchestration,
 * tested with fakes. Two entry points share one decision (inbound.ts):
 *
 *   1. Twilio's voice webhook for the dedicated number (`answerTwilioInbound`).
 *      It must answer with TwiML at once, so it only READS the database:
 *        - AI_AGENT  -> `<Dial><Sip>` to the Retell SIP endpoint for the number,
 *                       which makes Retell raise its inbound-call webhook;
 *        - TRANSFER  -> `<Say>` then `<Dial>` the transfer number;
 *        - MESSAGE   -> `<Say>` and hang up; the text back is QUEUED as a job;
 *        - REJECT    -> "not in service" (a released/quarantined/unknown number).
 *   2. Retell's inbound-call webhook (`answerRetellInbound`). It re-runs the
 *      same decision on current state (entitlement can change between the two)
 *      and, only for AI_AGENT, creates the INBOUND call row on the RETURN_CALL
 *      route, reserves the minutes, and returns the agent, the locked greeting
 *      and the lead's context as dynamic variables. Anything else returns no
 *      agent, so the AI never answers a caller it may not.
 *
 * Neither request makes provider I/O (CLAUDE.md webhook rule): Twilio is
 * answered from the database, and Retell is answered with data.
 */

import { assertVoiceAllowed } from "./entitlement.ts";
import { buildEntitlementSnapshot } from "./snapshot.ts";
import { classifyDestination, normaliseE164 } from "./destinations.ts";
import { resolveInbound, type LeadPhone, type WorkspaceNumber } from "./numbers/sender.ts";
import { decideInbound, inboundTwiml, RETURN_CALL_ROUTE, type InboundDecision, type TransferMode } from "./inbound.ts";
import { DEFAULT_RESERVATION_SEC } from "./budget.ts";
import { reserveMinutes, MinuteStoreUnavailable } from "./minutes-core.ts";
import { identityAnswer, identityReadiness } from "./identity.ts";
import type { AdminControls, VoiceDeps } from "./runtime-core.ts";
import { adminVoiceBlocks } from "../admin/voice-ops-model.ts";

export type InboundLookups = {
  /** Every number record for the dialled e164 (sender.ts resolveInbound). */
  numbersFor(e164: string): Promise<WorkspaceNumber[]>;
  /** The workspace's leads with this phone number. */
  leadsByPhone(businessId: string, e164: string): Promise<LeadPhone[]>;
  /** Voice settings the inbound path reads (transfer mode is 0157's column). */
  settingsFor(businessId: string): Promise<{
    callingAsName: string | null;
    legalEntityName: string | null;
    identificationContact: string | null;
    personaName: string | null;
    recordingEnabled: boolean;
    transferMode: TransferMode;
    transferNumber: string | null;
    agentId: string | null;
  }>;
  /** The operator's controls (0158); absent = none. */
  adminControls?(businessId: string): Promise<AdminControls | null>;
  /** Stop conditions for a known lead. */
  leadFlags(businessId: string, leadId: string): Promise<{ optedOut: boolean; suppressed: boolean; anonymised: boolean; firstName: string | null }>;
};

export type InboundInput = { to: string; from: string | null };

async function decide(deps: VoiceDeps, look: InboundLookups, input: InboundInput, allowAi = true): Promise<{ decision: InboundDecision; settings: Awaited<ReturnType<InboundLookups["settingsFor"]>> | null; firstName: string | null }> {
  const now = deps.now();
  const to = normaliseE164(input.to);
  const numbers = to.ok ? await look.numbersFor(to.e164) : [];
  const live = numbers.find((n) => n.state === "ACTIVE" || n.state === "RELEASE_SCHEDULED" || n.state === "CONFIGURED");
  const from = input.from ? normaliseE164(input.from) : null;
  const leads = live && from && from.ok ? await look.leadsByPhone(live.businessId, from.e164) : [];
  const resolution = resolveInbound({ to: input.to, from: input.from, now, numbers, leads });
  if (resolution.kind === "UNROUTED") {
    return { decision: decideInbound({ resolution, entitlement: null, lead: null, settings: { callingAsName: null, recordingEnabled: false, transferMode: "NEVER", transferNumber: null }, aiReady: false, callerCanReceiveSms: false }), settings: null, firstName: null };
  }
  const [facts, settings, flags, controls] = await Promise.all([
    deps.repo.loadEntitlementFacts(resolution.businessId),
    look.settingsFor(resolution.businessId),
    resolution.leadId ? look.leadFlags(resolution.businessId, resolution.leadId) : Promise.resolve(null),
    look.adminControls ? look.adminControls(resolution.businessId) : Promise.resolve(null),
  ]);
  const adminBlocked =
    adminVoiceBlocks({
      direction: "INBOUND",
      killSwitch: Boolean(facts.settings?.admin_kill_switch) || facts.platformKill || deps.config.platformKill,
      outboundPaused: Boolean(controls?.outboundPaused),
      numberSuspended: Boolean(controls?.numberSuspended),
      spendLimitGbpMonth: controls?.spendLimitGbpMonth ?? null,
      spentGbpThisMonth: controls?.spentGbpThisMonth ?? 0,
    }).length > 0;
  const entitlement = assertVoiceAllowed(buildEntitlementSnapshot({ ...facts, platformKill: facts.platformKill || deps.config.platformKill }), {
    entryPoint: "INBOUND_ANSWER",
    requiredSec: DEFAULT_RESERVATION_SEC,
  });
  const aiReady = allowAi && Boolean(deps.providers().voice) && Boolean(settings.agentId ?? deps.config.defaultAgentId);
  const callerMobile = resolution.callerE164 ? classifyDestination(resolution.callerE164) === "UK_MOBILE" : false;
  const decision = decideInbound({
    resolution,
    entitlement,
    lead: flags,
    settings: { callingAsName: settings.callingAsName, recordingEnabled: settings.recordingEnabled, transferMode: settings.transferMode, transferNumber: settings.transferNumber },
    aiReady,
    callerCanReceiveSms: callerMobile,
    adminBlocked,
  });
  return { decision, settings, firstName: flags?.firstName ?? null };
}

async function queueTextBack(deps: VoiceDeps, decision: InboundDecision, from: string | null, callRef: string): Promise<void> {
  if (decision.kind !== "MESSAGE" || !decision.textBack || !decision.textBody || !from) return;
  await deps.enqueue(
    "voice.text_back",
    { businessId: decision.businessId, leadId: decision.leadId, to: from, body: decision.textBody },
    { businessId: decision.businessId, idempotencyKey: `voice.text_back:${callRef}` },
  );
}

/** Twilio: the TwiML to answer an inbound call with. Reads only; the text back is queued. */
export async function answerTwilioInbound(
  deps: VoiceDeps,
  look: InboundLookups,
  input: InboundInput & { callSid: string; retellSipDomain: string | null },
): Promise<{ decision: InboundDecision; twiml: string }> {
  // The AI path needs the SIP hand-off to Retell; without it, the caller gets
  // the same answer as when the AI is not connected (message or transfer).
  const { decision } = await decide(deps, look, input, Boolean(input.retellSipDomain));
  await queueTextBack(deps, decision, input.from, `twilio:${input.callSid}`);
  if (decision.kind !== "REJECT") {
    await deps.repo.audit({
      businessId: decision.businessId,
      action: "voice.inbound_answered",
      entityType: "voice_call",
      entityId: null,
      metadata: { handled_as: decision.kind, reason: "reason" in decision ? decision.reason : null, lead_id: decision.leadId ?? null },
    });
  }
  if (decision.kind === "AI_AGENT") {
    const to = normaliseE164(input.to);
    const target = `${to.ok ? to.e164 : input.to}@${input.retellSipDomain}`;
    return {
      decision,
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Sip>sip:${target.replace(/[<>&"]/g, "")}</Sip></Dial></Response>`,
    };
  }
  const to = normaliseE164(input.to);
  return { decision, twiml: inboundTwiml(decision, to.ok ? to.e164 : null) };
}

export type RetellInboundResponse = {
  call_inbound: {
    override_agent_id?: string;
    dynamic_variables?: Record<string, string>;
    metadata?: Record<string, string>;
  };
};

/**
 * Retell: the agent and context for an inbound call, or NO agent. Creates the
 * INBOUND call row (RETURN_CALL route) and reserves its minutes only when the
 * AI may answer. Idempotent per (from, to, minute): a redelivered webhook gets
 * the same call.
 */
export async function answerRetellInbound(
  deps: VoiceDeps,
  look: InboundLookups,
  input: InboundInput,
): Promise<{ decision: InboundDecision; response: RetellInboundResponse; callId: string | null }> {
  const { decision, settings, firstName } = await decide(deps, look, input);
  if (decision.kind !== "AI_AGENT" || !settings) {
    await queueTextBack(deps, decision, input.from, `retell:${input.from}:${input.to}:${Math.floor(deps.now().getTime() / 60000)}`);
    return { decision, response: { call_inbound: {} }, callId: null };
  }
  const now = deps.now();
  const from = input.from ? normaliseE164(input.from) : null;
  const to = normaliseE164(input.to);
  const callKey = `voice:inbound:${decision.businessId}:${from && from.ok ? from.e164 : "unknown"}:${Math.floor(now.getTime() / 60000)}`;

  let created;
  try {
    created = await deps.repo.insertCall({
      business_id: decision.businessId,
      lead_id: decision.leadId,
      direction: "INBOUND",
      route: RETURN_CALL_ROUTE,
      state: "RINGING",
      call_key: callKey,
      attempt_number: 1,
      consent_basis: null,
      to_e164: to.ok ? to.e164 : null,
      from_e164: from && from.ok ? from.e164 : null,
      destination_class: null,
      recipient_timezone: null,
      calling_as_name: settings.callingAsName,
      legal_entity_name: settings.legalEntityName,
      identification_contact: settings.identificationContact,
      persona_name: settings.personaName,
      opener_version: decision.greetingVersion,
      recording_enabled: settings.recordingEnabled,
      queued_at: now.toISOString(),
    });
  } catch {
    // Another live call to this lead (the one-active-call index), or the
    // route not yet accepted: no AI answer.
    return { decision, response: { call_inbound: {} }, callId: null };
  }

  try {
    const held = await reserveMinutes(deps.minutes, { businessId: decision.businessId, callId: created.row.id, route: RETURN_CALL_ROUTE, seconds: DEFAULT_RESERVATION_SEC });
    if (!held.ok) {
      await deps.repo.transitionCall(created.row.id, ["RINGING"], { state: "CANCELLED", outcome: "CANCELLED", disconnection_reason: "INSUFFICIENT_MINUTES", ended_at: now.toISOString() });
      return { decision, response: { call_inbound: {} }, callId: null };
    }
    await deps.repo.patchCall(created.row.id, { reserved_sec: held.reservation.heldSec });
  } catch (error) {
    if (!(error instanceof MinuteStoreUnavailable)) throw error;
    await deps.repo.transitionCall(created.row.id, ["RINGING"], { state: "CANCELLED", outcome: "CANCELLED", disconnection_reason: "MINUTES_UNAVAILABLE", ended_at: now.toISOString() });
    return { decision, response: { call_inbound: {} }, callId: null };
  }

  const identity = identityReadiness({
    callingAsName: settings.callingAsName,
    legalEntityName: settings.legalEntityName,
    identificationContact: settings.identificationContact,
    personaName: settings.personaName,
  });
  if (created.inserted) {
    await deps.repo.audit({
      businessId: decision.businessId,
      action: "voice.inbound_answered",
      entityType: "voice_call",
      entityId: created.row.id,
      metadata: { handled_as: "AI_AGENT", route: RETURN_CALL_ROUTE, lead_id: decision.leadId },
    });
  }
  // Voice P3: the RETURN_CALL brief, from the same context as a text turn.
  // A brief that cannot be built leaves the P2 variables: the caller still
  // hears the locked greeting and is helped politely.
  let briefVariables: Record<string, string> = {};
  if (deps.briefFor && identity.ready) {
    try {
      const ctx = await deps.repo.loadDialContext(decision.businessId, decision.leadId, RETURN_CALL_ROUTE, created.row.id);
      const brief = await deps.briefFor({
        call: created.row,
        ctx,
        identity: identity.identity,
        preamble: { version: decision.greetingVersion, opener: decision.greeting, recordingNotice: null, text: decision.greeting },
      });
      briefVariables = brief?.dynamicVariables ?? {};
    } catch {
      briefVariables = {};
    }
  }
  return {
    decision,
    callId: created.row.id,
    response: {
      call_inbound: {
        override_agent_id: (settings.agentId ?? deps.config.defaultAgentId) as string,
        dynamic_variables: {
          ...briefVariables,
          locked_preamble: decision.greeting,
          opener_version: decision.greetingVersion,
          calling_as_name: settings.callingAsName ?? "",
          identity_answer: identity.ready ? identityAnswer(identity.identity) : "",
          persona_name: settings.personaName ?? "",
          route: RETURN_CALL_ROUTE,
          direction: "INBOUND",
          lead_first_name: firstName ?? "",
        },
        metadata: { voice_call_id: created.row.id, business_id: decision.businessId, call_key: created.row.call_key, route: RETURN_CALL_ROUTE },
      },
    },
  };
}
