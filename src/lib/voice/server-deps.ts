import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { recordAudit, type AnyAuditAction } from "@/lib/audit";
import { getEntitlements } from "@/lib/billing/entitlements";
import { addOnSubscriptionStatus } from "@/lib/billing/lifecycle";
import { can } from "@/lib/billing/capabilities";
import { canStoreSecrets, sealSecret } from "@/lib/security/secret-box";
import { loadVoiceCallBrief, p3Repo, voiceMaintenancePauseUntil } from "./server-p3";
import { checkVoiceSuppression, recordVoiceSuppression, suppress } from "@/lib/policy/suppression";
import { putObject } from "@/lib/storage/r2";
import { buildSignalWrite } from "@/lib/qualification-intelligence/signals";
import { writeIntentSignals, enqueueReassessment } from "@/lib/qualification-intelligence/service";
import { supabaseMinuteStore, readMinuteBalance } from "./minutes";
import { voiceProviders, provisioningUrls } from "./providers/registry";
import { detailsFingerprint, provisioningReadiness } from "./numbers/provisioning-details";
import { newProvisioningRecord, type ProvisioningRecord, type ProvisioningState } from "./numbers/provisioning";
import type { WorkspaceNumber } from "./numbers/sender";
import type { InboundLookups } from "./inbound-core";
import { USD_TO_GBP } from "./cost";
import type { BundleStatus } from "./providers/types";
import type { CallState } from "./state-machine";
import { voiceRepoWithAutomationEvents } from "@/lib/automation/voice-events-server";
import type { EntitlementFacts, PermissionRow } from "./snapshot";
import type {
  AuditEntry,
  BeginDialResult,
  CallRow,
  DialContext,
  EligibilityRecord,
  NewCallRow,
  VoiceDeps,
  VoiceRepo,
  VoiceSettingsRow,
  LeadRow,
  AdminControls,
} from "./runtime-core";

/**
 * The Supabase-backed dependencies of the voice runtime (runtime-core.ts):
 * reads, compare-and-swap writes, the 0157 RPCs, the job queue, R2 and the QI
 * service. Service role only (jobs and server-side operations). Tests never
 * import this file; they drive runtime-core with in-memory fakes.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const MISSING = new Set(["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"]);

function check<T>(what: string, result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw new Error(`voice ${what}: ${result.error.message ?? result.error.code}`);
  return result.data;
}

const CALL_COLUMNS =
  "id, business_id, lead_id, direction, route, state, call_key, attempt_number, consent_basis, to_e164, from_e164, destination_class, recipient_timezone, calling_as_name, legal_entity_name, identification_contact, persona_name, opener_version, recording_enabled, provider, provider_call_id, carrier_call_sid, outcome, disconnection_reason, duration_sec, billed_sec, reserved_sec, voicemail_left, queued_at, started_at, answered_at, ended_at, created_at";

const SETTINGS_COLUMNS =
  "voice_enabled, admin_kill_switch, calling_as_name, legal_entity_name, identification_contact, assistant_persona_name, opener_suffix, recording_enabled, recording_retention_days, voicemail_enabled, calling_hours, max_attempts, workspace_concurrency, transfer_number_e164, provider_agent_id";

const NUMBER_COLUMNS =
  "id, business_id, provisioning_state, e164, phone_number_sid, messaging_service_sid, bundle_sid, address_sid, end_user_sid, bundle_status, submitted_fingerprint, rejection_reason, rejection_fixable, rejection_fingerprint, purchased_at, configured_at, activated_at, release_after, released_at, quarantine_until, attempts, last_error, needs_attention, version, telephony_account_id";

const ACTIVE: readonly CallState[] = ["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"];
/** Calls that reached the provider (count as an attempt). */
const ATTEMPTED: readonly CallState[] = [
  "DIALLING", "RINGING", "ANSWERED", "VOICEMAIL", "NO_ANSWER", "BUSY", "FAILED", "IN_CONVERSATION",
  "WRAPPING_UP", "TRANSFERRED", "ENDED", "POST_PROCESSING", "COMPLETE",
];

/* ------------------------------------------------------------- mapping */

type NumberRow = {
  id: string;
  business_id: string;
  provisioning_state: string;
  e164: string | null;
  phone_number_sid: string | null;
  messaging_service_sid: string | null;
  bundle_sid: string | null;
  address_sid: string | null;
  end_user_sid: string | null;
  bundle_status: string | null;
  submitted_fingerprint: string | null;
  rejection_reason: string | null;
  rejection_fixable: boolean | null;
  rejection_fingerprint: string | null;
  purchased_at: string | null;
  configured_at: string | null;
  activated_at: string | null;
  release_after: string | null;
  released_at: string | null;
  quarantine_until: string | null;
  attempts: number;
  last_error: string | null;
  needs_attention: boolean;
  version: number;
  telephony_account_id: string | null;
};

async function subaccountSidFor(businessId: string): Promise<string | null> {
  const { data } = await db().from("telephony_accounts").select("subaccount_sid").eq("business_id", businessId).eq("provider", "twilio").maybeSingle();
  return (data as { subaccount_sid: string } | null)?.subaccount_sid ?? null;
}

