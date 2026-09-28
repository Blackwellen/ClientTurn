import "server-only";
import { parseVoiceProfile, voiceProfileProblems, type VoiceProfile } from "@/lib/voice/voice-profile";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDownloadUrl } from "@/lib/storage/r2";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";
import { assertVoiceAllowed } from "@/lib/voice/entitlement";
import { buildEntitlementSnapshot, withCallRequested } from "@/lib/voice/snapshot";
import { identityReadiness } from "@/lib/voice/identity";
import { ENTITLEMENT_MESSAGES } from "@/lib/voice/dial-decision";
import { DEFAULT_CALLING_HOURS, parseCallingHoursConfig } from "@/lib/voice/calling-hours";
import { VOICE_ROUTES } from "@/lib/voice/time-governor";
import { releaseMinutes, MinuteStoreUnavailable } from "@/lib/voice/minutes-core";
import { supabaseMinuteStore, readMinuteBalance } from "@/lib/voice/minutes";
import { requestCall, scheduleNumberRelease, startProvisioning, type CallRow } from "@/lib/voice/runtime-core";
import { agentCallRefusal } from "@/lib/agents/voice-calls";
import { loadAgentCallFacts } from "@/lib/agents/voice-calls-guard";
import { loadEntitlementFacts, provisioningFingerprint, readVoiceSettings, readWorkspaceNumber, serverVoiceDeps } from "@/lib/voice/server-deps";
import { voiceIntegrationStatus } from "@/lib/voice/providers/registry";
import { provisioningReadiness } from "@/lib/voice/numbers/provisioning-details";
import { USD_TO_GBP } from "@/lib/voice/cost";
import { toCallCard, type CallCard, type CallCardRow, type TranscriptSegment } from "@/lib/voice/call-view";
import {
  canEditSection,
  numberStage,
  openerPreview,
  routeTargetsForDisplay,
  sectionsTouched,
  validateVoiceSettingsUpdate,
  voiceSettingsUpdateSchema,
  type VoiceSettingsUpdate,
} from "@/lib/voice/settings-model";

/**
 * The voice service operations (phase P2). The declarations (registry.ts)
 * carry the roles, risk and callers; the runtime has already checked them,
 * validated the arguments and demanded confirmation where the risk needs it.
 * The handlers enforce the rest server-side: section-level RBAC, the OD-1
 * identity before enabling, and the entitlement gate plus canCallLead before
 * any call (runtime-core requestCall -> decideDial).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const MISSING = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

/* ======================================================= settings_get */

export type VoiceSettingsView = {
  canEdit: boolean;
  canReleaseNumber: boolean;
  entitlement: {
    allowed: boolean;
    reason: string | null;
    reasons: string[];
    productState: string | null;
    message: string | null;
    /** A trial, demo, free or unpaid workspace: the page shows the locked, upgrade state. */
    locked: boolean;
  };
  integration: { ready: boolean; missing: string[] };
  settings: {
    voiceEnabled: boolean;
    adminKillSwitch: boolean;
    adminKillReason: string | null;
    callingAsName: string | null;
    legalEntityName: string | null;
    identificationContact: string | null;
    personaName: string | null;
    openerSuffix: string | null;
    recordingEnabled: boolean;
    recordingRetentionDays: number;
    voicemailEnabled: boolean;
    maxAttempts: number;
    concurrency: number;
    transferNumber: string | null;
    transferMode: string;
    callingHours: typeof DEFAULT_CALLING_HOURS;
    /** How the assistant sounds (0162; the default until it is applied). */
    voiceProfile: VoiceProfile;
  };
  identity: { ready: boolean; problems: string[] };
  opener: { locked: string | null; editable: string | null; full: string | null };
  regulatory: {
    ready: boolean;
    problems: string[];
    details: Record<string, unknown> | null;
    prefill: {
      legalName: string | null;
      companyNumber: string | null;
      website: string | null;
      address: string[];
      /** The registered office from Companies House, when looked up. */
      registeredAddress: { line1: string; line2: string | null; city: string; region: string | null; postcode: string; country: string } | null;
      companiesHouse: "NOT_LOOKED_UP" | "FOUND" | "NOT_FOUND";
    };
  };
  number: {
    state: string;
    stage: string;
    stageLabel: string;
    e164: string | null;
    needsAttention: boolean;
    rejectionReason: string | null;
    activatedAt: string | null;
    releaseAfter: string | null;
    timeline: { at: string; from: string; to: string; event: string }[];
  };
  minutes: {
    includedRemainingMin: number;
    packRemainingMin: number;
    periodIncludedMin: number;
    periodEnd: string | null;
    packsHeld: boolean;
    available: boolean;
  };
  routes: { route: string; enabled: boolean; percent: number | null; targetMinutes: number; maxMinutes: number }[];
};

const settingsGetSchema = z.object({ lookupCompaniesHouse: z.boolean().optional() }).default({});

