/**
 * The voice runtime's orchestration, over injected dependencies. No
 * `server-only`, no Supabase, no network: the jobs and the service operation
 * call these with the Supabase-backed deps (`voice/server-deps.ts`), and the
 * tests call them with in-memory fakes (providers/fake.ts), so every path that
 * can place a call is exercised without spending a penny.
 *
 *   requestCall          the manual "Call with AI", the retry job, an agent
 *   dialCall             voice.dial
 *   ingestVoiceEvent     voice.webhook_ingest
 *   postProcessCall      voice.post_call
 *   planCallRetry        voice.retry
 *   provisionStep        voice.number_provision
 *   scheduleNumberRelease voice.number_release
 *   fetchRecording       voice.recording_fetch
 *
 * The rules they share:
 *   - re-read current state before any external action (CLAUDE.md);
 *   - `decideDial` (entitlement + canCallLead + human-on + caller id +
 *     allocation + concurrency) runs on EVERY initiation path, so a trial,
 *     demo or free workspace can never dial;
 *   - only the transition QUEUED -> DIALLING (the 0157 RPC under the per-lead
 *     advisory lock, or the one-active-call unique index) grants the right to
 *     call the provider, and it is granted once: a double dial is impossible;
 *   - minutes are reserved before the dial and settled (to the second) or
 *     released exactly once after it, through the append-only ledger;
 *   - a missing provider key is `integration-required`, never an unhandled
 *     throw.
 */

import { decideDial, type DialDecision } from "./dial-decision.ts";
import { buildEntitlementSnapshot, callConsentFrom, phoneSourceOf, subscriberTypeOf, type EntitlementFacts, type PermissionRow } from "./snapshot.ts";
import { advisoryLockId, voiceCallKey, voiceLeadLockKey, type CanCallLeadInput, type ConsentBasis } from "./eligibility.ts";
import type { VoiceEntryPoint } from "./entitlement.ts";
import { parseCallingHoursConfig, type CallingHoursConfig, type UkRegion } from "./calling-hours.ts";
import { attributionSpoken, buildLockedPreamble, CLOSING_VERSION, OPENER_VERSION, renderClosingLine } from "./opener.ts";
import { identityAnswer, identityReadiness } from "./identity.ts";
import { reserveMinutes, settleMinutes, releaseMinutes, MinuteStoreUnavailable, type MinuteStore } from "./minutes-core.ts";
import { reduceVoiceEvent, callRefOf, type FollowUp } from "./ingest.ts";
import { analyseCall, type CallAnalysis } from "./post-call.ts";
import { callCostLines, type CostLine } from "./cost.ts";
import { planRetry, renderVoicemailScript, voicemailAllowed, VOICEMAIL_SCRIPT_VERSION, type DialOutcome } from "./retry-policy.ts";
import { PROVIDER_MAX_DURATION_SEC } from "./time-governor.ts";
import { isPremiumProfile, parseVoiceProfile, premiumBilledSec, PREMIUM_TTS_EXTRA_USD_PER_MIN, voiceAgentFields } from "./voice-profile.ts";
import { buildCallMemoryNote, type CallMemoryNote } from "./continuity.ts";
import { decideNextChannel, missedCallText, type ChannelDecision, type TextChannel } from "./channel-orchestration.ts";
import { DEFAULT_FREQUENCY_CAPS, evaluateFrequency } from "../reengagement/frequency.ts";
import type { CallerIdentity } from "./identity.ts";
import type { LockedPreamble } from "./opener.ts";
import { classifyDestination, type DestinationClass } from "./destinations.ts";
import { DEFAULT_PLATFORM_CONCURRENCY, DEFAULT_WORKSPACE_CONCURRENCY, type QueuePriority, type RouteAllocations } from "./budget.ts";
import {
  applyProvisioningEvent,
  runProvisioningStep,
  type ProvisioningRecord,
  type ProvisioningUrls,
  type StepLogEntry,
  type StepOutcome,
} from "./numbers/provisioning.ts";
import type { WorkspaceNumber } from "./numbers/sender.ts";
import type { CallState } from "./state-machine.ts";
import { adminVoiceBlocks, type AdminVoiceBlockReason } from "../admin/voice-ops-model.ts";
import {
  ProviderNotConfigured,
  ProviderRequestError,
  type CallOutcome,
  type NumberProvider,
  type ProviderCallDetails,
  type TelephonyProvider,
  type TranscriptTurn,
  type VoiceEvent,
  type VoiceProvider,
} from "./providers/types.ts";

/* =================================================================== rows */