function recordFromRow(row: NumberRow, subaccountSid: string | null): ProvisioningRecord {
  return {
    ...newProvisioningRecord(row.business_id),
    state: row.provisioning_state as ProvisioningState,
    subaccountSid,
    bundleSid: row.bundle_sid,
    addressSid: row.address_sid,
    endUserSid: row.end_user_sid,
    bundleStatus: (row.bundle_status as BundleStatus | null) ?? null,
    submittedFingerprint: row.submitted_fingerprint,
    rejection: row.rejection_reason
      ? { reason: row.rejection_reason, fixable: Boolean(row.rejection_fixable), fingerprint: row.rejection_fingerprint }
      : null,
    phoneNumberSid: row.phone_number_sid,
    e164: row.e164,
    messagingServiceSid: row.messaging_service_sid,
    purchasedAt: row.purchased_at,
    configuredAt: row.configured_at,
    activatedAt: row.activated_at,
    releaseAfter: row.release_after,
    releasedAt: row.released_at,
    quarantineUntil: row.quarantine_until,
    attempts: row.attempts,
    lastError: row.last_error,
    needsAttention: row.needs_attention,
    version: row.version,
  };
}

function rowFromRecord(r: ProvisioningRecord): Record<string, unknown> {
  return {
    provisioning_state: r.state,
    e164: r.e164,
    phone_number_sid: r.phoneNumberSid,
    messaging_service_sid: r.messagingServiceSid,
    bundle_sid: r.bundleSid,
    address_sid: r.addressSid,
    end_user_sid: r.endUserSid,
    bundle_status: r.bundleStatus,
    submitted_fingerprint: r.submittedFingerprint,
    rejection_reason: r.rejection?.reason ?? null,
    rejection_fixable: r.rejection ? r.rejection.fixable : null,
    rejection_fingerprint: r.rejection?.fingerprint ?? null,
    purchased_at: r.purchasedAt,
    configured_at: r.configuredAt,
    activated_at: r.activatedAt,
    release_after: r.releaseAfter,
    released_at: r.releasedAt,
    quarantine_until: r.quarantineUntil,
    attempts: r.attempts,
    last_error: r.lastError,
    needs_attention: r.needsAttention,
    version: r.version,
    capabilities: r.e164 ? { voice: true, sms: true, mms: false } : { voice: false, sms: false, mms: false },
  };
}

/** The workspace's live number record (sender.ts WorkspaceNumber), or null. */
export async function readWorkspaceNumber(businessId: string): Promise<(WorkspaceNumber & { id: string; needsAttention: boolean; rejectionReason: string | null; activatedAt: string | null; releaseAfter: string | null }) | null> {
  const { data, error } = await db()
    .from("business_numbers")
    .select("id, business_id, provisioning_state, e164, messaging_service_sid, quarantine_until, needs_attention, rejection_reason, activated_at, release_after")
    .eq("business_id", businessId)
    .not("provisioning_state", "in", "(RELEASED,QUARANTINED)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code && MISSING.has(error.code)) return null;
    throw new Error(`voice number read: ${error.message}`);
  }
  const row = data as {
    id: string;
    business_id: string;
    provisioning_state: string;
    e164: string | null;
    messaging_service_sid: string | null;
    quarantine_until: string | null;
    needs_attention: boolean;
    rejection_reason: string | null;
    activated_at: string | null;
    release_after: string | null;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    state: row.provisioning_state as ProvisioningState,
    e164: row.e164,
    messagingServiceSid: row.messaging_service_sid,
    quarantineUntil: row.quarantine_until,
    needsAttention: row.needs_attention,
    rejectionReason: row.rejection_reason,
    activatedAt: row.activated_at,
    releaseAfter: row.release_after,
  };
}

export async function readVoiceSettings(businessId: string): Promise<VoiceSettingsRow | null> {
  const { data, error } = await db().from("voice_settings").select(SETTINGS_COLUMNS).eq("business_id", businessId).maybeSingle();
  if (error) {
    if (error.code && MISSING.has(error.code)) return null;
    throw new Error(`voice settings read: ${error.message}`);
  }
  const row = (data as VoiceSettingsRow | null) ?? null;
  if (!row) return null;
  // 0162's voice profile, read apart so a database without it still dials
  // (the Retell agent's own voice is used).
  const vp = await db().from("voice_settings").select("voice_profile").eq("business_id", businessId).maybeSingle();
  return { ...row, voice_profile: vp.error ? null : ((vp.data as { voice_profile?: unknown } | null)?.voice_profile ?? null) };
}

/** The live voice grants written by the Stripe sync (billing lane). */
async function voiceGrants(businessId: string): Promise<{ proVoiceItem: boolean; numberItem: boolean }> {
  const { data } = await db()
    .from("business_entitlement_grants")
    .select("entitlement_key, boolean_value, numeric_value, expires_at, revoked_at")
    .eq("business_id", businessId)
    .in("entitlement_key", ["voice_pro_item", "voice_number_item"])
    .is("revoked_at", null);
  const now = Date.now();
  const live = ((data ?? []) as { entitlement_key: string; boolean_value: boolean | null; numeric_value: number | null; expires_at: string | null }[]).filter(
    (g) => (!g.expires_at || Date.parse(g.expires_at) > now) && (g.boolean_value === true || Number(g.numeric_value) > 0),
  );
  return {
    proVoiceItem: live.some((g) => g.entitlement_key === "voice_pro_item"),
    numberItem: live.some((g) => g.entitlement_key === "voice_number_item"),
  };
}