async function settingsView(businessId: string, role: string, lookup: boolean): Promise<VoiceSettingsView> {
  const [facts, settingsRow, number, balance, detailsRes, allocRes, businessRes, quoteRes] = await Promise.all([
    loadEntitlementFacts(businessId),
    readVoiceSettings(businessId),
    readWorkspaceNumber(businessId),
    readMinuteBalance(businessId),
    db().from("number_provisioning_details").select("details").eq("business_id", businessId).maybeSingle(),
    db().from("voice_route_allocations").select("route, percent, enabled").eq("business_id", businessId),
    db().from("businesses").select("name, website").eq("id", businessId).maybeSingle(),
    db().from("quote_settings").select("legal_name, company_number, address_lines").eq("business_id", businessId).maybeSingle(),
  ]);

  const decision = assertVoiceAllowed(buildEntitlementSnapshot(facts));
  const locked = !decision.allowed && ["TRIAL_ACCOUNT", "DEMO_ACCOUNT", "FREE_ACCOUNT", "SUBSCRIPTION_INACTIVE", "CAPABILITY_MISSING", "NO_VOICE_PACKAGE"].includes(decision.reason);

  let transferMode = "ON_REQUEST";
  const tm = await db().from("voice_settings").select("transfer_mode").eq("business_id", businessId).maybeSingle();
  if (!tm.error) transferMode = ((tm.data as { transfer_mode?: string } | null)?.transfer_mode ?? "ON_REQUEST");
  const vp = await db().from("voice_settings").select("voice_profile").eq("business_id", businessId).maybeSingle();
  const voiceProfile = parseVoiceProfile(vp.error ? null : (vp.data as { voice_profile?: unknown } | null)?.voice_profile);

  const s = settingsRow;
  const hours = s?.calling_hours ? parseCallingHoursConfig(s.calling_hours) : null;
  const identity = identityReadiness({
    callingAsName: s?.calling_as_name,
    legalEntityName: s?.legal_entity_name,
    identificationContact: s?.identification_contact,
    personaName: s?.assistant_persona_name,
  });

  const stored = ((detailsRes.data as { details: Record<string, unknown> } | null)?.details ?? null) as Record<string, unknown> | null;
  const merged = {
    ...(stored ?? {}),
    callingAsName: s?.calling_as_name,
    legalEntityName: s?.legal_entity_name,
    identificationContact: s?.identification_contact,
    personaName: s?.assistant_persona_name ?? null,
    notificationEmail: (stored?.notificationEmail as string | undefined) ?? (stored?.representative as { workEmail?: string } | undefined)?.workEmail,
  };
  const readiness = provisioningReadiness(merged);
  const isAdmin = canEditSection(role, "identity");
  // The representative's phone and email are a colleague's personal data:
  // members and viewers see that they are set, not what they are.
  const details = stored
    ? isAdmin
      ? stored
      : {
          ...stored,
          representative: stored.representative ? { firstName: (stored.representative as { firstName?: string }).firstName ?? null, lastName: (stored.representative as { lastName?: string }).lastName ?? null, phone: "set", workEmail: "set" } : null,
        }
    : null;

  const business = businessRes.data as { name: string; website: string | null } | null;
  const quote = quoteRes.error ? null : (quoteRes.data as { legal_name: string | null; company_number: string | null; address_lines: string[] } | null);
  let companyNumber = quote?.company_number ?? null;
  let legalName = quote?.legal_name ?? null;
  let registeredAddress: VoiceSettingsView["regulatory"]["prefill"]["registeredAddress"] = null;
  let companiesHouse: VoiceSettingsView["regulatory"]["prefill"]["companiesHouse"] = "NOT_LOOKED_UP";
  if (lookup) {
    // The workspace's own registration from Companies House (COMPANIES_HOUSE_API_KEY):
    // legal name, company number and registered office. Free, first-party.
    const { ownCompanyRegistration } = await import("@/lib/find-leads/server/providers/companies-house");
    const reg = await ownCompanyRegistration({ companyNumber, name: legalName ?? business?.name ?? null });
    if (reg) {
      companiesHouse = "FOUND";
      companyNumber = reg.companyNumber;
      legalName = reg.registeredName;
      registeredAddress = reg.address;
    } else {
      companiesHouse = "NOT_FOUND";
    }
  }

  let timeline: VoiceSettingsView["number"]["timeline"] = [];
  if (number) {
    const ev = await db()
      .from("number_provisioning_events")
      .select("created_at, from_state, to_state, event")
      .eq("business_id", businessId)
      .eq("business_number_id", number.id)
      .order("created_at", { ascending: false })
      .limit(12);
    timeline = ((ev.data ?? []) as { created_at: string; from_state: string; to_state: string; event: string }[]).map((e) => ({ at: e.created_at, from: e.from_state, to: e.to_state, event: e.event }));
  }
  const stage = numberStage(number?.state ?? "NOT_REQUESTED", Boolean(number?.needsAttention));

  const allocRows = allocRes.error ? [] : ((allocRes.data ?? []) as { route: string; percent: number; enabled: boolean }[]);
  const targets = routeTargetsForDisplay();

  return {
    canEdit: isAdmin,
    canReleaseNumber: role === "owner",
    entitlement: {
      allowed: decision.allowed,
      reason: decision.allowed ? null : decision.reason,
      reasons: decision.allowed ? [] : decision.reasons,
      productState: decision.allowed ? null : decision.productState,
      message: decision.allowed ? null : (ENTITLEMENT_MESSAGES[decision.reason] ?? null),
      locked,
    },
    integration: (() => {
      const st = voiceIntegrationStatus();
      return { ready: st.ready, missing: isAdmin ? st.missing : [] };
    })(),
    settings: {
      voiceEnabled: Boolean(s?.voice_enabled),
      adminKillSwitch: Boolean(s?.admin_kill_switch),
      adminKillReason: null,
      callingAsName: s?.calling_as_name ?? null,
      legalEntityName: s?.legal_entity_name ?? null,
      identificationContact: s?.identification_contact ?? null,
      personaName: s?.assistant_persona_name ?? null,
      openerSuffix: s?.opener_suffix ?? null,
      recordingEnabled: Boolean(s?.recording_enabled),
      recordingRetentionDays: s?.recording_retention_days ?? 90,
      voicemailEnabled: Boolean(s?.voicemail_enabled),
      maxAttempts: s?.max_attempts ?? 3,
      concurrency: s?.workspace_concurrency ?? 2,
      transferNumber: s?.transfer_number_e164 ?? null,
      transferMode,
      callingHours: hours && hours.ok ? hours.config : DEFAULT_CALLING_HOURS,
      voiceProfile,
    },
    identity: { ready: identity.ready, problems: identity.ready ? [] : identity.problems.map((p) => `${p.field}:${p.problem}`) },
    opener: openerPreview({ callingAsName: s?.calling_as_name ?? null, recordingEnabled: Boolean(s?.recording_enabled), openerSuffix: s?.opener_suffix ?? null }),
    regulatory: {
      ready: readiness.ready,
      problems: readiness.ready ? [] : readiness.problems.map((p) => ("field" in p ? `${p.field}:${p.problem}` : String(p))),
      details,
      prefill: {
        legalName: legalName ?? business?.name ?? null,
        companyNumber,
        website: business?.website ?? null,
        address: quote?.address_lines ?? [],
        registeredAddress,
        companiesHouse,
      },
    },
    number: {
      state: number?.state ?? "NOT_REQUESTED",
      stage: stage.stage,
      stageLabel: stage.label,
      e164: number?.e164 ?? null,
      needsAttention: Boolean(number?.needsAttention),
      rejectionReason: number?.rejectionReason ?? null,
      activatedAt: number?.activatedAt ?? null,
      releaseAfter: number?.releaseAfter ?? null,
      timeline,
    },
    minutes: {
      includedRemainingMin: Math.floor(balance.includedRemainingSec / 60),
      packRemainingMin: Math.floor(balance.packRemainingSec / 60),
      periodIncludedMin: Math.floor(balance.periodIncludedSec / 60),
      periodEnd: balance.periodEnd,
      packsHeld: balance.packsHeld,
      available: balance.available,
    },
    routes: VOICE_ROUTES.map((route) => {
      const row = allocRows.find((r) => r.route === route);
      const t = targets.find((x) => x.route === route)!;
      return { route, enabled: row ? row.enabled : true, percent: row ? row.percent : null, targetMinutes: t.targetMinutes, maxMinutes: t.maxMinutes };
    }),
  };
}