export type CallRow = {
  id: string;
  business_id: string;
  lead_id: string;
  direction: "OUTBOUND" | "INBOUND";
  route: string;
  state: CallState;
  call_key: string;
  attempt_number: number;
  consent_basis: string | null;
  to_e164: string | null;
  from_e164: string | null;
  destination_class: string | null;
  recipient_timezone: string | null;
  calling_as_name: string | null;
  legal_entity_name: string | null;
  identification_contact: string | null;
  persona_name: string | null;
  opener_version: string | null;
  recording_enabled: boolean;
  provider: string | null;
  provider_call_id: string | null;
  carrier_call_sid: string | null;
  outcome: string | null;
  disconnection_reason: string | null;
  duration_sec: number | null;
  billed_sec: number | null;
  reserved_sec: number | null;
  voicemail_left: boolean;
  queued_at: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type NewCallRow = Omit<
  CallRow,
  | "id"
  | "created_at"
  | "provider"
  | "provider_call_id"
  | "carrier_call_sid"
  | "outcome"
  | "disconnection_reason"
  | "duration_sec"
  | "billed_sec"
  | "reserved_sec"
  | "voicemail_left"
  | "started_at"
  | "answered_at"
  | "ended_at"
> & {
  /** The agent that asked for this call (0176); omitted for every other caller. */
  requested_by_agent_id?: string | null;
};

export type VoiceSettingsRow = {
  voice_enabled: boolean;
  admin_kill_switch: boolean;
  calling_as_name: string | null;
  legal_entity_name: string | null;
  identification_contact: string | null;
  assistant_persona_name: string | null;
  opener_suffix: string | null;
  recording_enabled: boolean;
  recording_retention_days: number;
  voicemail_enabled: boolean;
  calling_hours: unknown;
  max_attempts: number;
  workspace_concurrency: number;
  transfer_number_e164: string | null;
  provider_agent_id: string | null;
  /** 0162: how the assistant sounds (voice-profile.ts). Absent = the Retell agent's own voice. */
  voice_profile?: unknown;
};

export type LeadRow = {
  id: string;
  business_id: string;
  first_name: string | null;
  phone: string | null;
  email: string | null;
  phone_source: string | null;
  timezone: string | null;
  uk_region: string | null;
  anonymised_at: string | null;
  opted_out: boolean;
  human_takeover: boolean;
  subscriber_type: string | null;
  qualification_state: string | null;
  source_submitted_at: string | null;
  created_at: string;
};

export type DialContext = {
  lead: LeadRow | null;
  permission: PermissionRow | null;
  /** On the suppression list for calls (VOICE or ALL). */
  suppressed: boolean;
  /** Opted out of calls only. */
  voiceOptedOut: boolean;
  settings: VoiceSettingsRow | null;
  number: WorkspaceNumber | null;
  workspaceTimezone: string | null;
  attempts: { total: number; last24h: number; lastAttemptAt: Date | null; routeTotal: number };
  /** Another call to this lead in an active state (excluding the one being dialled). */
  activeCallForLead: boolean;
  concurrency: { workspaceActive: number; platformActive: number };
  allocation: { allocations: RouteAllocations; periodTotalSec: number; usedByRouteSec: number; disabledRoutes: string[] } | null;
  /**
   * The platform operator's controls (0158): outbound pause, number
   * suspension and the monthly provider-spend ceiling. Absent = none set.
   */
  adminControls?: AdminControls | null;
};

export type AdminControls = {
  outboundPaused: boolean;
  numberSuspended: boolean;
  spendLimitGbpMonth: number | null;
  spentGbpThisMonth: number;
};

export const ADMIN_BLOCK_MESSAGES: Readonly<Record<AdminVoiceBlockReason, string>> = {
  ADMIN_KILL_SWITCH: "AI calling has been paused for this workspace by ClientTurn support.",
  ADMIN_OUTBOUND_PAUSED: "Outbound AI calls are paused for this workspace by ClientTurn support.",
  ADMIN_NUMBER_SUSPENDED: "Your calling number is suspended by ClientTurn support, so no AI calls can be made from it.",
  ADMIN_SPEND_LIMIT_REACHED: "This workspace has reached its monthly AI calling limit set by ClientTurn support.",
};

/** The operator's controls for an outbound call (kill switch is the entitlement gate's). */
export function adminOutboundBlocks(controls: AdminControls | null | undefined): AdminVoiceBlockReason[] {
  if (!controls) return [];
  return adminVoiceBlocks({
    direction: "OUTBOUND",
    killSwitch: false,
    outboundPaused: controls.outboundPaused,
    numberSuspended: controls.numberSuspended,
    spendLimitGbpMonth: controls.spendLimitGbpMonth,
    spentGbpThisMonth: controls.spentGbpThisMonth,
  });
}

export type BeginDialResult = "OK" | "NOT_FOUND" | "NOT_QUEUED" | "HUMAN_ACTIVE" | "LEAD_BUSY" | "WORKSPACE_FULL" | "PLATFORM_FULL";

export type EligibilityRecord = {
  businessId: string;
  leadId: string;
  voiceCallId: string | null;
  decision: "ALLOWED" | "DENIED";
  denials: string[];
  consentBasis: string | null;
  phoneType: string | null;
  phoneSource: string | null;
  subscriberType: string | null;
  tpsListed: boolean | null;
  ctpsListed: boolean | null;
  withinCallingHours: boolean | null;
  recipientTimezone: string | null;
  consentEvidence: Record<string, string>;
};

/** The jobs' audit vocabulary (mirrored in lib/audit.ts AuditAction). */
export type VoiceAuditAction =
  | "voice.call_queued"
  | "voice.call_placed"
  | "voice.call_cancelled"
  | "voice.call_completed"
  | "voice.pack_credited"
  | "number.activated"
  | "number.needs_attention"
  | "number.bundle_rejected"
  | "number.release_scheduled"
  | "voice.inbound_answered";

export type AuditEntry = {
  businessId: string;
  action: VoiceAuditAction;
  entityType: string;
  entityId: string | null;
  actorUserId?: string | null;
  metadata: Record<string, unknown>;
};

export type VoiceRepo = {
  loadCall(callId: string): Promise<CallRow | null>;
  findCallByProviderId(providerCallId: string): Promise<CallRow | null>;
  findCallByKey(businessId: string, callKey: string): Promise<CallRow | null>;
  /** Insert, or return the existing row with the same (business, call_key). */
  insertCall(row: NewCallRow): Promise<{ row: CallRow; inserted: boolean }>;
  /** Compare-and-swap on state: applies only when the call is in one of `from`. */
  transitionCall(callId: string, from: readonly CallState[], patch: Partial<CallRow>): Promise<CallRow | null>;
  /** Non-state columns (provider ids, durations). */
  patchCall(callId: string, patch: Partial<CallRow>): Promise<void>;
  loadEntitlementFacts(businessId: string): Promise<EntitlementFacts>;
  loadDialContext(businessId: string, leadId: string, route: string, excludeCallId: string | null): Promise<DialContext>;
  recordEligibility(row: EligibilityRecord): Promise<void>;
  beginDial(input: {
    callId: string;
    businessId: string;
    leadLockId: number;
    workspaceLockId: number;
    workspaceLimit: number;
    platformLimit: number;
    /** A person asked for this call: the takeover check is skipped (0177). */
    personRequested?: boolean;
  }): Promise<BeginDialResult>;
  queueCall(input: { callId: string; businessId: string; priority: QueuePriority; notBefore: Date }): Promise<void>;
  dequeueCall(callId: string): Promise<void>;
  /** Append-only, deduped on (provider, dedupe_key). False when already recorded. */
  insertCallEvent(row: {
    businessId: string;
    callId: string;
    provider: string;
    eventType: string;
    dedupeKey: string;
    occurredAt: string | null;
    applied: boolean;
    payload: Record<string, string | number | boolean | null>;
  }): Promise<boolean>;
  saveTranscript(input: { businessId: string; callId: string; segments: TranscriptTurn[]; retainUntil: string | null }): Promise<void>;
  saveOutcome(input: {
    businessId: string;
    callId: string;
    leadId: string;
    analysis: CallAnalysis;
    qualificationBefore: string | null;
    /** Voice P3: whether the closing attribution line was spoken (from the transcript), and its version. */
    attribution?: { spoken: boolean; closingVersion: string };
  }): Promise<void>;
  /** Inserts only the keys not already recorded for the call. */
  saveObjections(input: { businessId: string; leadId: string; callId: string; objections: CallAnalysis["objections"]; occurredAt: string }): Promise<void>;
  saveCostLines(input: { businessId: string; callId: string; lines: CostLine[]; occurredAt: string }): Promise<void>;
  /**
   * `scope` ALL ("take me off your list", speech-intents.ts): every channel
   * for this lead, not only calls. Absent reads as CALLS.
   */
  recordVoiceOptOut(input: { businessId: string; leadId: string; phone: string | null; callId: string; scope?: "CALLS" | "ALL" }): Promise<void>;
  /** Through the QI service: signals + a lead.score reassessment. */
  writeQualificationSignals(input: { businessId: string; leadId: string; callId: string; analysis: CallAnalysis; observedAt: string }): Promise<void>;
  saveRecording(input: {
    businessId: string;
    callId: string;
    provider: string;
    providerRecordingId: string | null;
    status: "PENDING_FETCH" | "STORED" | "FAILED";
    objectKey: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    durationSec: number | null;
    retainUntil: string | null;
  }): Promise<void>;
  loadRecording(callId: string): Promise<{ status: string; object_key: string | null } | null>;
  setLeadNextAction(input: { businessId: string; leadId: string; nextAction: string }): Promise<void>;
  /** Number provisioning. */
  loadNumberRecord(businessId: string): Promise<{ id: string; record: ProvisioningRecord } | null>;
  createNumberRecord(businessId: string): Promise<{ id: string; record: ProvisioningRecord }>;
  /** Saves when the stored version still equals `expectedVersion`. */
  saveNumberRecord(input: { id: string; record: ProvisioningRecord; expectedVersion: number }): Promise<boolean>;
  appendNumberEvents(input: { businessId: string; numberId: string; log: StepLogEntry[] }): Promise<void>;
  loadProvisioningDetails(businessId: string): Promise<unknown>;
  findNumberByBundle(bundleSid: string): Promise<{ id: string; businessId: string; record: ProvisioningRecord } | null>;
  quarantinedE164s(): Promise<Set<string>>;
  /** The subaccount, with its auth token sealed when one is given (P2 gap b). */
  upsertTelephonyAccount(input: { businessId: string; subaccountSid: string; authToken?: string | null }): Promise<void>;
  /** Whether a sealed subaccount token is already stored (voice P3). */
  telephonyTokenStored?(businessId: string): Promise<boolean>;
  notifyOwner(input: { businessId: string; title: string; body: string; dedupeKey: string; linkUrl: string }): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;

  /* ---- voice P3 (0162); optional so a store without them keeps working ---- */
  /** A voicemail was already left for this lead on this route (§26: once per request). */
  voicemailAlreadyLeft?(businessId: string, leadId: string, route: string): Promise<boolean>;
  /** What the dial planned: the brief version and the voicemail script version. */
  recordCallPlan?(callId: string, plan: { briefVersion: string | null; voicemailScriptVersion: string | null; premiumVoice?: boolean }): Promise<void>;
  loadCallPlan?(callId: string): Promise<{ briefVersion: string | null; voicemailScriptVersion: string | null; premiumVoice?: boolean } | null>;
  /** The assistant's own end_call_summary tool result, if it called it. */
  loadAgentSummary?(callId: string): Promise<{ summary: string; disposition: string; nextStep: string | null } | null>;
  /** Continuity: the call's note merged into the lead's shared opportunity memory. */
  recordCallMemory?(input: { businessId: string; leadId: string; callId: string; note: CallMemoryNote }): Promise<void>;
  /** Live calls between two numbers since a time (matching a carrier callback, 0162). */
  findLiveCallsByNumbers?(input: { fromE164: string; toE164: string; since: Date }): Promise<CallRow[]>;
  /** Record the carrier's call id on a call (idempotent: only when it is still empty). */
  recordCarrierCallSid?(callId: string, sid: string, source: "RETELL_TELEPHONY_ID" | "NUMBER_PAIR_MATCH"): Promise<void>;
  /** Channel orchestration facts for a missed call (§71): touches, texts since the call, WhatsApp window. */
  loadChannelFacts?(input: { businessId: string; leadId: string; since: Date }): Promise<ChannelFacts>;
  /** One follow-up text through the ordinary send path (guards, quiet hours, suppression, the conversation). */
  queueFollowUpText?(input: { businessId: string; leadId: string; channel: TextChannel; body: string; sendKey: string }): Promise<boolean>;
};

export type ChannelFacts = {
  /** Automated touches' send times (the frequency guard's input). */
  automatedSentAt: string[];
  touchesSinceEngagement: number;
  intentState: string | null;
  preferredChannel: "phone" | "sms" | "whatsapp" | "email" | null;
  /** Texts already sent since the call ended (V5 sequence). */
  sentSinceLastCall: TextChannel[];
  /** WhatsApp's 24-hour customer-care window is open (a free-form message is lawful). */
  whatsappWindowOpen: boolean;
};

/** What the call brief builder is given at dial time (voice P3). */
export type BriefRequest = {
  call: CallRow;
  ctx: DialContext;
  identity: CallerIdentity;
  preamble: LockedPreamble;
};

export type VoiceProviders = {
  voice: VoiceProvider | null;
  telephony: TelephonyProvider | null;
  numbers: NumberProvider | null;
};

export type EnqueueFn = (
  type: "voice.dial" | "voice.post_call" | "voice.recording_fetch" | "voice.retry" | "voice.number_provision" | "voice.number_release" | "voice.text_back",
  payload: Record<string, unknown>,
  options: { businessId: string; runAt?: Date; idempotencyKey: string; priority?: number },
) => Promise<void>;

export type RecordingStorage = {
  /** Download a provider recording (a short-lived provider URL). */
  fetch(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  sha256(bytes: Uint8Array): string;
};

export type VoiceDeps = {
  now(): Date;
  repo: VoiceRepo;
  minutes: MinuteStore;
  providers(): VoiceProviders;
  enqueue: EnqueueFn;
  storage?: RecordingStorage;
  /**
   * Voice P3: the per-call brief (call-brief.ts) as Retell dynamic variables,
   * built from the same strategy, NBA, facts, offer and objections as a text
   * turn. Absent or null: the P2 variables only (the agent still speaks the
   * locked opener).
   */
  briefFor?(input: BriefRequest): Promise<{ version: string; dynamicVariables: Record<string, string> } | null>;
  /**
   * Platform maintenance (docs/MAINTENANCE.md): when outbound work is held,
   * until when. A dial is re-scheduled for after the window, never dropped.
   * Absent or null: not held.
   */
  maintenancePauseUntil?(): Promise<Date | null>;
  config: {
    /** Platform-wide default Retell agent (RETELL_AGENT_ID); a workspace may override. */
    defaultAgentId: string | null;
    platformConcurrency?: number;
    platformKill: boolean;
    provisioningUrls: ProvisioningUrls | null;
  };
};

/* ============================================================== helpers */

const MINUTE = 60_000;
export const DIAL_STALE_AFTER_MS = 10 * MINUTE;
/** States a call may be post-processed from (state-machine.ts: each may go to POST_PROCESSING). */
const ENDED_STATES: readonly CallState[] = ["ENDED", "NO_ANSWER", "BUSY", "FAILED", "VOICEMAIL"];
const LIVE_STATES: readonly CallState[] = ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"];

function callingHoursOf(settings: VoiceSettingsRow | null): CallingHoursConfig | undefined {
  if (!settings?.calling_hours) return undefined;
  const parsed = parseCallingHoursConfig(settings.calling_hours);
  return parsed.ok ? parsed.config : undefined;
}

function ukRegionOf(value: string | null): UkRegion | null {
  return value === "ENGLAND_AND_WALES" || value === "SCOTLAND" || value === "NORTHERN_IRELAND" ? value : null;
}

/** Everything `canCallLead` needs from the context, minus what decideDial adds. */
export function eligibilityInputOf(ctx: DialContext): Omit<CanCallLeadInput, "now" | "callKind" | "entitlement" | "activeCall"> {
  const consent = callConsentFrom(ctx.permission);
  return {
    lead: {
      phone: ctx.lead?.phone ?? null,
      phoneSource: phoneSourceOf(ctx.lead?.phone_source),
      timezone: ctx.lead?.timezone ?? null,
      ukRegion: ukRegionOf(ctx.lead?.uk_region ?? null),
      anonymised: Boolean(ctx.lead?.anonymised_at),
      suppressed: ctx.suppressed,
      optedOut: Boolean(ctx.lead?.opted_out),
      voiceOptedOut: ctx.voiceOptedOut,
      subscriberType: subscriberTypeOf(ctx.permission?.subscriber_type ?? ctx.lead?.subscriber_type),
      tpsListed: ctx.permission?.tps_listed ?? null,
      ctpsListed: ctx.permission?.ctps_listed ?? null,
    },
    consent: { basis: consent.basis, capturedAt: consent.capturedAt, withdrawn: consent.withdrawn, evidenceText: consent.evidenceText },
    attempts: { total: ctx.attempts.total, last24h: ctx.attempts.last24h, lastAttemptAt: ctx.attempts.lastAttemptAt },
    caps: ctx.settings ? { maxAttemptsTotal: ctx.settings.max_attempts } : undefined,
    workspace: { timezone: ctx.workspaceTimezone, callingHours: callingHoursOf(ctx.settings) },
  };
}

/**
 * `personRequested`: a signed-in person pressed "Call with AI" for this lead.
 * The human-takeover hold exists so the AI does not call a lead a person is
 * working; a person asking for the call is that person, so it does not apply.
 * Every other check (entitlement, consent, calling hours, opt-outs, caps,
 * minutes) still does. Automated, agent and retry calls never set it.
 */
function decide(
  deps: VoiceDeps,
  facts: EntitlementFacts,
  ctx: DialContext,
  call: CallRow | null,
  route: string,
  entryPoint: VoiceEntryPoint,
  personRequested = false,
): DialDecision {
  // The operator's controls first: an outbound pause, a suspended number or a
  // reached spend ceiling stops every AI dial, whoever asked for it.
  const blocks = adminOutboundBlocks(ctx.adminControls);
  if (blocks.length) {
    return { kind: "CANCEL", reason: blocks[0], reasons: blocks, productState: "error", message: ADMIN_BLOCK_MESSAGES[blocks[0]] };
  }
  if (ctx.allocation?.disabledRoutes.includes(route)) {
    return { kind: "CANCEL", reason: "ROUTE_DISABLED", reasons: ["ROUTE_DISABLED"], productState: "integration-required", message: "This call route is switched off in Settings, Voice." };
  }
  return decideDial({
    now: deps.now(),
    entryPoint,
    call: call ? { state: call.state, route: call.route, attemptNumber: call.attempt_number } : null,
    entitlement: buildEntitlementSnapshot({ ...facts, platformKill: facts.platformKill || deps.config.platformKill }),
    eligibility: eligibilityInputOf(ctx),
    activeCallForLead: ctx.activeCallForLead,
    humanTakeover: Boolean(ctx.lead?.human_takeover) && !personRequested,
    number: ctx.number,
    concurrency: {
      workspaceActive: ctx.concurrency.workspaceActive,
      platformActive: ctx.concurrency.platformActive,
      workspaceLimit: ctx.settings?.workspace_concurrency ?? DEFAULT_WORKSPACE_CONCURRENCY,
      platformLimit: deps.config.platformConcurrency ?? DEFAULT_PLATFORM_CONCURRENCY,
    },
    allocation: ctx.allocation ? { allocations: ctx.allocation.allocations, periodTotalSec: ctx.allocation.periodTotalSec, usedByRouteSec: ctx.allocation.usedByRouteSec } : null,
  });
}

function eligibilityRecord(businessId: string, leadId: string, callId: string | null, ctx: DialContext, decision: DialDecision): EligibilityRecord {
  const consent = callConsentFrom(ctx.permission);
  const denials =
    decision.kind === "CANCEL" ? decision.reasons : decision.kind === "DEFER" ? [decision.reason] : [];
  const phone = ctx.lead?.phone ?? null;
  let phoneType: DestinationClass | null = null;
  if (decision.kind === "DIAL") phoneType = decision.destinationClass as DestinationClass;
  else if (phone && phone.startsWith("+")) phoneType = classifyDestination(phone);
  return {
    businessId,
    leadId,
    voiceCallId: callId,
    decision: decision.kind === "DIAL" ? "ALLOWED" : "DENIED",
    denials: denials.length ? denials : decision.kind === "DIAL" ? [] : ["UNKNOWN"],
    consentBasis: consent.basis,
    phoneType,
    phoneSource: ctx.lead?.phone_source ?? null,
    subscriberType: ctx.permission?.subscriber_type ?? ctx.lead?.subscriber_type ?? null,
    tpsListed: ctx.permission?.tps_listed ?? null,
    ctpsListed: ctx.permission?.ctps_listed ?? null,
    withinCallingHours: decision.kind === "DEFER" ? decision.reason !== "OUTSIDE_CALLING_HOURS" : decision.kind === "DIAL" ? true : null,
    recipientTimezone: decision.kind === "DIAL" ? decision.timezone : ctx.lead?.timezone ?? null,
    consentEvidence: consent.evidenceText ? { wording: consent.evidenceText.slice(0, 2000) } : {},
  };
}

function priorityFor(route: string, basis: string | null, entryPoint: VoiceEntryPoint): QueuePriority {
  if (entryPoint === "CALLBACK") return "INBOUND_CALLBACK";
  if (basis === "CALL_REQUESTED") return "CALL_REQUESTED_FRESH";
  switch (route) {
    case "BOOKING_CLOSE":
      return "BOOKING_CLOSE";
    case "DIRECT_CLOSE":
      return "DIRECT_CLOSE";
    case "NURTURE":
      return "NURTURE";
    case "REACTIVATION":
      return "REACTIVATION";
    default:
      return "QUALIFICATION";
  }
}

function providerConfigured(p: VoiceProviders): boolean {
  return p.voice !== null;
}

/* ========================================================== requestCall */

export type RequestCallInput = {
  businessId: string;
  leadId: string;
  route: "QUALIFICATION" | "BOOKING_CLOSE" | "DIRECT_CLOSE" | "NURTURE" | "REACTIVATION";
  entryPoint: VoiceEntryPoint;
  requestedBy: string | null;
  /** A retry of an earlier call: its attempt number and when to dial. */
  attemptNumber?: number;
  notBefore?: Date | null;
  /**
   * The agent that asked (caller AGENT, "Phone leads with AI", 0176). Set only
   * by the voice.request_call handler after its agent checks; never a person,
   * so it never skips the human-takeover hold.
   */
  requestedByAgentId?: string | null;
};

export type RequestCallResult =
  | { ok: true; callId: string; scheduledFor: string; deferredReason: string | null; existing: boolean }
  | { ok: false; code: "PLAN_LIMIT" | "POLICY_BLOCKED" | "UNAVAILABLE" | "NOT_FOUND"; productState: string; reason: string; reasons: string[]; message: string };

export async function requestCall(deps: VoiceDeps, input: RequestCallInput): Promise<RequestCallResult> {
  if (!providerConfigured(deps.providers())) {
    return {
      ok: false,
      code: "UNAVAILABLE",
      productState: "integration-required",
      reason: "PROVIDER_NOT_CONFIGURED",
      reasons: ["PROVIDER_NOT_CONFIGURED"],
      message: "AI calling isn't connected on this environment yet.",
    };
  }
  const [facts, ctx] = await Promise.all([
    deps.repo.loadEntitlementFacts(input.businessId),
    deps.repo.loadDialContext(input.businessId, input.leadId, input.route, null),
  ]);
  if (!ctx.lead || ctx.lead.business_id !== input.businessId) {
    return { ok: false, code: "NOT_FOUND", productState: "error", reason: "LEAD_NOT_FOUND", reasons: ["LEAD_NOT_FOUND"], message: "That lead could not be found." };
  }

  // A person pressing "Call with AI" (the app, signed in); not MCP, API,
  // an agent or a retry.
  const personRequested = input.entryPoint === "OUTBOUND_DIAL" && Boolean(input.requestedBy) && !input.attemptNumber && !input.requestedByAgentId;
  const decision = decide(deps, facts, ctx, null, input.route, input.entryPoint, personRequested);
  if (decision.kind === "CANCEL" || decision.kind === "SKIP") {
    if (decision.kind === "CANCEL") {
      await deps.repo.recordEligibility(eligibilityRecord(input.businessId, input.leadId, null, ctx, decision));
      return {
        ok: false,
        code: decision.productState === "plan-limit-reached" ? "PLAN_LIMIT" : decision.productState === "error" || decision.productState === "integration-required" ? "UNAVAILABLE" : "POLICY_BLOCKED",
        productState: decision.productState,
        reason: decision.reason,
        reasons: decision.reasons,
        message: decision.message,
      };
    }
    return { ok: false, code: "UNAVAILABLE", productState: "error", reason: "NOT_QUEUED", reasons: ["NOT_QUEUED"], message: "That call is already under way." };
  }

  const now = deps.now();
  const attemptNumber = input.attemptNumber ?? Math.min(5, ctx.attempts.routeTotal + 1);
  const callKey = voiceCallKey(input.businessId, input.leadId, input.route, attemptNumber);
  const settings = ctx.settings;
  const consent = callConsentFrom(ctx.permission);
  let notBefore =
    decision.kind === "DEFER" ? decision.runAt : input.notBefore && input.notBefore.getTime() > now.getTime() ? input.notBefore : now;
  // Platform maintenance holds outbound calls like texts: the call is booked
  // for after the window (and re-checked at dial time), never dropped.
  const held = await maintenanceHold(deps);
  const heldForMaintenance = Boolean(held && held.getTime() > notBefore.getTime());
  if (held && heldForMaintenance) notBefore = held;

  const { row, inserted } = await deps.repo.insertCall({
    business_id: input.businessId,
    lead_id: input.leadId,
    direction: "OUTBOUND",
    route: input.route,
    state: "QUEUED",
    call_key: callKey,
    attempt_number: attemptNumber,
    consent_basis: consent.basis,
    to_e164: decision.kind === "DIAL" ? decision.e164 : ctx.lead.phone,
    from_e164: decision.kind === "DIAL" ? decision.callerId : ctx.number?.e164 ?? null,
    destination_class: decision.kind === "DIAL" ? decision.destinationClass : null,
    recipient_timezone: decision.kind === "DIAL" ? decision.timezone : ctx.lead.timezone,
    calling_as_name: settings?.calling_as_name ?? null,
    legal_entity_name: settings?.legal_entity_name ?? null,
    identification_contact: settings?.identification_contact ?? null,
    persona_name: settings?.assistant_persona_name ?? null,
    opener_version: OPENER_VERSION,
    recording_enabled: Boolean(settings?.recording_enabled),
    queued_at: now.toISOString(),
    // Only when an agent asked, so a workspace without 0176 is unaffected.
    ...(input.requestedByAgentId ? { requested_by_agent_id: input.requestedByAgentId } : {}),
  });

  if (inserted) {
    await deps.repo.recordEligibility(eligibilityRecord(input.businessId, input.leadId, row.id, ctx, decision));
    await deps.repo.queueCall({ callId: row.id, businessId: input.businessId, priority: priorityFor(input.route, consent.basis, input.entryPoint), notBefore });
    await deps.enqueue("voice.dial", { callId: row.id, ...(personRequested ? { personRequested: true } : {}) }, { businessId: input.businessId, runAt: notBefore, idempotencyKey: `voice.dial:${row.id}`, priority: 20 });
    await deps.repo.audit({
      businessId: input.businessId,
      action: "voice.call_queued",
      entityType: "voice_call",
      entityId: row.id,
      actorUserId: input.requestedBy,
      metadata: {
        lead_id: input.leadId,
        route: input.route,
        attempt: attemptNumber,
        entry_point: input.entryPoint,
        not_before: notBefore.toISOString(),
        ...(input.requestedByAgentId ? { agent_id: input.requestedByAgentId } : {}),
      },
    });
  }
  return {
    ok: true,
    callId: row.id,
    scheduledFor: (row.queued_at && !inserted ? row.queued_at : notBefore.toISOString()),
    deferredReason: heldForMaintenance ? "MAINTENANCE_WINDOW" : decision.kind === "DEFER" ? decision.reason : null,
    existing: !inserted,
  };
}

/** When platform maintenance holds outbound work, until when (fail open: an unreadable state holds nothing). */
async function maintenanceHold(deps: VoiceDeps): Promise<Date | null> {
  if (!deps.maintenancePauseUntil) return null;
  try {
    const until = await deps.maintenancePauseUntil();
    return until && until.getTime() > deps.now().getTime() ? until : null;
  } catch {
    return null;
  }
}

/* ============================================================= dialCall */

export type DialResult =
  | { status: "DIALLED"; providerCallId: string }
  | { status: "SKIPPED"; reason: string }
  | { status: "DEFERRED"; reason: string; runAt: string }
  | { status: "CANCELLED"; reason: string; productState: string }
  | { status: "FAILED"; reason: string };

export async function dialCall(deps: VoiceDeps, callId: string, opts: { personRequested?: boolean } = {}): Promise<DialResult> {
  const personRequested = Boolean(opts.personRequested);
  // 1. Re-read. A call that has left the queue is never dialled again.
  const call = await deps.repo.loadCall(callId);
  if (!call) return { status: "SKIPPED", reason: "NOT_FOUND" };
  if (call.state !== "QUEUED") {
    // A dial that won DIALLING but crashed before the provider answered is
    // closed as FAILED once stale (the provider id is unknown, so it is never
    // re-dialled); the post-call job releases its minutes.
    if (call.state === "DIALLING" && !call.provider_call_id && deps.now().getTime() - Date.parse(call.started_at ?? call.created_at) > DIAL_STALE_AFTER_MS) {
      await failCall(deps, call, "DIAL_OUTCOME_UNKNOWN");
    }
    return { status: "SKIPPED", reason: `STATE_${call.state}` };
  }

  // Platform maintenance (APP_OFFLINE / SITE_OFFLINE without "keep automated
  // follow-up running"): re-scheduled for after the window, never dropped.
  const held = await maintenanceHold(deps);
  if (held) return deferCall(deps, call, "MAINTENANCE_WINDOW", held, personRequested);

  const providers = deps.providers();
  if (!providers.voice) return cancelCall(deps, call, "PROVIDER_NOT_CONFIGURED", "integration-required", null);

  // 2. The full decision, again, immediately before dialling.
  const [facts, ctx] = await Promise.all([
    deps.repo.loadEntitlementFacts(call.business_id),
    deps.repo.loadDialContext(call.business_id, call.lead_id, call.route, call.id),
  ]);
  if (!ctx.lead) return cancelCall(deps, call, "LEAD_NOT_FOUND", "error", ctx);
  const decision = decide(deps, facts, ctx, call, call.route, "OUTBOUND_DIAL", personRequested);
  if (decision.kind === "SKIP") return { status: "SKIPPED", reason: decision.reason };
  if (decision.kind === "CANCEL") {
    await deps.repo.recordEligibility(eligibilityRecord(call.business_id, call.lead_id, call.id, ctx, decision));
    return cancelCall(deps, call, decision.reason, decision.productState, ctx);
  }
  if (decision.kind === "DEFER") return deferCall(deps, call, decision.reason, decision.runAt, personRequested);

  // 3. Minutes: hold the full call before dialling (included first, then packs).
  let reserved;
  try {
    reserved = await reserveMinutes(deps.minutes, { businessId: call.business_id, callId: call.id, route: call.route, seconds: decision.requiredSec });
  } catch (error) {
    if (error instanceof MinuteStoreUnavailable) return cancelCall(deps, call, "MINUTES_UNAVAILABLE", "integration-required", ctx);
    throw error;
  }
  if (!reserved.ok) {
    if (reserved.reason === "CONTENDED") return deferCall(deps, call, "MINUTES_CONTENDED", new Date(deps.now().getTime() + MINUTE), personRequested);
    return cancelCall(deps, call, reserved.reason === "INSUFFICIENT_BALANCE" ? "INSUFFICIENT_MINUTES" : reserved.reason, "plan-limit-reached", ctx);
  }

  // 4. The one transition that grants the right to dial: per-lead advisory
  //    lock, no human on, no other live call to the lead, a concurrency slot.
  const begun = await deps.repo.beginDial({
    callId: call.id,
    businessId: call.business_id,
    leadLockId: advisoryLockId(voiceLeadLockKey(call.business_id, call.lead_id)),
    workspaceLockId: advisoryLockId(`voice:workspace:${call.business_id}`),
    workspaceLimit: ctx.settings?.workspace_concurrency ?? DEFAULT_WORKSPACE_CONCURRENCY,
    platformLimit: deps.config.platformConcurrency ?? DEFAULT_PLATFORM_CONCURRENCY,
    personRequested,
  });
  if (begun === "NOT_QUEUED" || begun === "NOT_FOUND") {
    // Another run of this job won the transition and holds this reservation.
    return { status: "SKIPPED", reason: begun };
  }
  if (begun !== "OK") {
    // Keep the hold: the call is still queued and will be dialled shortly.
    const wait = begun === "HUMAN_ACTIVE" ? 30 * MINUTE : MINUTE;
    return deferCall(deps, call, begun, new Date(deps.now().getTime() + wait), personRequested);
  }
  await deps.repo.dequeueCall(call.id);

  // 5. Dial, exactly once.
  const settings = ctx.settings;
  const agentId = settings?.provider_agent_id ?? deps.config.defaultAgentId;
  if (!agentId) {
    await failCall(deps, { ...call, state: "DIALLING" }, "AGENT_NOT_CONFIGURED");
    return { status: "FAILED", reason: "AGENT_NOT_CONFIGURED" };
  }
  const identity = identityReadiness({
    callingAsName: call.calling_as_name ?? settings?.calling_as_name,
    legalEntityName: call.legal_entity_name ?? settings?.legal_entity_name,
    identificationContact: call.identification_contact ?? settings?.identification_contact,
    personaName: call.persona_name ?? settings?.assistant_persona_name,
  });
  if (!identity.ready) {
    await failCall(deps, { ...call, state: "DIALLING" }, "IDENTITY_INCOMPLETE");
    return { status: "FAILED", reason: "IDENTITY_INCOMPLETE" };
  }
  const now = deps.now();
  const enquiryAt = new Date(ctx.lead.source_submitted_at ?? ctx.lead.created_at);
  const preamble = buildLockedPreamble({
    callingAsName: identity.identity.callingAsName,
    enquiryAt,
    now,
    timezone: decision.timezone,
    recordingEnabled: call.recording_enabled,
  });

  // Voice P3: the call brief (the same plan a text turn gets, for speech) and
  // the voicemail plan (§26). A brief that cannot be built is not a reason to
  // fail the call: the agent still speaks the locked opener and the general
  // prompt's default tells it to end politely without a plan.
  let brief: { version: string; dynamicVariables: Record<string, string> } | null = null;
  if (deps.briefFor) {
    try {
      brief = await deps.briefFor({ call, ctx, identity: identity.identity, preamble });
    } catch {
      brief = null;
    }
  }
  const voicemail = await planVoicemail(deps, call, ctx, { timezone: decision.timezone, now, enquiryAt, callingAsName: identity.identity.callingAsName });
  // How the assistant sounds: the workspace's profile (a premium voice only
  // with the surcharge accepted, which marks the call premium).
  const profile = parseVoiceProfile(settings?.voice_profile);
  const premiumVoice = isPremiumProfile(profile);
  if (deps.repo.recordCallPlan) {
    try {
      await deps.repo.recordCallPlan(call.id, { briefVersion: brief?.version ?? null, voicemailScriptVersion: voicemail ? VOICEMAIL_SCRIPT_VERSION : null, premiumVoice });
    } catch {
      // Before 0162 the columns do not exist; the plan is also in the audit row.
    }
  }

  try {
    const started = await providers.voice.startOutboundCall({
      fromNumber: decision.callerId,
      toNumber: decision.e164,
      agentId,
      callKey: call.call_key,
      metadata: { voice_call_id: call.id, business_id: call.business_id, call_key: call.call_key, route: call.route },
      dynamicVariables: {
        ...(brief?.dynamicVariables ?? {}),
        locked_preamble: preamble.text,
        opener_version: preamble.version,
        calling_as_name: identity.identity.callingAsName,
        identity_answer: identityAnswer(identity.identity),
        persona_name: identity.identity.personaName ?? "",
        opener_suffix: settings?.opener_suffix ?? "",
        route: call.route,
        lead_first_name: ctx.lead.first_name ?? "",
      },
      overrides: {
        // The time governor's absolute ceiling: budget plus both extensions.
        maxCallDurationMs: PROVIDER_MAX_DURATION_SEC * 1000,
        voicemail: voicemail ? { mode: "STATIC_TEXT", text: voicemail } : { mode: "HANG_UP" },
        voice: voiceAgentFields(profile),
      },
    });
    await deps.repo.patchCall(call.id, {
      provider: providers.voice.name,
      provider_call_id: started.providerCallId,
      reserved_sec: reserved.reservation.heldSec,
      to_e164: decision.e164,
      from_e164: decision.callerId,
      recipient_timezone: decision.timezone,
      destination_class: decision.destinationClass,
    });
    await deps.repo.audit({
      businessId: call.business_id,
      action: "voice.call_placed",
      entityType: "voice_call",
      entityId: call.id,
      metadata: {
        lead_id: call.lead_id,
        route: call.route,
        attempt: call.attempt_number,
        provider: providers.voice.name,
        reserved_sec: reserved.reservation.heldSec,
        brief_version: brief?.version ?? null,
        voicemail_script_version: voicemail ? VOICEMAIL_SCRIPT_VERSION : null,
        premium_voice: premiumVoice,
      },
    });
    return { status: "DIALLED", providerCallId: started.providerCallId };
  } catch (error) {
    const reason =
      error instanceof ProviderNotConfigured
        ? "PROVIDER_NOT_CONFIGURED"
        : error instanceof ProviderRequestError
          ? `PROVIDER_${error.status}${error.permanent ? "_PERMANENT" : ""}`
          : "PROVIDER_ERROR";
    // The provider refused before any call existed: closed as FAILED (never
    // re-dialled here); the post-call job releases the hold and plans a retry.
    await failCall(deps, { ...call, state: "DIALLING" }, reason);
    return { status: "FAILED", reason };
  }
}

async function cancelCall(deps: VoiceDeps, call: CallRow, reason: string, productState: string, ctx: DialContext | null): Promise<DialResult> {
  const updated = await deps.repo.transitionCall(call.id, ["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED"], {
    state: "CANCELLED",
    outcome: "CANCELLED",
    disconnection_reason: reason.slice(0, 120),
    ended_at: deps.now().toISOString(),
  });
  await deps.repo.dequeueCall(call.id);
  // A hold taken by an earlier run of this job is returned.
  try {
    await releaseMinutes(deps.minutes, { businessId: call.business_id, callId: call.id, route: call.route });
  } catch (error) {
    if (!(error instanceof MinuteStoreUnavailable)) throw error;
  }
  if (updated) {
    await deps.repo.audit({
      businessId: call.business_id,
      action: "voice.call_cancelled",
      entityType: "voice_call",
      entityId: call.id,
      metadata: { lead_id: call.lead_id, reason, product_state: productState, had_context: Boolean(ctx) },
    });
  }
  return { status: "CANCELLED", reason, productState };
}

async function deferCall(deps: VoiceDeps, call: CallRow, reason: string, runAt: Date, personRequested = false): Promise<DialResult> {
  await deps.repo.queueCall({ callId: call.id, businessId: call.business_id, priority: priorityFor(call.route, call.consent_basis, "OUTBOUND_DIAL"), notBefore: runAt });
  await deps.enqueue("voice.dial", { callId: call.id, ...(personRequested ? { personRequested: true } : {}) }, {
    businessId: call.business_id,
    runAt,
    idempotencyKey: `voice.dial:${call.id}:${runAt.toISOString()}`,
    priority: 20,
  });
  return { status: "DEFERRED", reason, runAt: runAt.toISOString() };
}

/**
 * The voicemail to leave if the call reaches one (§26), decided before the
 * dial because Retell leaves it itself (agent_override voicemail_option).
 * Only when the workspace turned voicemail on, the consent basis supports an
 * automated message (CALL_REQUESTED or FORM_CONSENT_TO_CALL), and none was
 * left for this request yet. The script is fixed and versioned
 * (retry-policy.ts); what it promises next is what the retry policy will do.
 */
export async function planVoicemail(
  deps: VoiceDeps,
  call: CallRow,
  ctx: DialContext,
  input: { timezone: string; now: Date; enquiryAt: Date; callingAsName: string },
): Promise<string | null> {
  let alreadyLeft = false;
  if (deps.repo.voicemailAlreadyLeft) {
    try {
      alreadyLeft = await deps.repo.voicemailAlreadyLeft(call.business_id, call.lead_id, call.route);
    } catch {
      alreadyLeft = true; // unreadable: never risk a second voicemail
    }
  }
  const allowed = voicemailAllowed({
    enabled: Boolean(ctx.settings?.voicemail_enabled),
    alreadyLeftForThisRequest: alreadyLeft || call.voicemail_left,
    consentBasis: (call.consent_basis as ConsentBasis | null) ?? "PHONE_NUMBER_PROVIDED",
  });
  if (!allowed) return null;
  const maxAttempts = ctx.settings?.max_attempts ?? 3;
  const phone = call.to_e164 ?? ctx.lead?.phone ?? "";
  const followUp =
    call.attempt_number < maxAttempts
      ? "CALL_AGAIN"
      : phone.startsWith("+") && classifyDestination(phone) === "UK_MOBILE"
        ? "SMS"
        : ctx.lead?.email
          ? "EMAIL"
          : null;
  return renderVoicemailScript({ callingAsName: input.callingAsName, enquiryAt: input.enquiryAt, now: input.now, timezone: input.timezone, followUp });
}

async function failCall(deps: VoiceDeps, call: CallRow, reason: string): Promise<void> {
  const updated = await deps.repo.transitionCall(call.id, ["DIALLING"], {
    state: "FAILED",
    outcome: "FAILED",
    disconnection_reason: reason.slice(0, 120),
    ended_at: deps.now().toISOString(),
  });
  if (updated) {
    await deps.enqueue("voice.post_call", { callId: call.id }, { businessId: call.business_id, idempotencyKey: `voice.post_call:${call.id}` });
  }
}

/* ======================================================= ingestVoiceEvent */

export type IngestOutcome =
  | { status: "APPLIED" | "RECORDED"; callId: string; state: CallState; followUps: FollowUp[] }
  | { status: "DUPLICATE"; callId: string }
  | { status: "UNMATCHED"; reason: string }
  | { status: "PROVISIONING"; businessId: string | null };

export async function ingestVoiceEvent(deps: VoiceDeps, event: VoiceEvent, extras: { providerSummary?: string | null; providerCostCents?: number | null } = {}): Promise<IngestOutcome> {
  if (event.type === "BUNDLE_STATUS_CHANGED") return applyBundleStatus(deps, event);

  const ref = callRefOf(event);
  let call: CallRow | null = null;
  if (ref.callId) call = await deps.repo.loadCall(ref.callId);
  if (!call && ref.providerCallId) call = await deps.repo.findCallByProviderId(ref.providerCallId);
  const meta: Record<string, string> = ("metadata" in event ? event.metadata : undefined) ?? {};
  // Voice P3 (0162): a carrier status callback for a Retell-placed call has
  // no id of ours. It is matched on the number pair to the ONE live call
  // between them, and the carrier id is recorded so later callbacks match.
  if (!call && event.provider === "twilio" && ref.providerCallId && meta.carrier_from && meta.carrier_to && deps.repo.findLiveCallsByNumbers) {
    const since = new Date(deps.now().getTime() - 2 * 60 * 60_000);
    const candidates = (await deps.repo.findLiveCallsByNumbers({ fromE164: meta.carrier_from, toE164: meta.carrier_to, since })).filter((c) => !c.carrier_call_sid);
    if (candidates.length === 1) {
      call = candidates[0];
      if (deps.repo.recordCarrierCallSid) await deps.repo.recordCarrierCallSid(call.id, ref.providerCallId, "NUMBER_PAIR_MATCH");
      call = { ...call, carrier_call_sid: ref.providerCallId };
    }
  }
  if (!call) return { status: "UNMATCHED", reason: "NO_CALL_FOR_EVENT" };
  // Retell reports the carrier's id for the leg (UNVERIFIED field): recorded once.
  if (event.provider === "retell" && meta.carrier_call_sid && !call.carrier_call_sid && deps.repo.recordCarrierCallSid) {
    await deps.repo.recordCarrierCallSid(call.id, meta.carrier_call_sid, "RETELL_TELEPHONY_ID");
    call = { ...call, carrier_call_sid: meta.carrier_call_sid };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const reduced = reduceVoiceEvent(call, event, deps.now());
    let applied = reduced.applied;
    if (reduced.applied || Object.keys(reduced.patch).length) {
      const patch = { ...reduced.patch } as Partial<CallRow>;
      if (!call.provider_call_id && ref.providerCallId && event.provider !== "twilio") patch.provider_call_id = ref.providerCallId;
      const updated = await deps.repo.transitionCall(call.id, [call.state], patch);
      if (!updated) {
        // The state moved under us (a concurrent event): re-read and re-reduce.
        const fresh = await deps.repo.loadCall(call.id);
        if (!fresh) return { status: "UNMATCHED", reason: "CALL_DELETED" };
        call = fresh;
        continue;
      }
      call = updated;
    } else {
      applied = false;
    }

    const recorded = await deps.repo.insertCallEvent({
      businessId: call.business_id,
      callId: call.id,
      provider: event.provider,
      eventType: event.type,
      dedupeKey: event.dedupeKey,
      occurredAt: event.occurredAt,
      applied,
      payload: reduced.eventPayload,
    });
    if (!recorded) return { status: "DUPLICATE", callId: call.id };

    for (const f of reduced.followUps) {
      if (f === "POST_CALL") {
        const analysedKey = event.type === "CALL_ANALYZED" ? ":analyzed" : "";
        await deps.enqueue(
          "voice.post_call",
          {
            callId: call.id,
            providerSummary: event.type === "CALL_ANALYZED" ? event.summary : (extras.providerSummary ?? null),
            providerCostCents: event.type === "CALL_ANALYZED" ? event.costCents : (extras.providerCostCents ?? null),
          },
          { businessId: call.business_id, idempotencyKey: `voice.post_call:${call.id}${analysedKey}` },
        );
      } else if (f === "RECORDING_FETCH" && call.recording_enabled) {
        await deps.enqueue("voice.recording_fetch", { callId: call.id }, { businessId: call.business_id, runAt: new Date(deps.now().getTime() + MINUTE), idempotencyKey: `voice.recording_fetch:${call.id}` });
      }
    }
    return { status: applied ? "APPLIED" : "RECORDED", callId: call.id, state: call.state, followUps: reduced.followUps };
  }
  return { status: "UNMATCHED", reason: "CONTENDED" };
}

async function applyBundleStatus(deps: VoiceDeps, event: Extract<VoiceEvent, { type: "BUNDLE_STATUS_CHANGED" }>): Promise<IngestOutcome> {
  const found = await deps.repo.findNumberByBundle(event.bundleSid);
  if (!found) return { status: "PROVISIONING", businessId: null };
  const next = applyProvisioningEvent(found.record, {
    type: "BUNDLE_STATUS",
    bundleSid: event.bundleSid,
    status: event.status,
    failureReason: event.failureReason,
  });
  if (next !== found.record) {
    const saved = await deps.repo.saveNumberRecord({ id: found.id, record: next, expectedVersion: found.record.version });
    if (saved) {
      await deps.repo.appendNumberEvents({
        businessId: found.businessId,
        numberId: found.id,
        log: [
          {
            businessId: found.businessId,
            fromState: found.record.state,
            toState: next.state,
            event: "BUNDLE_STATUS",
            at: deps.now().toISOString(),
            detail: { status: event.status, failureReason: event.failureReason, via: "callback" },
            idempotencyKey: `${found.businessId}:${next.version}:BUNDLE_STATUS`,
          },
        ],
      });
    }
  }
  await deps.enqueue("voice.number_provision", { businessId: found.businessId }, { businessId: found.businessId, idempotencyKey: `voice.number_provision:${found.businessId}` });
  return { status: "PROVISIONING", businessId: found.businessId };
}

/* ======================================================= postProcessCall */

export type PostCallResult =
  | { status: "COMPLETE"; disposition: string; billedSec: number }
  | { status: "WAITING"; reason: string }
  | { status: "SKIPPED"; reason: string };

function dialOutcomeOf(call: CallRow): DialOutcome | null {
  switch (call.outcome) {
    case "NO_ANSWER":
      return "NO_ANSWER";
    case "BUSY":
      return "BUSY";
    case "VOICEMAIL":
      return "VOICEMAIL";
    case "FAILED":
      return /PERMANENT|IDENTITY|AGENT_NOT_CONFIGURED|PROVIDER_NOT_CONFIGURED/.test(call.disconnection_reason ?? "") ? "FAILED_PERMANENT" : "FAILED_TRANSIENT";
    default:
      return null;
  }
}

export async function postProcessCall(
  deps: VoiceDeps,
  input: { callId: string; providerSummary?: string | null; providerCostCents?: number | null },
): Promise<PostCallResult> {
  let call = await deps.repo.loadCall(input.callId);
  if (!call) return { status: "SKIPPED", reason: "NOT_FOUND" };
  if (call.state === "CANCELLED") {
    try {
      await releaseMinutes(deps.minutes, { businessId: call.business_id, callId: call.id, route: call.route });
    } catch (error) {
      if (!(error instanceof MinuteStoreUnavailable)) throw error;
    }
    return { status: "SKIPPED", reason: "CANCELLED" };
  }
  if (LIVE_STATES.includes(call.state) || call.state === "QUEUED" || call.state === "REQUESTED") {
    return { status: "WAITING", reason: `STATE_${call.state}` };
  }

  // Provider details (transcript, exact duration, cost). Absent keys: carry on
  // with what the webhooks told us.
  let details: ProviderCallDetails | null = null;
  const voice = deps.providers().voice;
  if (voice && call.provider_call_id && call.provider !== "twilio") {
    try {
      details = await voice.getCall(call.provider_call_id);
    } catch (error) {
      if (!(error instanceof ProviderNotConfigured) && !(error instanceof ProviderRequestError && error.permanent)) throw error;
    }
  }

  const durationSec = call.duration_sec ?? details?.durationSec ?? 0;
  const endedAt = new Date(call.ended_at ?? deps.now().toISOString());
  // The assistant's own end_call_summary (voice P3) is preferred over the
  // provider's generated one: it was written against the call's brief.
  let agentSummary: { summary: string; disposition: string; nextStep: string | null } | null = null;
  if (deps.repo.loadAgentSummary) {
    try {
      agentSummary = await deps.repo.loadAgentSummary(call.id);
    } catch {
      agentSummary = null;
    }
  }
  const analysis = analyseCall({
    outcome: (call.outcome as CallOutcome | null) ?? details?.outcome ?? null,
    durationSec,
    transcript: details?.transcript ?? [],
    providerSummary: agentSummary?.summary ?? input.providerSummary ?? null,
    endedAt,
  });
  if (agentSummary?.nextStep && analysis.nextAction && analysis.disposition !== "OPTED_OUT" && analysis.disposition !== "NO_CONVERSATION") {
    analysis.nextAction = `${analysis.nextAction} Agreed on the call: ${agentSummary.nextStep}`.slice(0, 500);
  }

  // A voicemail reached on a call that planned one: Retell left the fixed
  // script (§26), so no second one is left for this request.
  if (call.outcome === "VOICEMAIL" && !call.voicemail_left && deps.repo.loadCallPlan) {
    try {
      const plan = await deps.repo.loadCallPlan(call.id);
      if (plan?.voicemailScriptVersion) {
        await deps.repo.patchCall(call.id, { voicemail_left: true });
        call = { ...call, voicemail_left: true };
      }
    } catch {
      // Unknown: nothing is recorded, and the next dial reads the stored flag.
    }
  }

  const ctx = await deps.repo.loadDialContext(call.business_id, call.lead_id, call.route, call.id);
  const retentionDays = ctx.settings?.recording_retention_days ?? 90;
  const retainUntil = new Date(endedAt.getTime() + retentionDays * 86_400_000).toISOString();

  if (details?.transcript.length) {
    await deps.repo.saveTranscript({ businessId: call.business_id, callId: call.id, segments: details.transcript, retainUntil });
  }
  // The closing attribution (owner decision 2026-09-28): spoken or not, read
  // from what the agent actually said. Never counted on an opted-out or
  // unanswered call.
  const agentWords = (details?.transcript ?? []).filter((t) => t.role === "agent").map((t) => t.content);
  const spoken =
    analysis.disposition !== "NO_CONVERSATION" && call.calling_as_name
      ? attributionSpoken(agentWords, renderClosingLine({ callingAsName: call.calling_as_name, whiteLabel: false }))
      : false;
  await deps.repo.saveOutcome({
    businessId: call.business_id,
    callId: call.id,
    leadId: call.lead_id,
    analysis,
    qualificationBefore: ctx.lead?.qualification_state ?? null,
    attribution: { spoken, closingVersion: CLOSING_VERSION },
  });
  if (analysis.objections.length) {
    await deps.repo.saveObjections({ businessId: call.business_id, leadId: call.lead_id, callId: call.id, objections: analysis.objections, occurredAt: endedAt.toISOString() });
  }
  if (analysis.leadText) {
    await deps.repo.writeQualificationSignals({ businessId: call.business_id, leadId: call.lead_id, callId: call.id, analysis, observedAt: endedAt.toISOString() });
  }
  // The number the lead is on: the one we called, or the one they rang from.
  const leadPhone = call.direction === "INBOUND" ? (call.from_e164 ?? call.to_e164) : call.to_e164;
  if (analysis.voiceOptOut) {
    await deps.repo.recordVoiceOptOut({ businessId: call.business_id, leadId: call.lead_id, phone: leadPhone, callId: call.id, scope: analysis.optOutScope ?? "CALLS" });
  } else if (analysis.disposition === "WRONG_PERSON") {
    // A wrong number reaches a stranger: that number is not rung again
    // (data minimisation), whether or not the model called opt_out.
    await deps.repo.recordVoiceOptOut({ businessId: call.business_id, leadId: call.lead_id, phone: leadPhone, callId: call.id, scope: "CALLS" });
  }
  if (analysis.nextAction) {
    await deps.repo.setLeadNextAction({ businessId: call.business_id, leadId: call.lead_id, nextAction: analysis.nextAction });
  }
  // Continuity (continuity.ts): the call joins the lead's shared memory, so
  // the next text turn continues from it. Only a real conversation.
  if (deps.repo.recordCallMemory && analysis.disposition !== "NO_CONVERSATION") {
    const note: CallMemoryNote = buildCallMemoryNote({
      endedAt: endedAt.toISOString(),
      route: call.route,
      disposition: analysis.disposition,
      summary: analysis.summary,
      nextStep: agentSummary?.nextStep ?? analysis.nextAction,
      objectionKeys: analysis.objections.map((o) => o.key),
    });
    try {
      await deps.repo.recordCallMemory({ businessId: call.business_id, leadId: call.lead_id, callId: call.id, note });
    } catch {
      // The facts and next action above already carry the call; the memory is a convenience.
    }
  }

  // Premium voice (voice-profile.ts): the +£0.20/min surcharge is settled in
  // minutes at PREMIUM_MINUTE_FACTOR; the extra TTS cost is its own ledger line.
  let premiumVoice = false;
  if (deps.repo.loadCallPlan) {
    try {
      premiumVoice = Boolean((await deps.repo.loadCallPlan(call.id))?.premiumVoice);
    } catch {
      premiumVoice = false;
    }
  }

  // Minutes: settle what was used (to the second), or return the whole hold.
  let billedSec = 0;
  try {
    const answered = Boolean(call.answered_at) || analysis.disposition !== "NO_CONVERSATION";
    if (answered && durationSec > 0) {
      const settled = await settleMinutes(deps.minutes, { businessId: call.business_id, callId: call.id, route: call.route, actualSec: premiumVoice ? premiumBilledSec(durationSec) : durationSec });
      if (settled.ok) billedSec = settled.billedSec;
      else if (settled.reason === "CONTENDED") throw new Error("voice minutes contended; retry");
    } else {
      await releaseMinutes(deps.minutes, { businessId: call.business_id, callId: call.id, route: call.route });
    }
  } catch (error) {
    if (!(error instanceof MinuteStoreUnavailable)) throw error;
  }

  // ClientTurn's cost: the provider's figure when known, else the estimate.
  const lines = callCostLines({
    callId: call.id,
    durationSec,
    toE164: call.to_e164,
    recording: call.recording_enabled,
    providerCostCents: input.providerCostCents ?? details?.costCents ?? null,
    destinationClass: (call.destination_class as DestinationClass | null) ?? null,
    premiumTtsExtraUsdPerMin: premiumVoice ? PREMIUM_TTS_EXTRA_USD_PER_MIN : 0,
  });
  if (lines.length) await deps.repo.saveCostLines({ businessId: call.business_id, callId: call.id, lines, occurredAt: endedAt.toISOString() });

  // POST_PROCESSING -> COMPLETE (guard: minutes accounted for).
  const from: CallState[] = [...ENDED_STATES];
  const processing = await deps.repo.transitionCall(call.id, from, { state: "POST_PROCESSING", billed_sec: billedSec, duration_sec: durationSec });
  if (processing) call = processing;
  const complete = await deps.repo.transitionCall(call.id, ["POST_PROCESSING"], { state: "COMPLETE" });
  if (complete) {
    await deps.repo.audit({
      businessId: call.business_id,
      action: "voice.call_completed",
      entityType: "voice_call",
      entityId: call.id,
      metadata: { lead_id: call.lead_id, disposition: analysis.disposition, billed_sec: billedSec, outcome: call.outcome },
    });
    const outcome = dialOutcomeOf(call);
    // Only an outbound call is retried; a missed inbound call is the caller's own.
    if (outcome && !analysis.voiceOptOut && call.direction === "OUTBOUND") {
      await deps.enqueue("voice.retry", { callId: call.id }, { businessId: call.business_id, idempotencyKey: `voice.retry:${call.id}` });
    }
  }
  return { status: "COMPLETE", disposition: analysis.disposition, billedSec };
}

/* =========================================================== planCallRetry */

export type RetryResult =
  | { status: "RETRY_QUEUED"; callId: string; at: string; followUp?: string | null }
  | { status: "FALLBACK"; channel: string }
  | { status: "STOP"; reason: string }
  | { status: "REFUSED"; reason: string; productState: string };

export async function planCallRetry(deps: VoiceDeps, callId: string): Promise<RetryResult> {
  const call = await deps.repo.loadCall(callId);
  if (!call) return { status: "STOP", reason: "NOT_FOUND" };
  const outcome = dialOutcomeOf(call);
  if (!outcome) return { status: "STOP", reason: "NOT_A_MISSED_CALL" };
  const ctx = await deps.repo.loadDialContext(call.business_id, call.lead_id, call.route, call.id);
  if (!ctx.lead) return { status: "STOP", reason: "LEAD_NOT_FOUND" };
  const tz = call.recipient_timezone ?? ctx.lead.timezone ?? ctx.workspaceTimezone ?? "Europe/London";
  const e164 = call.to_e164 ?? ctx.lead.phone ?? "";
  const cls = e164.startsWith("+") ? classifyDestination(e164) : null;
  const plan = planRetry({
    now: deps.now(),
    outcome,
    attemptNumber: call.attempt_number,
    maxAttempts: ctx.settings?.max_attempts,
    consentBasis: (call.consent_basis as ConsentBasis | null) ?? "PHONE_NUMBER_PROVIDED",
    voicemail: { enabled: Boolean(ctx.settings?.voicemail_enabled), alreadyLeftForThisRequest: call.voicemail_left },
    callingAsName: call.calling_as_name ?? "",
    enquiryAt: new Date(ctx.lead.source_submitted_at ?? ctx.lead.created_at),
    recipient: { timezone: tz, region: ukRegionOf(ctx.lead.uk_region), isMobile: cls === "UK_MOBILE", isUk: e164.startsWith("+44") },
    callingHours: callingHoursOf(ctx.settings),
    channels: {
      SMS: { lawful: Boolean(ctx.lead.phone) && !ctx.lead.opted_out && !ctx.suppressed },
      EMAIL: { lawful: Boolean(ctx.lead.email) && !ctx.lead.opted_out },
    },
  });

  // Channel orchestration (§71, channel-orchestration.ts V5): a missed call
  // is followed by ONE text now (SMS, then WhatsApp on the next miss, where
  // lawful), while the retry call below stays scheduled at the best time.
  // The retry continues the original request (a person's, or the lead's), so
  // it is not an AI-initiated call; every gate still runs at dial time.
  const followUp = await missedCallFollowUp(deps, call, ctx, plan.next.action === "RETRY_CALL" ? plan.next.at : null, cls === "UK_MOBILE");

  if (plan.next.action === "RETRY_CALL") {
    // The retry is a new request: the entitlement gate and canCallLead run again.
    const requested = await requestCall(deps, {
      businessId: call.business_id,
      leadId: call.lead_id,
      route: call.route as RequestCallInput["route"],
      entryPoint: "OUTBOUND_DIAL",
      requestedBy: null,
      attemptNumber: plan.next.attemptNumber,
      notBefore: plan.next.at,
    });
    if (!requested.ok) return { status: "REFUSED", reason: requested.reason, productState: requested.productState };
    return { status: "RETRY_QUEUED", callId: requested.callId, at: requested.scheduledFor, followUp: followUp?.move ?? null };
  }
  if (plan.next.action === "FALLBACK") {
    if (followUp && followUp.move !== "NONE" && followUp.move !== "WAIT") return { status: "FALLBACK", channel: followUp.move };
    await deps.repo.setLeadNextAction({
      businessId: call.business_id,
      leadId: call.lead_id,
      nextAction: `No answer after ${call.attempt_number} call attempt${call.attempt_number === 1 ? "" : "s"}. Follow up by ${plan.next.channel === "SMS" ? "text" : plan.next.channel.toLowerCase()}.`,
    });
    return { status: "FALLBACK", channel: plan.next.channel };
  }
  return { status: "STOP", reason: plan.next.reason };
}

/**
 * The V5 move after a missed call, taken once per call (the send key). Only
 * with the orchestration facts (voice P3 repo); without them the P2
 * behaviour stands (the fallback is written as the lead's next action).
 */
async function missedCallFollowUp(deps: VoiceDeps, call: CallRow, ctx: DialContext, retryAt: Date | null, isUkMobile: boolean): Promise<ChannelDecision | null> {
  if (!deps.repo.loadChannelFacts || !ctx.lead || call.direction !== "OUTBOUND") return null;
  const lead = ctx.lead;
  const now = deps.now();
  let facts: ChannelFacts;
  try {
    facts = await deps.repo.loadChannelFacts({ businessId: call.business_id, leadId: call.lead_id, since: new Date(call.ended_at ?? call.created_at) });
  } catch {
    return null;
  }
  const frequency = evaluateFrequency({
    now,
    automatedSentAt: facts.automatedSentAt,
    caps: DEFAULT_FREQUENCY_CAPS,
    touchesSinceEngagement: facts.touchesSinceEngagement,
    intentState: facts.intentState,
  });
  const decision = decideNextChannel({
    now,
    point: "CALL_MISSED",
    lead: {
      consentBasis: (call.consent_basis as ConsentBasis | null) ?? null,
      askedForCallNow: false,
      replyChannel: null,
      preferredChannel: facts.preferredChannel,
      intentState: facts.intentState,
      buyingSignal: false,
      urgent: false,
    },
    // The retry continues the original request: not an AI-initiated call.
    voice: { usable: true, aiMayCall: true, nextCallableAt: retryAt, attemptsUsed: call.attempt_number, maxAttempts: ctx.settings?.max_attempts ?? 3 },
    channels: {
      SMS: isUkMobile && Boolean(lead.phone) && !lead.opted_out && !ctx.suppressed,
      WHATSAPP: facts.whatsappWindowOpen && !lead.opted_out,
      EMAIL: Boolean(lead.email) && !lead.opted_out,
    },
    sentSinceLastCall: facts.sentSinceLastCall,
    frequency: frequency.action === "allow" ? { action: "allow" } : frequency.action === "defer" ? { action: "defer", at: frequency.at } : { action: "skip" },
    retryCallAt: retryAt,
  });
  if ((decision.move === "SMS" || decision.move === "WHATSAPP" || decision.move === "EMAIL") && deps.repo.queueFollowUpText && call.calling_as_name) {
    await deps.repo.queueFollowUpText({
      businessId: call.business_id,
      leadId: call.lead_id,
      channel: decision.move,
      body: missedCallText({ callingAsName: call.calling_as_name, firstName: lead.first_name, channel: decision.move }),
      sendKey: `voice-missed:${call.id}`,
    });
  }
  return decision;
}

/* ========================================================= provisionStep */

export type ProvisionResult = { outcome: StepOutcome | "NOT_CONFIGURED" | "CONTENDED" | "NO_RECORD"; state: string | null; rescheduledFor: string | null };

/** How long to wait before the next step, by outcome. */
export function provisionRescheduleMs(outcome: StepOutcome, attempts: number): number | null {
  switch (outcome) {
    case "ADVANCED":
      return 1_000;
    case "WAIT_FOR_REVIEW":
      return 60 * MINUTE;
    case "NO_NUMBERS_AVAILABLE":
    case "FAILED":
      return Math.min(6 * 60 * MINUTE, 5 * MINUTE * 2 ** Math.min(6, attempts));
    default:
      return null;
  }
}

export async function provisionStep(deps: VoiceDeps, businessId: string): Promise<ProvisionResult> {
  const numbers = deps.providers().numbers;
  const urls = deps.config.provisioningUrls;
  if (!numbers || !urls) return { outcome: "NOT_CONFIGURED", state: null, rescheduledFor: null };
  const found = await deps.repo.loadNumberRecord(businessId);
  if (!found) return { outcome: "NO_RECORD", state: null, rescheduledFor: null };

  const result = await runProvisioningStep(found.record, {
    numbers,
    details: await deps.repo.loadProvisioningDetails(businessId),
    now: deps.now(),
    urls,
    quarantinedE164s: await deps.repo.quarantinedE164s(),
  });
  if (result.record !== found.record) {
    const saved = await deps.repo.saveNumberRecord({ id: found.id, record: result.record, expectedVersion: found.record.version });
    if (!saved) {
      // Another run moved the record on. Re-run later; every step is idempotent.
      await deps.enqueue("voice.number_provision", { businessId }, { businessId, runAt: new Date(deps.now().getTime() + 5_000), idempotencyKey: `voice.number_provision:${businessId}:contended` });
      return { outcome: "CONTENDED", state: found.record.state, rescheduledFor: null };
    }
    if (result.log.length) await deps.repo.appendNumberEvents({ businessId, numberId: found.id, log: result.log });
    if (result.record.subaccountSid && !found.record.subaccountSid) {
      await deps.repo.upsertTelephonyAccount({ businessId, subaccountSid: result.record.subaccountSid, authToken: await subaccountToken(numbers, result.record.subaccountSid) });
    }
    if (result.record.state === "ACTIVE" && found.record.state !== "ACTIVE") {
      await deps.repo.audit({ businessId, action: "number.activated", entityType: "business_number", entityId: found.id, metadata: { e164: result.record.e164 } });
      await deps.repo.notifyOwner({
        businessId,
        title: "Your calling number is ready",
        body: `Your dedicated number ${result.record.e164 ?? ""} is active for AI calls and texts.`,
        dedupeKey: `voice-number-active:${businessId}:${result.record.e164 ?? ""}`,
        linkUrl: "/app/settings?section=connections",
      });
    }
    if (result.record.needsAttention && !found.record.needsAttention) {
      await deps.repo.audit({ businessId, action: "number.needs_attention", entityType: "business_number", entityId: found.id, metadata: { state: result.record.state, error: result.record.lastError } });
      await deps.repo.notifyOwner({
        businessId,
        title: "Your calling number needs attention",
        body: result.record.rejection?.reason
          ? `Twilio could not approve your business details: ${result.record.rejection.reason}. Check them in Settings, Voice.`
          : "Setting up your calling number has stalled. Check your business details in Settings, Voice.",
        dedupeKey: `voice-number-attention:${businessId}:${result.record.version}`,
        linkUrl: "/app/settings?section=connections",
      });
    }
    if (result.record.state === "BUNDLE_REJECTED" && found.record.state !== "BUNDLE_REJECTED") {
      await deps.repo.audit({ businessId, action: "number.bundle_rejected", entityType: "business_number", entityId: found.id, metadata: { reason: result.record.rejection?.reason ?? null, fixable: result.record.rejection?.fixable ?? null } });
    }
  }

  // A subaccount created before the token was stored (P2): store it now, once.
  if (result.record.subaccountSid && found.record.subaccountSid && deps.repo.telephonyTokenStored && numbers.subaccountAuthToken) {
    try {
      if (!(await deps.repo.telephonyTokenStored(businessId))) {
        const token = await subaccountToken(numbers, result.record.subaccountSid);
        if (token) await deps.repo.upsertTelephonyAccount({ businessId, subaccountSid: result.record.subaccountSid, authToken: token });
      }
    } catch {
      // Best effort: the parent token still verifies the platform's own webhooks.
    }
  }

  let runAt: Date | null = null;
  if (result.outcome === "WAIT_UNTIL" && result.runAt) runAt = new Date(result.runAt);
  else {
    const ms = provisionRescheduleMs(result.outcome, result.record.attempts);
    if (ms !== null && !result.record.needsAttention) runAt = new Date(deps.now().getTime() + ms);
  }
  if (runAt) {
    await deps.enqueue("voice.number_provision", { businessId }, {
      businessId,
      runAt,
      idempotencyKey: `voice.number_provision:${businessId}:${result.record.version}`,
    });
  }
  return { outcome: result.outcome, state: result.record.state, rescheduledFor: runAt?.toISOString() ?? null };
}

/** The subaccount's auth token from the numbers provider, or null (never throws). */
async function subaccountToken(numbers: NumberProvider, accountSid: string): Promise<string | null> {
  if (!numbers.subaccountAuthToken) return null;
  try {
    return await numbers.subaccountAuthToken(accountSid);
  } catch {
    return null;
  }
}

/** Start provisioning (NOT_REQUESTED -> DETAILS_REQUIRED) and run the first step. */
export async function startProvisioning(deps: VoiceDeps, businessId: string): Promise<{ state: string; started: boolean }> {
  let found = await deps.repo.loadNumberRecord(businessId);
  if (!found) found = await deps.repo.createNumberRecord(businessId);
  if (found.record.state !== "NOT_REQUESTED") return { state: found.record.state, started: false };
  const next = applyProvisioningEvent(found.record, { type: "REQUEST" });
  const saved = await deps.repo.saveNumberRecord({ id: found.id, record: next, expectedVersion: found.record.version });
  if (saved) {
    await deps.repo.appendNumberEvents({
      businessId,
      numberId: found.id,
      log: [{ businessId, fromState: found.record.state, toState: next.state, event: "REQUEST", at: deps.now().toISOString(), detail: {}, idempotencyKey: `${businessId}:${next.version}:REQUEST` }],
    });
  }
  await deps.enqueue("voice.number_provision", { businessId }, { businessId, idempotencyKey: `voice.number_provision:${businessId}` });
  return { state: next.state, started: saved };
}

/** voice.number_release: schedule the release (at `releaseAfter`, default now) and drive it. */
export async function scheduleNumberRelease(deps: VoiceDeps, input: { businessId: string; releaseAfter?: string | null }): Promise<{ state: string | null; scheduled: boolean }> {
  const found = await deps.repo.loadNumberRecord(input.businessId);
  if (!found) return { state: null, scheduled: false };
  if (!["ACTIVE", "NUMBER_PURCHASED", "CONFIGURED"].includes(found.record.state)) {
    return { state: found.record.state, scheduled: found.record.state === "RELEASE_SCHEDULED" };
  }
  const releaseAfter = input.releaseAfter ?? deps.now().toISOString();
  const next = applyProvisioningEvent(found.record, { type: "SCHEDULE_RELEASE", releaseAfter });
  const saved = await deps.repo.saveNumberRecord({ id: found.id, record: next, expectedVersion: found.record.version });
  if (!saved) return { state: found.record.state, scheduled: false };
  await deps.repo.appendNumberEvents({
    businessId: input.businessId,
    numberId: found.id,
    log: [{ businessId: input.businessId, fromState: found.record.state, toState: next.state, event: "SCHEDULE_RELEASE", at: deps.now().toISOString(), detail: { releaseAfter }, idempotencyKey: `${input.businessId}:${next.version}:SCHEDULE_RELEASE` }],
  });
  await deps.repo.audit({ businessId: input.businessId, action: "number.release_scheduled", entityType: "business_number", entityId: found.id, metadata: { e164: found.record.e164, release_after: releaseAfter } });
  await deps.enqueue("voice.number_provision", { businessId: input.businessId }, { businessId: input.businessId, runAt: new Date(releaseAfter), idempotencyKey: `voice.number_provision:${input.businessId}:release` });
  return { state: next.state, scheduled: true };
}

/* ========================================================== fetchRecording */

export function recordingKey(businessId: string, callId: string, contentType: string): string {
  return `voice/recordings/${businessId}/${callId}/recording.${contentType === "audio/wav" ? "wav" : "mp3"}`;
}

export async function fetchRecording(deps: VoiceDeps, callId: string): Promise<{ status: "STORED" | "SKIPPED" | "FAILED" | "NOT_READY"; reason?: string }> {
  const call = await deps.repo.loadCall(callId);
  if (!call) return { status: "SKIPPED", reason: "NOT_FOUND" };
  if (!call.recording_enabled) return { status: "SKIPPED", reason: "RECORDING_OFF" };
  const existing = await deps.repo.loadRecording(callId);
  if (existing?.status === "STORED") return { status: "SKIPPED", reason: "ALREADY_STORED" };
  const voice = deps.providers().voice;
  if (!voice || !deps.storage || !call.provider_call_id) return { status: "SKIPPED", reason: "NOT_CONFIGURED" };

  const details = await voice.getCall(call.provider_call_id);
  if (!details.recordingUrl) return { status: "NOT_READY", reason: "NO_RECORDING_YET" };
  const ctx = await deps.repo.loadDialContext(call.business_id, call.lead_id, call.route, call.id);
  const retentionDays = ctx.settings?.recording_retention_days ?? 90;
  const retainUntil = new Date(deps.now().getTime() + retentionDays * 86_400_000).toISOString();

  const file = await deps.storage.fetch(details.recordingUrl);
  const contentType = file.contentType === "audio/wav" ? "audio/wav" : "audio/mpeg";
  const key = recordingKey(call.business_id, call.id, contentType);
  await deps.storage.put(key, file.bytes, contentType);
  await deps.repo.saveRecording({
    businessId: call.business_id,
    callId: call.id,
    provider: call.provider ?? "retell",
    providerRecordingId: call.provider_call_id,
    status: "STORED",
    objectKey: key,
    contentType,
    sizeBytes: file.bytes.byteLength,
    sha256: deps.storage.sha256(file.bytes),
    durationSec: details.durationSec,
    retainUntil,
  });
  return { status: "STORED" };
}