export async function loadEntitlementFacts(businessId: string): Promise<EntitlementFacts> {
  const [entitlements, capability, grants, balance, settings, number, business, aiSwitch, aiMode] = await Promise.all([
    getEntitlements(businessId),
    can(businessId, "voice_sales_enabled"),
    voiceGrants(businessId),
    readMinuteBalance(businessId),
    readVoiceSettings(businessId),
    readWorkspaceNumber(businessId),
    db().from("businesses").select("status").eq("id", businessId).maybeSingle(),
    db().from("business_settings").select("ai_assist_enabled").eq("business_id", businessId).maybeSingle(),
    db().from("business_ai_settings").select("agent_mode").eq("business_id", businessId).maybeSingle(),
  ]);
  // The same rule as the text agent (jobs/handlers/shared.ts resolveAgentMode):
  // the switch, the plan's AI allowance, and a mode other than OFF. A failed
  // read is "not known" (undefined), never a block on its own.
  const aiAssistantOn =
    aiSwitch.error || aiMode.error
      ? undefined
      : Boolean((aiSwitch.data as { ai_assist_enabled?: boolean | null } | null)?.ai_assist_enabled) &&
        entitlements.aiAssistAllowed &&
        ["SUGGEST_ONLY", "AUTO_REPLY"].includes(String((aiMode.data as { agent_mode?: string | null } | null)?.agent_mode ?? "OFF"));
  return {
    plan: entitlements.plan,
    // Add-on items follow the subscription's dunning grace (billing batch 2).
    subscriptionStatus: addOnSubscriptionStatus(entitlements),
    businessStatus: (business.data as { status: string } | null)?.status ?? null,
    voiceCapability: capability.allowed,
    grants,
    packsHeld: balance.packsHeld,
    balance: { includedRemainingSec: balance.includedRemainingSec, packRemainingSec: balance.packRemainingSec },
    platformKill: serverEnv.voice.callsDisabled,
    settings: settings
      ? {
          voice_enabled: settings.voice_enabled,
          admin_kill_switch: settings.admin_kill_switch,
          calling_as_name: settings.calling_as_name,
          legal_entity_name: settings.legal_entity_name,
          identification_contact: settings.identification_contact,
          assistant_persona_name: settings.assistant_persona_name,
        }
      : null,
    number: number ? { provisioning_state: number.state, e164: number.e164 } : null,
    aiAssistantOn,
  };
}

/* ------------------------------------------------------------------ repo */

async function loadDialContext(businessId: string, leadId: string, route: string, excludeCallId: string | null): Promise<DialContext> {
  const client = db();
  const [leadRes, permRes, settings, number, businessRes, callsRes, activeWs, activePlatform, allocRes] = await Promise.all([
    client
      .from("leads")
      .select("id, business_id, first_name, phone, phone_normalized, email, phone_source, timezone, uk_region, anonymised_at, opted_out, human_takeover, subscriber_type, qualification_state, source_submitted_at, created_at")
      .eq("business_id", businessId)
      .eq("id", leadId)
      .maybeSingle(),
    client
      .from("contact_permissions")
      .select("consent_scope, consent_status, consent_captured_at, call_consent_wording, consent_evidence, subscriber_type, tps_listed, ctps_listed")
      .eq("business_id", businessId)
      .eq("subject_type", "LEAD")
      .eq("subject_id", leadId)
      .maybeSingle(),
    readVoiceSettings(businessId),
    readWorkspaceNumber(businessId),
    client.from("businesses").select("timezone").eq("id", businessId).maybeSingle(),
    client.from("voice_calls").select("id, route, state, started_at, created_at").eq("business_id", businessId).eq("lead_id", leadId),
    client.from("voice_calls").select("id", { count: "exact", head: true }).eq("business_id", businessId).in("state", [...ACTIVE]),
    client.from("voice_calls").select("id", { count: "exact", head: true }).in("state", [...ACTIVE]),
    client.from("voice_route_allocations").select("route, percent, enabled").eq("business_id", businessId),
  ]);
  const leadRow = check("lead read", leadRes) as (LeadRow & { phone_normalized: string | null }) | null;
  const lead: LeadRow | null = leadRow ? { ...leadRow, phone: leadRow.phone_normalized ?? leadRow.phone } : null;
  const permission = (permRes.data as PermissionRow | null) ?? null;

  const { suppressed, voiceOptedOut } = await checkVoiceSuppression(businessId, lead?.phone);

  const calls = ((callsRes.data ?? []) as { id: string; route: string; state: CallState; started_at: string | null; created_at: string }[]).filter((c) => c.id !== excludeCallId);
  const attempted = calls.filter((c) => ATTEMPTED.includes(c.state));
  const dayAgo = Date.now() - 86_400_000;
  const last = attempted
    .map((c) => Date.parse(c.started_at ?? c.created_at))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  // Route allocations: percent of the period's minutes (included + packs held now).
  let allocation: DialContext["allocation"] = null;
  const allocRows = (allocRes.data ?? []) as { route: string; percent: number; enabled: boolean }[];
  if (!allocRes.error && allocRows.length) {
    const balance = await readMinuteBalance(businessId);
    const allocations: Record<string, number> = {};
    for (const r of allocRows) if (r.enabled) allocations[r.route] = r.percent;
    let usedByRouteSec = 0;
    const { data: used } = await client
      .from("voice_minute_reservations")
      .select("billed_sec")
      .eq("business_id", businessId)
      .eq("route", route)
      .eq("status", "SETTLED");
    for (const u of (used ?? []) as { billed_sec: number | null }[]) usedByRouteSec += u.billed_sec ?? 0;
    allocation = {
      allocations,
      periodTotalSec: balance.periodIncludedSec + balance.packRemainingSec,
      usedByRouteSec,
      disabledRoutes: allocRows.filter((r) => !r.enabled).map((r) => r.route),
    };
  }

  const adminControls = await readAdminControls(businessId);

  return {
    lead,
    permission,
    suppressed,
    voiceOptedOut,
    settings,
    number,
    workspaceTimezone: (businessRes.data as { timezone: string } | null)?.timezone ?? null,
    attempts: {
      total: attempted.length,
      last24h: attempted.filter((c) => Date.parse(c.started_at ?? c.created_at) >= dayAgo).length,
      lastAttemptAt: last ? new Date(last) : null,
      routeTotal: calls.filter((c) => c.route === route).length,
    },
    activeCallForLead: calls.some((c) => ACTIVE.includes(c.state)),
    adminControls,
    concurrency: { workspaceActive: activeWs.count ?? 0, platformActive: activePlatform.count ?? 0 },
    allocation,
  };
}