defineOperation("voice.settings_get", {
  schema: settingsGetSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof settingsGetSchema>>) {
    const view = await settingsView(context.businessId, context.role, Boolean(args.lookupCompaniesHouse));
    return { data: view, entityId: context.businessId };
  },
});

/* ==================================================== settings_update */

defineOperation("voice.settings_update", {
  schema: voiceSettingsUpdateSchema,
  async run({ args, context }: HandlerInput<VoiceSettingsUpdate>) {
    // Section-level RBAC, re-checked here (identity, number and billing are owner/admin).
    for (const section of sectionsTouched(args)) {
      if (!canEditSection(context.role, section)) {
        throw new ServiceError("FORBIDDEN_ROLE", "Only an owner or admin can change voice settings.");
      }
    }
    const before = await readVoiceSettings(context.businessId);
    const problems = validateVoiceSettingsUpdate(args, {
      calling_as_name: before?.calling_as_name ?? null,
      legal_entity_name: before?.legal_entity_name ?? null,
      identification_contact: before?.identification_contact ?? null,
      assistant_persona_name: before?.assistant_persona_name ?? null,
    });
    if (problems.length) {
      const p = problems[0];
      const message =
        p.problem === "IDENTITY_INCOMPLETE"
          ? "Complete your calling identity (the name you call as, your legal entity and a contact address or freephone number) before switching voice on."
          : p.problem === "INVALID"
            ? "Check your calling identity: a contact must be a postal address or a UK freephone (0800/0808) number."
            : p.problem === "STYLE"
              ? "The opener text can't claim to be a person, repeat the fixed opening, use emoji or dashes, or run past 240 characters."
              : p.problem === "ALLOCATION"
                ? "Route allocations must each be 0 to 100% and add up to no more than 100%."
                : "Add a transfer number, or set transfers to never.";
      throw new ServiceError("INVALID_INPUT", message);
    }

    const patch: Record<string, unknown> = { business_id: context.businessId };
    if (args.voiceEnabled !== undefined) patch.voice_enabled = args.voiceEnabled;
    if (args.concurrency !== undefined) patch.workspace_concurrency = args.concurrency;
    if (args.identity) {
      patch.calling_as_name = args.identity.callingAsName;
      patch.legal_entity_name = args.identity.legalEntityName;
      patch.identification_contact = args.identity.identificationContact;
      if (args.identity.personaName !== undefined) patch.assistant_persona_name = args.identity.personaName || null;
    }
    if (args.agent) {
      if (args.agent.personaName !== undefined) patch.assistant_persona_name = args.agent.personaName || null;
      if (args.agent.openerSuffix !== undefined) patch.opener_suffix = args.agent.openerSuffix || null;
    }
    if (args.callingHours) patch.calling_hours = args.callingHours;
    if (args.transfer) patch.transfer_number_e164 = args.transfer.numberE164;
    if (args.voicemail) {
      patch.voicemail_enabled = args.voicemail.enabled;
      patch.max_attempts = args.voicemail.maxAttempts;
    }
    if (args.recording) {
      patch.recording_enabled = args.recording.enabled;
      patch.recording_retention_days = args.recording.retentionDays;
    }

    // Update an existing row; insert only the first time. An upsert of a
    // partial row fails here: Postgres checks the CHECK constraints on the
    // proposed insert row before it sees the conflict, so switching voice on
    // ({ voice_enabled: true } alone) tripped voice_settings_identity_before_enable
    // even with the identity already saved (owner test call, 2026-09-28).
    const { business_id: _businessId, ...changes } = patch;
    void _businessId;
    const { error } = before
      ? await db().from("voice_settings").update(changes).eq("business_id", context.businessId)
      : await db().from("voice_settings").insert(patch);
    if (error) {
      if (error.code === "23514") throw new ServiceError("INVALID_INPUT", "Complete your calling identity before switching voice on.");
      throw new ServiceError("UNAVAILABLE", "Voice settings could not be saved. Try again.");
    }
    if (args.voiceProfile) {
      const problems = voiceProfileProblems(args.voiceProfile);
      if (problems.includes("UNKNOWN_VOICE")) throw new ServiceError("INVALID_INPUT", "Choose one of the listed voices.");
      if (problems.includes("PREMIUM_NOT_ACCEPTED")) {
        throw new ServiceError("INVALID_INPUT", "A premium voice costs 20p a minute more. Tick the box to accept it, or choose a standard voice.");
      }
      const v = await db().from("voice_settings").update({ voice_profile: args.voiceProfile }).eq("business_id", context.businessId);
      if (v.error) {
        if (v.error.code && MISSING.has(v.error.code)) throw new ServiceError("UNAVAILABLE", "Voice choice is not available on this database yet.");
        throw new ServiceError("UNAVAILABLE", "The voice could not be saved.");
      }
    }
    if (args.transfer) {
      const t = await db().from("voice_settings").update({ transfer_mode: args.transfer.mode }).eq("business_id", context.businessId);
      if (t.error && !(t.error.code && MISSING.has(t.error.code))) throw new ServiceError("UNAVAILABLE", "The transfer setting could not be saved.");
    }
    if (args.regulatory) {
      const stored = await db().from("number_provisioning_details").select("details").eq("business_id", context.businessId).maybeSingle();
      const prev = ((stored.data as { details: Record<string, unknown> } | null)?.details ?? {}) as Record<string, unknown>;
      const details = { ...prev, ...args.regulatory, registrationAuthority: "Companies House", businessClassification: "DIRECT_CUSTOMER" };
      const fp = provisioningFingerprint({
        ...details,
        callingAsName: patch.calling_as_name ?? before?.calling_as_name,
        legalEntityName: patch.legal_entity_name ?? before?.legal_entity_name,
        identificationContact: patch.identification_contact ?? before?.identification_contact,
        notificationEmail: (details as { representative?: { workEmail?: string } }).representative?.workEmail,
      });
      const w = await db()
        .from("number_provisioning_details")
        .upsert({ business_id: context.businessId, details, fingerprint: fp ?? "incomplete", updated_by: context.userId }, { onConflict: "business_id" });
      if (w.error) throw new ServiceError("UNAVAILABLE", "Your business details could not be saved. Try again.");
      // A number waiting on these details (or on a fix after a rejection) moves on.
      const number = await readWorkspaceNumber(context.businessId);
      if (number && ["DETAILS_REQUIRED", "BUNDLE_REJECTED", "SUBACCOUNT_CREATED"].includes(number.state)) {
        await serverVoiceDeps().enqueue("voice.number_provision", { businessId: context.businessId }, { businessId: context.businessId, idempotencyKey: `voice.number_provision:${context.businessId}:details:${fp ?? "x"}` });
      }
    }
    if (args.routes) {
      const rows = args.routes.map((r) => ({ business_id: context.businessId, route: r.route, percent: r.percent ?? 0, enabled: r.enabled }));
      const a = await db().from("voice_route_allocations").upsert(rows, { onConflict: "business_id,route" });
      if (a.error) throw new ServiceError("INVALID_INPUT", "Route allocations must add up to no more than 100%.");
    }

    const after = await readVoiceSettings(context.businessId);
    return {
      data: { saved: true, sections: sectionsTouched(args) },
      entityId: context.businessId,
      before: before ? { ...before } : null,
      after: after ? { ...after, sections: sectionsTouched(args) } : { sections: sectionsTouched(args) },
    };
  },
});

