/**
 * Assembling the inputs of the two voice gates from stored rows. Pure.
 *
 *   - `buildEntitlementSnapshot`  rows -> `VoiceEntitlementSnapshot`, the input
 *                                 of `assertVoiceAllowed` (entitlement.ts).
 *   - `callConsentFrom`           the lead's `contact_permissions` row -> the
 *                                 call consent `canCallLead` reads.
 *   - `phoneSourceOf`             the stored `leads.phone_source`, never guessed.
 *
 * Kept apart from the server read so the mapping (and therefore "a trial can
 * never dial") is asserted in tests without a database.
 */

import type { PlanKey, SubscriptionStatus, VoiceEntitlementSnapshot } from "./entitlement.ts";
import { CONSENT_BASES, type ConsentBasis, type PhoneSource, type SubscriberType } from "./eligibility.ts";

const PLAN_KEYS: readonly PlanKey[] = ["trial", "starter", "growth", "pro", "enterprise", "free"];

/** `subscriptions.status` (upper case, billing/stripe.ts) -> the gate's vocabulary. */
export function subscriptionStatusOf(status: string | null | undefined): SubscriptionStatus {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "TRIALING":
    case "TRIALLING":
      return "trialing";
    case "PAST_DUE":
      return "past_due";
    case "CANCELLED":
    case "CANCELED":
      return "canceled";
    case "UNPAID":
      return "unpaid";
    case "INCOMPLETE":
      return "incomplete";
    default:
      return "none";
  }
}

/** Any plan key the gate does not know is treated as free: it can never dial. */
export function planKeyOf(plan: string | null | undefined): PlanKey {
  const p = (plan ?? "").toLowerCase();
  return (PLAN_KEYS as readonly string[]).includes(p) ? (p as PlanKey) : "free";
}

/** A workspace flagged as a demo or sandbox never places a live call. */
export function isDemoBusinessStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "DEMO" || s === "SANDBOX";
}

export type EntitlementFacts = {
  /** `getEntitlements().plan`: "trial" while trialling, whatever tier was chosen. */
  plan: string;
  /** `subscriptions.status`. */
  subscriptionStatus: string | null;
  businessStatus: string | null;
  /** `can(businessId, "voice_sales_enabled").allowed`. */
  voiceCapability: boolean;
  /** Live grants written by the Stripe sync (reason STRIPE_ITEM:...). */
  grants: { proVoiceItem: boolean; numberItem: boolean };
  /** Any PACK_PURCHASE row in the minute ledger. */
  packsHeld: boolean;
  balance: { includedRemainingSec: number; packRemainingSec: number };
  /** The platform kill switch (VOICE_CALLS_DISABLED). */
  platformKill: boolean;
  settings: {
    voice_enabled: boolean;
    admin_kill_switch: boolean;
    calling_as_name: string | null;
    legal_entity_name: string | null;
    identification_contact: string | null;
    assistant_persona_name: string | null;
  } | null;
  number: { provisioning_state: string; e164: string | null } | null;
  /** The workspace's AI assistant is on (see VoiceEntitlementSnapshot.settings). Absent = not read. */
  aiAssistantOn?: boolean;
};

export function buildEntitlementSnapshot(f: EntitlementFacts): VoiceEntitlementSnapshot {
  return {
    plan: planKeyOf(f.plan),
    subscriptionStatus: subscriptionStatusOf(f.subscriptionStatus),
    isDemoWorkspace: isDemoBusinessStatus(f.businessStatus),
    voiceCapability: f.voiceCapability,
    packaging: {
      proVoiceItem: f.grants.proVoiceItem,
      addonPacksHeld: f.packsHeld,
      dedicatedNumberItem: f.grants.numberItem,
    },
    minutes: {
      includedRemainingSec: Math.max(0, f.balance.includedRemainingSec),
      packRemainingSec: Math.max(0, f.balance.packRemainingSec),
    },
    killSwitch: { platform: f.platformKill, workspace: Boolean(f.settings?.admin_kill_switch) },
    settings: { voiceEnabled: Boolean(f.settings?.voice_enabled), ...(f.aiAssistantOn === undefined ? {} : { aiAssistantOn: f.aiAssistantOn }) },
    identity: {
      callingAsName: f.settings?.calling_as_name ?? null,
      legalEntityName: f.settings?.legal_entity_name ?? null,
      identificationContact: f.settings?.identification_contact ?? null,
      personaName: f.settings?.assistant_persona_name ?? null,
    },
    number: f.number ? { state: f.number.provisioning_state, e164: f.number.e164 } : null,
  };
}

/* ------------------------------------------------------------------ consent */

export type PermissionRow = {
  consent_scope: unknown;
  consent_status: string | null;
  consent_captured_at: string | null;
  call_consent_wording: string | null;
  consent_evidence?: string | null;
  subscriber_type: string | null;
  tps_listed: boolean | null;
  ctps_listed: boolean | null;
};

export type CallConsent = {
  basis: ConsentBasis | null;
  capturedAt: Date | null;
  withdrawn: boolean;
  evidenceText: string | null;
};

/**
 * The strongest call basis recorded in `consent_scope` (0150: the bases sit
 * beside the channel names). CALL_REQUESTED outranks FORM_CONSENT_TO_CALL,
 * which outranks PHONE_NUMBER_PROVIDED. Nothing recorded = no basis.
 */
export function callConsentFrom(permission: PermissionRow | null): CallConsent {
  if (!permission) return { basis: null, capturedAt: null, withdrawn: false, evidenceText: null };
  const scope = Array.isArray(permission.consent_scope) ? permission.consent_scope.map((v) => String(v).toUpperCase()) : [];
  const basis = CONSENT_BASES.find((b) => scope.includes(b)) ?? null;
  const captured = permission.consent_captured_at ? new Date(permission.consent_captured_at) : null;
  return {
    basis,
    capturedAt: captured && Number.isFinite(captured.getTime()) ? captured : null,
    withdrawn: (permission.consent_status ?? "").toUpperCase() === "WITHDRAWN",
    evidenceText: permission.call_consent_wording ?? permission.consent_evidence ?? null,
  };
}

const PHONE_SOURCES: readonly PhoneSource[] = [
  "LEAD_FORM",
  "LEAD_MESSAGE",
  "INBOUND_CALL",
  "MANUAL_BY_LEAD_REQUEST",
  "ENRICHMENT",
  "IMPORT",
  "UNKNOWN",
];

/** Only the stored value counts (CLAUDE.md rule 6): an unrecorded source is UNKNOWN. */
export function phoneSourceOf(value: string | null | undefined): PhoneSource {
  const v = (value ?? "").toUpperCase();
  return (PHONE_SOURCES as readonly string[]).includes(v) ? (v as PhoneSource) : "UNKNOWN";
}

const SUBSCRIBER_TYPES: readonly SubscriberType[] = ["CORPORATE", "SOLE_TRADER", "PARTNERSHIP", "INDIVIDUAL", "UNKNOWN"];

export function subscriberTypeOf(value: string | null | undefined): SubscriberType {
  const v = (value ?? "").toUpperCase();
  return (SUBSCRIBER_TYPES as readonly string[]).includes(v) ? (v as SubscriberType) : "UNKNOWN";
}

/** A lead asking to be called, recorded by a person: the scope gains CALL_REQUESTED. */
export function withCallRequested(scope: unknown): string[] {
  const list = Array.isArray(scope) ? scope.map(String) : [];
  return list.includes("CALL_REQUESTED") ? list : [...list, "CALL_REQUESTED"];
}