const repo: VoiceRepo = {
  async loadCall(callId) {
    const { data, error } = await db().from("voice_calls").select(CALL_COLUMNS).eq("id", callId).maybeSingle();
    if (error) throw new Error(`voice call read: ${error.message}`);
    return (data as CallRow | null) ?? null;
  },

  async findCallByProviderId(providerCallId) {
    const { data, error } = await db()
      .from("voice_calls")
      .select(CALL_COLUMNS)
      .or(`provider_call_id.eq.${providerCallId},carrier_call_sid.eq.${providerCallId}`)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`voice call lookup: ${error.message}`);
    return (data as CallRow | null) ?? null;
  },

  async findCallByKey(businessId, callKey) {
    const { data } = await db().from("voice_calls").select(CALL_COLUMNS).eq("business_id", businessId).eq("call_key", callKey).maybeSingle();
    return (data as CallRow | null) ?? null;
  },

  async insertCall(row: NewCallRow) {
    const { data, error } = await db().from("voice_calls").insert(row).select(CALL_COLUMNS).single();
    if (!error) return { row: data as CallRow, inserted: true };
    if (error.code === "23505") {
      const existing = await repo.findCallByKey(row.business_id, row.call_key);
      if (existing) return { row: existing, inserted: false };
    }
    throw new Error(`voice call insert: ${error.message}`);
  },

  async transitionCall(callId, from, patch) {
    const { data, error } = await db()
      .from("voice_calls")
      .update(patch)
      .eq("id", callId)
      .in("state", [...from])
      .select(CALL_COLUMNS)
      .maybeSingle();
    if (error) {
      // The one-active-call-per-lead index refuses a second live call.
      if (error.code === "23505") return null;
      throw new Error(`voice call transition: ${error.message}`);
    }
    return (data as CallRow | null) ?? null;
  },

  async patchCall(callId, patch) {
    check("call patch", await db().from("voice_calls").update(patch).eq("id", callId));
  },

  loadEntitlementFacts,
  loadDialContext,

  async recordEligibility(r: EligibilityRecord) {
    const { error } = await db().from("voice_call_eligibility").insert({
      business_id: r.businessId,
      lead_id: r.leadId,
      voice_call_id: r.voiceCallId,
      decision: r.decision,
      call_kind: "AI_AUTOMATED",
      consent_basis: r.consentBasis,
      denials: r.denials,
      phone_type: r.phoneType,
      phone_source: r.phoneSource,
      subscriber_type: r.subscriberType,
      tps_listed: r.tpsListed,
      ctps_listed: r.ctpsListed,
      within_calling_hours: r.withinCallingHours,
      recipient_timezone: r.recipientTimezone,
      consent_evidence: r.consentEvidence,
      policy_version: "voice-p2.2026-09-27",
    });
    // Evidence is best effort after the decision; a failure is logged, never swallowed silently.
    if (error) console.error("[voice] eligibility record failed", { businessId: r.businessId, message: error.message });
  },

  async beginDial(input): Promise<BeginDialResult> {
    const { data, error } = await db().rpc("voice_call_begin_dial", {
      p_call_id: input.callId,
      p_business_id: input.businessId,
      p_lead_lock_id: input.leadLockId,
      p_workspace_lock_id: input.workspaceLockId,
      p_workspace_limit: input.workspaceLimit,
      p_platform_limit: input.platformLimit,
      // 0177: a person's own "Call with AI" skips only the takeover check.
      ...(input.personRequested ? { p_person_requested: true } : {}),
    });
    if (!error) return String(data) as BeginDialResult;
    if (!(error.code && MISSING.has(error.code))) throw new Error(`voice begin dial: ${error.message}`);
    // 0157 not applied: the compare-and-swap QUEUED -> DIALLING plus the
    // one-active-call-per-lead unique index (0150) still make a double dial
    // impossible; human take-over and concurrency were checked just before.
    const { data: moved, error: moveError } = await db()
      .from("voice_calls")
      .update({ state: "DIALLING", started_at: new Date().toISOString() })
      .eq("id", input.callId)
      .eq("state", "QUEUED")
      .select("id");
    if (moveError) {
      if (moveError.code === "23505") return "LEAD_BUSY";
      throw new Error(`voice begin dial: ${moveError.message}`);
    }
    return moved && moved.length ? "OK" : "NOT_QUEUED";
  },

  async queueCall(input) {
    const rank = ["INBOUND_CALLBACK", "CALL_REQUESTED_FRESH", "BOOKING_CLOSE", "DIRECT_CLOSE", "QUALIFICATION", "NURTURE", "REACTIVATION"].indexOf(input.priority);
    const { error } = await db()
      .from("voice_call_queue")
      .upsert(
        {
          business_id: input.businessId,
          voice_call_id: input.callId,
          priority: input.priority,
          priority_rank: rank,
          not_before: input.notBefore.toISOString(),
          claimed_at: null,
          claimed_by: null,
        },
        { onConflict: "voice_call_id" },
      );
    if (error) console.error("[voice] queue row failed", { callId: input.callId, message: error.message });
  },

  async dequeueCall(callId) {
    await db().from("voice_call_queue").delete().eq("voice_call_id", callId);
  },

  async insertCallEvent(row) {
    const { error } = await db().from("voice_call_events").insert({
      business_id: row.businessId,
      voice_call_id: row.callId,
      provider: row.provider,
      event_type: row.eventType,
      dedupe_key: row.dedupeKey,
      occurred_at: row.occurredAt,
      applied: row.applied,
      payload: row.payload,
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error(`voice call event: ${error.message}`);
  },

  async saveTranscript(input) {
    const segments = input.segments.map((t) => ({ role: t.role, content: t.content.slice(0, 4000), start_ms: t.startMs, end_ms: t.endMs }));
    const words = input.segments.reduce((n, t) => n + t.content.split(/\s+/).filter(Boolean).length, 0);
    check(
      "transcript",
      await db()
        .from("voice_call_transcripts")
        .upsert(
          { voice_call_id: input.callId, business_id: input.businessId, format: "SEGMENTS", segments, language: "en-GB", word_count: words, retain_until: input.retainUntil },
          { onConflict: "voice_call_id" },
        ),
    );
  },

  async saveOutcome(input) {
    const a = input.analysis;
    const row = {
      voice_call_id: input.callId,
      business_id: input.businessId,
      lead_id: input.leadId,
      disposition: a.disposition,
      summary: a.summary,
      facts: { ...a.facts, ...(input.qualificationBefore ? { qualification_before: input.qualificationBefore } : {}) },
      next_action: a.nextAction,
      callback_requested_for: a.callbackRequestedFor,
    };
    const withAttribution = input.attribution
      ? { ...row, attribution_spoken: input.attribution.spoken, closing_version: input.attribution.closingVersion }
      : row;
    const first = await db().from("voice_call_outcomes").upsert(withAttribution, { onConflict: "voice_call_id" });
    // Before 0162 the attribution columns do not exist: the outcome is still saved.
    if (first.error && input.attribution && ["42703", "PGRST204"].includes(first.error.code ?? "")) {
      check("outcome", await db().from("voice_call_outcomes").upsert(row, { onConflict: "voice_call_id" }));
      return;
    }
    check("outcome", first);
  },

  async saveObjections(input) {
    const { data } = await db().from("objection_events").select("objection_key").eq("business_id", input.businessId).eq("voice_call_id", input.callId);
    const have = new Set(((data ?? []) as { objection_key: string }[]).map((r) => r.objection_key));
    const rows = input.objections
      .filter((o) => !have.has(o.key))
      .map((o) => ({
        business_id: input.businessId,
        lead_id: input.leadId,
        channel: "VOICE",
        voice_call_id: input.callId,
        objection_key: o.key,
        handled_outcome: o.handledOutcome,
        evidence_excerpt: o.excerpt,
        classifier: "sales-library/matchObjection",
        confidence: 0.8,
        occurred_at: input.occurredAt,
      }));
    if (rows.length) check("objections", await db().from("objection_events").insert(rows));
  },

  async saveCostLines(input) {
    const rows = input.lines.map((l) => ({
      business_id: input.businessId,
      voice_call_id: input.callId,
      provider: l.provider,
      metric: l.metric,
      quantity: l.quantity,
      currency: "USD",
      unit_cost: l.unitCostUsd,
      total_cost: l.totalUsd,
      estimated: l.estimated,
      idempotency_key: l.idempotencyKey,
      occurred_at: input.occurredAt,
    }));
    const { error } = await db().from("voice_cost_ledger").upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error(`voice cost ledger: ${error.message}`);
  },

  async recordVoiceOptOut(input) {
    await recordVoiceSuppression(input);
    if (input.scope === "ALL") {
      // "Take me off your list" on a call: every channel, the same as the
      // text agent's applySuppression(scope all). The lead flag is what
      // follow-up, reactivation and the send guard read.
      const { data } = await db().from("leads").select("email").eq("business_id", input.businessId).eq("id", input.leadId).maybeSingle();
      await suppress({
        businessId: input.businessId,
        channel: "ALL",
        reason: "OPT_OUT",
        source: "VOICE_CALL",
        sourceReference: `voice_call:${input.callId}`,
        note: "Asked on an AI call not to be contacted again.",
        phone: input.phone,
        email: (data as { email?: string | null } | null)?.email ?? null,
      });
      const { error } = await db()
        .from("leads")
        .update({ opted_out: true, automation_active: false })
        .eq("business_id", input.businessId)
        .eq("id", input.leadId);
      if (error) throw new Error(`voice opt-out (all channels): ${error.message}`);
    }
  },

  async writeQualificationSignals(input) {
    const writes = input.analysis.signals.map((h) =>
      buildSignalWrite({
        leadId: input.leadId,
        type: h.type,
        strength: h.strength,
        confidence: h.confidence,
        source: "REPLY",
        sourceRef: `voice_call:${input.callId}`,
        observedAt: input.observedAt,
        reason: `On a call: ${h.reason}`,
        excerpt: h.excerpt,
        statedDate: h.statedDate,
        resumeAt: h.resumeAt,
      }),
    );
    if (writes.length) await writeIntentSignals(input.businessId, writes);
    await enqueueReassessment(input.businessId, input.leadId, `voice_call:${input.callId}`);
  },

  async saveRecording(input) {
    check(
      "recording",
      await db()
        .from("voice_call_recordings")
        .upsert(
          {
            business_id: input.businessId,
            voice_call_id: input.callId,
            provider: input.provider,
            provider_recording_id: input.providerRecordingId,
            status: input.status,
            object_key: input.objectKey,
            content_type: input.contentType,
            size_bytes: input.sizeBytes,
            sha256: input.sha256,
            duration_sec: input.durationSec,
            stored_at: input.status === "STORED" ? new Date().toISOString() : null,
            retain_until: input.retainUntil,
          },
          { onConflict: "provider,provider_recording_id" },
        ),
    );
  },

  async loadRecording(callId) {
    const { data } = await db().from("voice_call_recordings").select("status, object_key").eq("voice_call_id", callId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return (data as { status: string; object_key: string | null } | null) ?? null;
  },

  async setLeadNextAction(input) {
    await db().from("leads").update({ next_action: input.nextAction.slice(0, 500) }).eq("business_id", input.businessId).eq("id", input.leadId);
  },

  async loadNumberRecord(businessId) {
    const { data, error } = await db()
      .from("business_numbers")
      .select(NUMBER_COLUMNS)
      .eq("business_id", businessId)
      .not("provisioning_state", "in", "(RELEASED,QUARANTINED)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`voice number record: ${error.message}`);
    let row = data as NumberRow | null;
    if (!row) {
      // A released number still being quarantined is driven to its end too.
      const q = await db().from("business_numbers").select(NUMBER_COLUMNS).eq("business_id", businessId).in("provisioning_state", ["RELEASED", "QUARANTINED"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      row = (q.data as NumberRow | null) ?? null;
    }
    if (!row) return null;
    return { id: row.id, record: recordFromRow(row, await subaccountSidFor(businessId)) };
  },

  async createNumberRecord(businessId) {
    const { data, error } = await db().from("business_numbers").insert({ business_id: businessId, provisioning_state: "NOT_REQUESTED" }).select(NUMBER_COLUMNS).single();
    if (error) {
      if (error.code === "23505") {
        const again = await repo.loadNumberRecord(businessId);
        if (again) return again;
      }
      throw new Error(`voice number create: ${error.message}`);
    }
    return { id: (data as NumberRow).id, record: recordFromRow(data as NumberRow, await subaccountSidFor(businessId)) };
  },

  async saveNumberRecord({ id, record, expectedVersion }) {
    const { data, error } = await db().from("business_numbers").update(rowFromRecord(record)).eq("id", id).eq("version", expectedVersion).select("id");
    if (error) throw new Error(`voice number save: ${error.message}`);
    return Boolean(data && data.length);
  },

  async appendNumberEvents({ businessId, numberId, log }) {
    if (!log.length) return;
    const rows = log.map((l) => ({
      business_id: businessId,
      business_number_id: numberId,
      from_state: l.fromState,
      to_state: l.toState,
      event: l.event,
      detail: l.detail,
      idempotency_key: l.idempotencyKey,
    }));
    const { error } = await db().from("number_provisioning_events").upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error(`voice number events: ${error.message}`);
  },

  async loadProvisioningDetails(businessId) {
    const { data } = await db().from("number_provisioning_details").select("details").eq("business_id", businessId).maybeSingle();
    const details = ((data as { details: Record<string, unknown> } | null)?.details ?? {}) as Record<string, unknown>;
    const settings = await readVoiceSettings(businessId);
    return {
      ...details,
      callingAsName: settings?.calling_as_name ?? details.callingAsName,
      legalEntityName: settings?.legal_entity_name ?? details.legalEntityName,
      identificationContact: settings?.identification_contact ?? details.identificationContact,
      personaName: settings?.assistant_persona_name ?? details.personaName ?? null,
      notificationEmail: details.notificationEmail ?? serverEnv.voice.bundleNotificationEmail ?? (details.representative as { workEmail?: string } | undefined)?.workEmail,
    };
  },

  async findNumberByBundle(bundleSid) {
    const { data } = await db().from("business_numbers").select(NUMBER_COLUMNS).eq("bundle_sid", bundleSid).limit(1).maybeSingle();
    const row = data as NumberRow | null;
    if (!row) return null;
    return { id: row.id, businessId: row.business_id, record: recordFromRow(row, await subaccountSidFor(row.business_id)) };
  },

  async quarantinedE164s() {
    const { data } = await db().from("business_numbers").select("e164, provisioning_state, quarantine_until").in("provisioning_state", ["RELEASED", "QUARANTINED"]);
    const now = Date.now();
    return new Set(
      ((data ?? []) as { e164: string | null; quarantine_until: string | null; provisioning_state: string }[])
        .filter((r) => r.e164 && (r.provisioning_state === "RELEASED" || !r.quarantine_until || Date.parse(r.quarantine_until) > now))
        .map((r) => r.e164 as string),
    );
  },

  async upsertTelephonyAccount({ businessId, subaccountSid, authToken }) {
    // Voice P3 (P2 gap b): the subaccount's auth token, sealed with the
    // secret box (AES-GCM, SECRETS_ENCRYPTION_KEY), so its webhooks can be
    // verified (webhook-inbox.ts verifyTwilioVoiceRequest). Never stored in
    // clear, never returned; absent key = not stored (parent token only).
    let sealed: string | null = null;
    if (authToken && canStoreSecrets()) {
      try {
        sealed = sealSecret(authToken);
      } catch {
        sealed = null;
      }
    }
    const { data, error } = await db()
      .from("telephony_accounts")
      .upsert(
        {
          business_id: businessId,
          provider: "twilio",
          subaccount_sid: subaccountSid,
          friendly_name: `ct-${businessId}`.slice(0, 64),
          ...(sealed ? { auth_token_ciphertext: sealed } : {}),
        },
        { onConflict: "business_id,provider" },
      )
      .select("id")
      .single();
    if (error) throw new Error(`voice telephony account: ${error.message}`);
    await db().from("business_numbers").update({ telephony_account_id: (data as { id: string }).id }).eq("business_id", businessId).not("provisioning_state", "in", "(RELEASED,QUARANTINED)");
  },

  async telephonyTokenStored(businessId) {
    const { data } = await db().from("telephony_accounts").select("auth_token_ciphertext").eq("business_id", businessId).eq("provider", "twilio").maybeSingle();
    return Boolean((data as { auth_token_ciphertext: string | null } | null)?.auth_token_ciphertext);
  },

  ...p3Repo,

  async notifyOwner(input) {
    const { queueNotification } = await import("@/lib/jobs/handlers/shared");
    await queueNotification({ businessId: input.businessId, type: "billing", severity: "warning", title: input.title, body: input.body, linkUrl: input.linkUrl, dedupeKey: input.dedupeKey });
  },

  async audit(entry: AuditEntry) {
    await recordAudit({
      businessId: entry.businessId,
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorUserId ? "user" : "system",
      action: entry.action satisfies AnyAuditAction,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    });
  },
};

/** The fingerprint of saved regulatory details (stored beside them). */
export function provisioningFingerprint(details: unknown): string | null {
  const r = provisioningReadiness(details);
  return r.ready ? detailsFingerprint(r.details) : null;
}

export function serverVoiceDeps(): VoiceDeps {
  return {
    now: () => new Date(),
    // Automation triggers (gap map §45): call started/answered/missed,
    // voicemail, qualified, objections. Emitted after each write succeeds.
    repo: voiceRepoWithAutomationEvents(repo),
    minutes: supabaseMinuteStore,
    providers: voiceProviders,
    enqueue: async (type, payload, options) => {
      await enqueue(type, payload, {
        businessId: options.businessId,
        runAt: options.runAt,
        idempotencyKey: options.idempotencyKey,
        priority: options.priority,
      });
    },
    briefFor: loadVoiceCallBrief,
    maintenancePauseUntil: voiceMaintenancePauseUntil,
    storage: {
      async fetch(url: string) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`recording download failed: HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        return { bytes: buf, contentType: res.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg" };
      },
      put: (key, bytes, contentType) => putObject(key, bytes, contentType),
      sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    },
    config: {
      defaultAgentId: serverEnv.retell.agentId ?? null,
      platformKill: serverEnv.voice.callsDisabled,
      provisioningUrls: provisioningUrls(),
    },
  };
}

/* ------------------------------------------------------ inbound lookups */

/** Database reads for the inbound return-call path (inbound-core.ts). No provider I/O. */
export const inboundLookups: InboundLookups = {
  async numbersFor(e164) {
    const { data } = await db()
      .from("business_numbers")
      .select("business_id, provisioning_state, e164, messaging_service_sid, quarantine_until")
      .eq("e164", e164);
    return ((data ?? []) as { business_id: string; provisioning_state: string; e164: string | null; messaging_service_sid: string | null; quarantine_until: string | null }[]).map((r) => ({
      businessId: r.business_id,
      state: r.provisioning_state as ProvisioningState,
      e164: r.e164,
      messagingServiceSid: r.messaging_service_sid,
      quarantineUntil: r.quarantine_until,
    }));
  },
  async leadsByPhone(businessId, e164) {
    const { data } = await db()
      .from("leads")
      .select("id, business_id, phone, phone_normalized, anonymised_at, last_contact_at, created_at")
      .eq("business_id", businessId)
      .or(`phone_normalized.eq.${e164},phone.eq.${e164}`)
      .limit(20);
    return ((data ?? []) as { id: string; business_id: string; phone: string | null; phone_normalized: string | null; anonymised_at: string | null; last_contact_at: string | null; created_at: string }[]).map((l) => ({
      leadId: l.id,
      businessId: l.business_id,
      phone: l.phone_normalized ?? l.phone,
      anonymised: Boolean(l.anonymised_at),
      lastActivityAt: l.last_contact_at ?? l.created_at,
    }));
  },
  async settingsFor(businessId) {
    const s = await readVoiceSettings(businessId);
    let transferMode: "ON_REQUEST" | "ON_REQUEST_OR_ESCALATION" | "NEVER" = "ON_REQUEST";
    const tm = await db().from("voice_settings").select("transfer_mode").eq("business_id", businessId).maybeSingle();
    const raw = (tm.data as { transfer_mode?: string } | null)?.transfer_mode;
    if (!tm.error && (raw === "ON_REQUEST_OR_ESCALATION" || raw === "NEVER" || raw === "ON_REQUEST")) transferMode = raw;
    return {
      callingAsName: s?.calling_as_name ?? null,
      legalEntityName: s?.legal_entity_name ?? null,
      identificationContact: s?.identification_contact ?? null,
      personaName: s?.assistant_persona_name ?? null,
      recordingEnabled: Boolean(s?.recording_enabled),
      transferMode,
      transferNumber: s?.transfer_number_e164 ?? null,
      agentId: s?.provider_agent_id ?? null,
    };
  },
  adminControls: (businessId) => readAdminControls(businessId),
  async leadFlags(businessId, leadId) {
    const { data } = await db().from("leads").select("first_name, phone, phone_normalized, opted_out, anonymised_at").eq("business_id", businessId).eq("id", leadId).maybeSingle();
    const lead = data as { first_name: string | null; phone: string | null; phone_normalized: string | null; opted_out: boolean; anonymised_at: string | null } | null;
    // Only a suppression of ALL channels blocks: a calls-only opt-out does not
    // stop answering a call the person chose to make (inbound.ts). A failed
    // lookup is treated as suppressed: never the AI, never a text.
    let suppressed = false;
    const phone = lead ? lead.phone_normalized ?? lead.phone : null;
    if (phone) {
      try {
        suppressed = (await checkVoiceSuppression(businessId, phone)).allChannels;
      } catch {
        suppressed = true;
      }
    }
    return {
      optedOut: Boolean(lead?.opted_out),
      suppressed,
      anonymised: !lead || Boolean(lead.anonymised_at),
      firstName: lead?.first_name ?? null,
    };
  },
};

/**
 * The platform operator's voice controls (0158): the outbound pause and the
 * monthly provider-spend ceiling on voice_settings, and a suspension on the
 * live number. Spend is this calendar month's voice_cost_ledger in GBP. A read
 * failure is treated as "paused": an unknown control never lets a call through.
 */
export async function readAdminControls(businessId: string): Promise<AdminControls> {
  const client = db();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [settings, number, spend] = await Promise.all([
    client.from("voice_settings").select("admin_outbound_paused, admin_spend_limit_gbp_month").eq("business_id", businessId).maybeSingle(),
    client
      .from("business_numbers")
      .select("admin_suspended_at")
      .eq("business_id", businessId)
      .not("provisioning_state", "in", "(RELEASED,QUARANTINED)")
      .limit(1)
      .maybeSingle(),
    client.from("voice_cost_ledger").select("total_cost, currency").eq("business_id", businessId).gte("occurred_at", monthStart.toISOString()),
  ]);
  if (settings.error || number.error || spend.error) {
    return { outboundPaused: true, numberSuspended: false, spendLimitGbpMonth: null, spentGbpThisMonth: 0 };
  }
  const s = settings.data as { admin_outbound_paused: boolean | null; admin_spend_limit_gbp_month: number | string | null } | null;
  const n = number.data as { admin_suspended_at: string | null } | null;
  let spent = 0;
  for (const row of (spend.data ?? []) as { total_cost: number | string; currency: string }[]) {
    const amount = Number(row.total_cost) || 0;
    spent += row.currency === "GBP" ? amount : amount * USD_TO_GBP;
  }
  return {
    outboundPaused: Boolean(s?.admin_outbound_paused),
    numberSuspended: Boolean(n?.admin_suspended_at),
    spendLimitGbpMonth: s?.admin_spend_limit_gbp_month == null ? null : Number(s.admin_spend_limit_gbp_month),
    spentGbpThisMonth: Math.round(spent * 100) / 100,
  };
}