/* ====================================================== number ops */

defineOperation("voice.number_request", {
  schema: z.object({}).default({}),
  async run({ context }) {
    const facts = await loadEntitlementFacts(context.businessId);
    const snap = buildEntitlementSnapshot(facts);
    const decision = assertVoiceAllowed(snap);
    const blocking = decision.allowed
      ? []
      : decision.reasons.filter((r) => !["NO_NUMBER", "VOICE_DISABLED_IN_SETTINGS", "IDENTITY_INCOMPLETE", "NO_MINUTES", "INSUFFICIENT_MINUTES"].includes(r));
    // A number is bought for a paying voice workspace only: never in a trial.
    if (blocking.length || !(facts.grants.proVoiceItem || facts.grants.numberItem)) {
      const reason = blocking[0] ?? "NO_VOICE_PACKAGE";
      throw new ServiceError("PLAN_LIMIT", reason === "NO_VOICE_PACKAGE" ? "Add the dedicated number (or the Pro voice item) in Settings, Voice, Budget first." : (ENTITLEMENT_MESSAGES[reason] ?? "Voice isn't available on this workspace."));
    }
    const deps = serverVoiceDeps();
    if (!deps.providers().numbers || !deps.config.provisioningUrls) {
      throw new ServiceError("UNAVAILABLE", "Number set-up isn't connected on this environment yet.");
    }
    const before = await readWorkspaceNumber(context.businessId);
    const started = await startProvisioning(deps, context.businessId);
    return {
      data: started,
      entityId: context.businessId,
      before: before ? { state: before.state } : null,
      after: { state: started.state },
    };
  },
});

defineOperation("voice.number_status", {
  schema: z.object({}).default({}),
  async run({ context }) {
    const view = await settingsView(context.businessId, context.role, false);
    return { data: view.number, entityId: context.businessId };
  },
});

defineOperation("voice.number_release", {
  schema: z.object({ confirmE164: z.string().trim().min(8).max(20) }),
  async run({ args, context }: HandlerInput<{ confirmE164: string }>) {
    const number = await readWorkspaceNumber(context.businessId);
    if (!number || !number.e164) throw new ServiceError("NOT_FOUND", "This workspace has no dedicated number to release.");
    if (number.e164.replace(/\s+/g, "") !== args.confirmE164.replace(/\s+/g, "")) {
      throw new ServiceError("INVALID_INPUT", "Type the number exactly as shown to confirm the release.");
    }
    const deps = serverVoiceDeps();
    // Queued calls are cancelled: no new call may start from a number being released.
    const queued = await db().from("voice_calls").select("id, route").eq("business_id", context.businessId).in("state", ["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED"]);
    for (const q of (queued.data ?? []) as { id: string; route: string }[]) await cancelQueued(context.businessId, q.id, q.route, "NUMBER_RELEASED");
    const result = await scheduleNumberRelease(deps, { businessId: context.businessId });
    return {
      data: result,
      entityId: number.id,
      before: { state: number.state, e164: number.e164 },
      after: { state: result.state },
    };
  },
});

/* ======================================================= calls */

const requestCallSchema = z.object({
  leadId: z.uuid(),
  route: z.enum(VOICE_ROUTES).default("QUALIFICATION"),
  /**
   * A team member recording that the lead asked to be called (the evidence of
   * CALL_REQUESTED). A person's statement about consent: UI only.
   */
  recordCallRequest: z.object({ note: z.string().trim().min(3).max(500) }).optional(),
  /**
   * The agent asking ("Phone leads with AI", 0176). Required for, and only
   * accepted from, caller AGENT: a person or client cannot attribute a call
   * to an agent, and an agent cannot call without naming itself.
   */
  agentId: z.uuid().optional(),
});
type RequestCallArgs = z.infer<typeof requestCallSchema>;

defineOperation("voice.request_call", {
  schema: requestCallSchema,
  async run({ args, context }: HandlerInput<RequestCallArgs>) {
    if (args.recordCallRequest) {
      if (context.caller !== "UI") throw new ServiceError("FORBIDDEN_SCOPE", "Only a person in the app can record that a lead asked to be called.");
      await recordCallRequest(context.businessId, args.leadId, args.recordCallRequest.note, context.userId);
    }
    // An agent asking (caller AGENT). Its own checks come first: the agent is
    // running with "Phone leads with AI" on, the workspace's "Phone leads"
    // permission is on (never widened here), the route is one the agent makes
    // and its daily cap is not spent. The lead's eligibility is then decided
    // by requestCall -> decideDial exactly as for the button.
    let requestedByAgentId: string | null = null;
    if (context.caller === "AGENT") {
      if (!args.agentId) throw new ServiceError("FORBIDDEN_SCOPE", "Only an agent with Phone leads with AI on can ask for a call.");
      const facts = await loadAgentCallFacts(context.businessId, args.agentId, args.route, new Date());
      const refusal = agentCallRefusal(facts);
      if (refusal) throw new ServiceError(refusal.code, refusal.message, [{ code: "permission-denied", message: refusal.reason }]);
      requestedByAgentId = args.agentId;
    } else if (args.agentId) {
      throw new ServiceError("FORBIDDEN_SCOPE", "Only an agent can ask for a call as an agent.");
    }
    const result = await requestCall(serverVoiceDeps(), {
      businessId: context.businessId,
      leadId: args.leadId,
      route: args.route,
      entryPoint: context.caller === "MCP" ? "MCP" : context.caller === "API" ? "API" : "OUTBOUND_DIAL",
      // An agent is never a person: it keeps the human-takeover hold.
      requestedBy: context.caller === "AGENT" ? null : context.userId,
      ...(requestedByAgentId ? { requestedByAgentId } : {}),
    });
    if (!result.ok) throw new ServiceError(result.code === "NOT_FOUND" ? "NOT_FOUND" : result.code, result.message, [{ code: result.productState, message: result.reason }]);
    return {
      data: result,
      entityId: result.callId,
      after: {
        lead_id: args.leadId,
        route: args.route,
        scheduled_for: result.scheduledFor,
        deferred_reason: result.deferredReason,
        ...(requestedByAgentId ? { agent_id: requestedByAgentId } : {}),
      },
      warnings: result.deferredReason
        ? [{ code: "deferred", message: result.deferredReason === "OUTSIDE_CALLING_HOURS" ? "It's outside the lead's calling hours, so the call is booked for when they open." : "The call is queued and will start shortly." }]
        : [],
    };
  },
});

async function recordCallRequest(businessId: string, leadId: string, note: string, userId: string | null): Promise<void> {
  const client = db();
  const lead = await client.from("leads").select("id, phone, phone_source, anonymised_at").eq("business_id", businessId).eq("id", leadId).maybeSingle();
  const row = lead.data as { id: string; phone: string | null; phone_source: string | null; anonymised_at: string | null } | null;
  if (!row || row.anonymised_at) throw new ServiceError("NOT_FOUND", "That lead could not be found.");
  const perm = await client.from("contact_permissions").select("id, consent_scope").eq("business_id", businessId).eq("subject_type", "LEAD").eq("subject_id", leadId).maybeSingle();
  const wording = `Recorded by a team member: the lead asked to be called. ${note}`.slice(0, 2000);
  const now = new Date().toISOString();
  if (perm.data) {
    const p = perm.data as { id: string; consent_scope: unknown };
    const w = await client.from("contact_permissions").update({ consent_scope: withCallRequested(p.consent_scope), consent_captured_at: now, call_consent_wording: wording, recorded_by: userId }).eq("id", p.id);
    if (w.error) throw new ServiceError("UNAVAILABLE", "The call request could not be recorded.");
  } else {
    const w = await client.from("contact_permissions").insert({
      business_id: businessId,
      subject_type: "LEAD",
      subject_id: leadId,
      relationship_type: "THEY_CONTACTED_US",
      consent_status: "GRANTED",
      consent_scope: ["CALL_REQUESTED"],
      consent_captured_at: now,
      call_consent_wording: wording,
      phone_e164: row.phone,
      recorded_by: userId,
    });
    if (w.error) throw new ServiceError("UNAVAILABLE", "The call request could not be recorded.");
  }
  // The number was given for this purpose by the lead; an enrichment or import source is never overwritten.
  if (!row.phone_source || row.phone_source === "UNKNOWN") {
    await client.from("leads").update({ phone_source: "MANUAL_BY_LEAD_REQUEST" }).eq("business_id", businessId).eq("id", leadId);
  }
  // Automation trigger (gap map §45): the lead now has a basis to be called.
  // canCallLead still decides each call; this only says the basis exists.
  const { emitAutomationEvent } = await import("@/lib/automation/events");
  await emitAutomationEvent({ businessId, leadId, eventType: "voice.lead_eligible", payload: { leadId, basis: "CALL_REQUESTED" } });
}

async function cancelQueued(businessId: string, callId: string, route: string, reason: string): Promise<boolean> {
  const { data } = await db()
    .from("voice_calls")
    .update({ state: "CANCELLED", outcome: "CANCELLED", disconnection_reason: reason, ended_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("id", callId)
    .in("state", ["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED"])
    .select("id");
  await db().from("voice_call_queue").delete().eq("voice_call_id", callId);
  try {
    await releaseMinutes(supabaseMinuteStore, { businessId, callId, route });
  } catch (error) {
    if (!(error instanceof MinuteStoreUnavailable)) throw error;
  }
  return Boolean(data && data.length);
}

defineOperation("voice.cancel_call", {
  schema: z.object({ callId: z.uuid() }),
  async run({ args, context }: HandlerInput<{ callId: string }>) {
    const { data } = await db().from("voice_calls").select("id, state, route, lead_id").eq("business_id", context.businessId).eq("id", args.callId).maybeSingle();
    const call = data as { id: string; state: string; route: string; lead_id: string } | null;
    if (!call) throw new ServiceError("NOT_FOUND", "That call could not be found.");
    const cancelled = await cancelQueued(context.businessId, call.id, call.route, "CANCELLED_BY_USER");
    if (!cancelled) throw new ServiceError("CONFLICT", "That call has already started or finished, so it can't be cancelled.");
    return { data: { cancelled: true }, entityId: call.id, before: { state: call.state }, after: { state: "CANCELLED" } };
  },
});

/* =================================================== call reads */

const CARD_COLUMNS =
  "id, lead_id, direction, route, state, to_e164, from_e164, created_at, started_at, answered_at, ended_at, duration_sec, billed_sec, outcome, recording_enabled, persona_name, attempt_number";

async function cardsFor(businessId: string, role: string, rows: (CallCardRow & { lead_id: string })[], withDetail: boolean): Promise<CallCard[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const client = db();
  const admin = role === "owner" || role === "admin";
  const [outcomes, objections, leads, costs, transcripts, recordings] = await Promise.all([
    client.from("voice_call_outcomes").select("voice_call_id, disposition, summary, facts, next_action, callback_requested_for").eq("business_id", businessId).in("voice_call_id", ids),
    client.from("objection_events").select("voice_call_id, objection_key, handled_outcome").eq("business_id", businessId).in("voice_call_id", ids),
    client.from("leads").select("id, qualification_state").eq("business_id", businessId).in("id", [...new Set(rows.map((r) => r.lead_id))]),
    // ClientTurn's cost: read only for an owner or admin, so it never leaves the server otherwise.
    admin ? client.from("voice_cost_ledger").select("voice_call_id, total_cost, currency").eq("business_id", businessId).in("voice_call_id", ids) : Promise.resolve({ data: [], error: null }),
    withDetail ? client.from("voice_call_transcripts").select("voice_call_id, segments").eq("business_id", businessId).in("voice_call_id", ids) : Promise.resolve({ data: [], error: null }),
    withDetail ? client.from("voice_call_recordings").select("voice_call_id, status, object_key").eq("business_id", businessId).in("voice_call_id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  const byCall = <T extends { voice_call_id: string }>(list: T[] | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const x of list ?? []) m.set(x.voice_call_id, [...(m.get(x.voice_call_id) ?? []), x]);
    return m;
  };
  const oc = byCall((outcomes.data ?? []) as { voice_call_id: string; disposition: string; summary: string | null; facts: Record<string, unknown>; next_action: string | null; callback_requested_for: string | null }[]);
  const ob = byCall((objections.data ?? []) as { voice_call_id: string; objection_key: string; handled_outcome: string | null }[]);
  const co = byCall((costs.data ?? []) as { voice_call_id: string; total_cost: number; currency: string }[]);
  const tr = byCall((transcripts.data ?? []) as { voice_call_id: string; segments: TranscriptSegment[] | null }[]);
  const rc = byCall((recordings.data ?? []) as { voice_call_id: string; status: string; object_key: string | null }[]);
  const qual = new Map(((leads.data ?? []) as { id: string; qualification_state: string | null }[]).map((l) => [l.id, l.qualification_state]));
  const calledBy = await agentNamesFor(businessId, ids);

  const cards: CallCard[] = [];
  for (const row of rows) {
    const outcome = oc.get(row.id)?.[0] ?? null;
    const costLines = co.get(row.id) ?? [];
    const costGbp = costLines.length ? Math.round(costLines.reduce((n, l) => n + Number(l.total_cost), 0) * USD_TO_GBP * 100) / 100 : null;
    const rec = rc.get(row.id)?.[0] ?? null;
    let url: string | null = null;
    if (withDetail && rec?.status === "STORED" && rec.object_key && row.recording_enabled) {
      try {
        url = await createDownloadUrl(rec.object_key, 300);
      } catch {
        url = null;
      }
    }
    const before = (outcome?.facts?.qualification_before as string | undefined) ?? null;
    cards.push(
      toCallCard({
        row,
        outcome: outcome ? { disposition: outcome.disposition, summary: outcome.summary, facts: outcome.facts ?? {}, next_action: outcome.next_action, callback_requested_for: outcome.callback_requested_for } : null,
        transcript: withDetail ? (tr.get(row.id)?.[0]?.segments ?? null) : null,
        recording: rec ? { status: rec.status, url } : null,
        objections: ob.get(row.id) ?? [],
        costGbp,
        qualificationChange: before ? { before, after: qual.get(row.lead_id) ?? null } : null,
        viewerRole: role,
        calledBy: calledBy.get(row.id) ?? null,
      }),
    );
  }
  return cards;
}

/**
 * "Called by <agent>": the agent behind each call that one asked for (0176).
 * A separate, tolerant read so call cards still load before 0176 is applied.
 */
async function agentNamesFor(businessId: string, callIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const calls = await db().from("voice_calls").select("id, requested_by_agent_id").eq("business_id", businessId).in("id", callIds);
  if (calls.error) return names;
  const rows = ((calls.data ?? []) as { id: string; requested_by_agent_id: string | null }[]).filter((r) => r.requested_by_agent_id);
  if (!rows.length) return names;
  const agents = await db()
    .from("agents")
    .select("id, name")
    .eq("business_id", businessId)
    .in("id", [...new Set(rows.map((r) => r.requested_by_agent_id as string))]);
  const byId = new Map(((agents.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  for (const r of rows) names.set(r.id, byId.get(r.requested_by_agent_id as string) ?? "an agent");
  return names;
}

const callsListSchema = z.object({ leadId: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(25) }).default({ limit: 25 });

defineOperation("voice.calls_list", {
  schema: callsListSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof callsListSchema>>) {
    let q = db().from("voice_calls").select(CARD_COLUMNS).eq("business_id", context.businessId).order("created_at", { ascending: false }).limit(args.limit);
    if (args.leadId) q = q.eq("lead_id", args.leadId);
    const { data, error } = await q;
    if (error) {
      if (error.code && MISSING.has(error.code)) return { data: { calls: [] as CallCard[] } };
      throw new ServiceError("UNAVAILABLE", "Calls could not be loaded.");
    }
    const calls = await cardsFor(context.businessId, context.role, (data ?? []) as (CallCardRow & { lead_id: string })[], Boolean(args.leadId));
    return { data: { calls } };
  },
});

defineOperation("voice.call_get", {
  schema: z.object({ callId: z.uuid() }),
  async run({ args, context }: HandlerInput<{ callId: string }>) {
    const { data } = await db().from("voice_calls").select(CARD_COLUMNS).eq("business_id", context.businessId).eq("id", args.callId).maybeSingle();
    if (!data) throw new ServiceError("NOT_FOUND", "That call could not be found.");
    const [card] = await cardsFor(context.businessId, context.role, [data as CallCardRow & { lead_id: string }], true);
    return { data: { call: card }, entityId: args.callId };
  },
});

/* ============================================ platform kill switch */

defineOperation("voice.admin_disable_workspace", {
  schema: z.object({ disabled: z.boolean(), reason: z.string().trim().min(3).max(500) }),
  async run({ args, context }: HandlerInput<{ disabled: boolean; reason: string }>) {
    const before = await readVoiceSettings(context.businessId);
    const { error } = await db()
      .from("voice_settings")
      .upsert({ business_id: context.businessId, admin_kill_switch: args.disabled, admin_kill_reason: args.reason }, { onConflict: "business_id" });
    if (error) throw new ServiceError("UNAVAILABLE", "The kill switch could not be saved.");
    let cancelled = 0;
    if (args.disabled) {
      const queued = await db().from("voice_calls").select("id, route").eq("business_id", context.businessId).in("state", ["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED"]);
      for (const q of (queued.data ?? []) as Pick<CallRow, "id" | "route">[]) if (await cancelQueued(context.businessId, q.id, q.route, "ADMIN_KILL_SWITCH")) cancelled++;
    }
    return {
      data: { disabled: args.disabled, cancelledQueued: cancelled },
      entityId: context.businessId,
      before: { admin_kill_switch: Boolean(before?.admin_kill_switch) },
      after: { admin_kill_switch: args.disabled, reason: args.reason },
    };
  },
});
