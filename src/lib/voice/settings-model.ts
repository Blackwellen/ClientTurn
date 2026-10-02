/**
 * Settings → Voice: the input contract, who may change what, and the rules
 * that are checked before anything is saved. Pure (no `server-only`), so the
 * service operation, the form and the tests share one definition.
 *
 * Sections (gap map §44, progressive disclosure):
 *   overview · identity · number · agent · hours · routes · transfer ·
 *   voicemail · recording · budget
 *
 * RBAC: identity, number and budget (billing) are owner/admin only; the rest
 * need admin too, because each one changes how an AI speaks for the business.
 * Members and viewers can read the page. A number release is owner only.
 *
 * OD-1: voice cannot be switched on until the caller identity is complete
 * (identity.ts `identityReadiness`). The locked opener is never stored; only
 * the customer-editable remainder (`opener_suffix`), validated by
 * opener.ts `validateEditableSuffix`.
 */

import { voiceProfileSchema } from "./voice-profile.ts";
import { z } from "zod";
import { callingHoursConfigSchema } from "./calling-hours.ts";
import { identityReadiness, type IdentityProblem } from "./identity.ts";
import { buildLockedPreamble, validateEditableSuffix, type StyleViolation } from "./opener.ts";
import { VOICE_ROUTES, ROUTE_TARGETS, type VoiceRouteKey } from "./time-governor.ts";
import { validateAllocations } from "./budget.ts";
import { COMPANY_NUMBER } from "./numbers/provisioning-details.ts";
import { DIALLABLE_CLASSES, classifyDestination } from "./destinations.ts";

export const VOICE_SETTINGS_SECTIONS = [
  "overview",
  "identity",
  "number",
  "agent",
  "hours",
  "routes",
  "transfer",
  "voicemail",
  "recording",
  "budget",
] as const;
export type VoiceSettingsSection = (typeof VOICE_SETTINGS_SECTIONS)[number];

export type Role = "owner" | "admin" | "member" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** The minimum role to CHANGE a section. Everyone in the workspace can read. */
export const SECTION_EDIT_ROLE: Readonly<Record<VoiceSettingsSection, Role>> = {
  overview: "admin",
  identity: "admin",
  number: "admin",
  agent: "admin",
  hours: "admin",
  routes: "admin",
  transfer: "admin",
  voicemail: "admin",
  recording: "admin",
  budget: "admin",
};

/** Releasing the number is irreversible for the workspace: owner only. */
export const NUMBER_RELEASE_ROLE: Role = "owner";

export function canEditSection(role: string, section: VoiceSettingsSection): boolean {
  return (RANK[role as Role] ?? -1) >= RANK[SECTION_EDIT_ROLE[section]];
}

export function canReleaseNumber(role: string): boolean {
  return (RANK[role as Role] ?? -1) >= RANK[NUMBER_RELEASE_ROLE];
}

/* ------------------------------------------------------------ the contract */

const e164 = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "an international number, like +447700900123");

export const TRANSFER_MODES = ["ON_REQUEST", "ON_REQUEST_OR_ESCALATION", "NEVER"] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const voiceSettingsUpdateSchema = z
  .object({
    voiceEnabled: z.boolean().optional(),
    identity: z
      .object({
        callingAsName: z.string().trim().min(1).max(80),
        legalEntityName: z.string().trim().min(1).max(160),
        identificationContact: z.string().trim().min(1).max(300),
        personaName: z.string().trim().max(40).nullable().optional(),
      })
      .optional(),
    regulatory: z
      .object({
        companyNumber: z
          .string()
          .trim()
          .transform((s) => s.toUpperCase().replace(/\s+/g, ""))
          .pipe(z.string().regex(COMPANY_NUMBER, "8 digits, or 2 letters and 6 digits")),
        websiteUrl: z.string().trim().url(),
        registeredAddress: z.object({
          line1: z.string().trim().min(1).max(120),
          line2: z.string().trim().max(120).nullable().optional(),
          city: z.string().trim().min(1).max(80),
          region: z.string().trim().max(80).nullable().optional(),
          postcode: z.string().trim().min(2).max(12),
          country: z.string().trim().regex(/^[A-Z]{2}$/).default("GB"),
        }),
        representative: z.object({
          firstName: z.string().trim().min(1).max(60),
          lastName: z.string().trim().min(1).max(60),
          phone: z.string().trim().min(5).max(30),
          workEmail: z.string().trim().email(),
        }),
      })
      .optional(),
    agent: z
      .object({
        personaName: z.string().trim().max(40).nullable().optional(),
        openerSuffix: z.string().trim().max(240).nullable().optional(),
      })
      .optional(),
    callingHours: callingHoursConfigSchema.optional(),
    /** How the assistant sounds (voice-profile.ts); a premium voice needs premiumAccepted. */
    voiceProfile: voiceProfileSchema.optional(),
    routes: z
      .array(
        z.object({
          route: z.enum(VOICE_ROUTES),
          enabled: z.boolean(),
          percent: z.number().int().min(0).max(100).nullable(),
        }),
      )
      .max(VOICE_ROUTES.length)
      .optional(),
    transfer: z
      .object({
        numberE164: e164.nullable(),
        mode: z.enum(TRANSFER_MODES).default("ON_REQUEST"),
      })
      .optional(),
    voicemail: z
      .object({
        enabled: z.boolean(),
        maxAttempts: z.number().int().min(1).max(5),
      })
      .optional(),
    recording: z
      .object({
        enabled: z.boolean(),
        retentionDays: z.number().int().min(1).max(365),
      })
      .optional(),
    concurrency: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type VoiceSettingsUpdate = z.infer<typeof voiceSettingsUpdateSchema>;

/** Which sections an update touches (for the RBAC check and the audit row). */
export function sectionsTouched(update: VoiceSettingsUpdate): VoiceSettingsSection[] {
  const out = new Set<VoiceSettingsSection>();
  if (update.voiceEnabled !== undefined || update.concurrency !== undefined) out.add("overview");
  if (update.identity) out.add("identity");
  if (update.regulatory) out.add("number");
  if (update.agent || update.voiceProfile) out.add("agent");
  if (update.callingHours) out.add("hours");
  if (update.routes) out.add("routes");
  if (update.transfer) out.add("transfer");
  if (update.voicemail) out.add("voicemail");
  if (update.recording) out.add("recording");
  return [...out];
}

export type StoredIdentity = {
  calling_as_name: string | null;
  legal_entity_name: string | null;
  identification_contact: string | null;
  assistant_persona_name: string | null;
};

export type UpdateProblem =
  | { field: "voiceEnabled"; problem: "IDENTITY_INCOMPLETE"; identityProblems: IdentityProblem[] }
  | { field: "identity"; problem: "INVALID"; identityProblems: IdentityProblem[] }
  | { field: "agent.openerSuffix"; problem: "STYLE"; violations: StyleViolation[] }
  | { field: "routes"; problem: "ALLOCATION"; reason: "OUT_OF_RANGE" | "SUM_OVER_100" }
  | { field: "transfer.numberE164"; problem: "REQUIRED_FOR_MODE" }
  | { field: "transfer.numberE164"; problem: "NOT_ALLOWED" };

/**
 * The rules checked before a save, against the identity as it WILL be after
 * the update. Returns every problem (none = save).
 */
export function validateVoiceSettingsUpdate(update: VoiceSettingsUpdate, stored: StoredIdentity): UpdateProblem[] {
  const problems: UpdateProblem[] = [];
  const identity = {
    callingAsName: update.identity?.callingAsName ?? stored.calling_as_name,
    legalEntityName: update.identity?.legalEntityName ?? stored.legal_entity_name,
    identificationContact: update.identity?.identificationContact ?? stored.identification_contact,
    personaName:
      update.agent?.personaName !== undefined
        ? update.agent.personaName
        : update.identity?.personaName !== undefined
          ? update.identity.personaName
          : stored.assistant_persona_name,
  };
  const readiness = identityReadiness(identity);
  if (update.identity && !readiness.ready) {
    problems.push({ field: "identity", problem: "INVALID", identityProblems: readiness.problems });
  }
  if (update.voiceEnabled === true && !readiness.ready) {
    problems.push({ field: "voiceEnabled", problem: "IDENTITY_INCOMPLETE", identityProblems: readiness.problems });
  }
  const suffix = update.agent?.openerSuffix;
  if (suffix) {
    const violations = validateEditableSuffix(suffix);
    if (violations.length) problems.push({ field: "agent.openerSuffix", problem: "STYLE", violations });
  }
  if (update.routes) {
    const allocations: Partial<Record<VoiceRouteKey, number>> = {};
    for (const r of update.routes) if (r.percent != null) allocations[r.route] = r.percent;
    const v = validateAllocations(allocations);
    if (!v.ok) problems.push({ field: "routes", problem: "ALLOCATION", reason: v.reason });
  }
  if (update.transfer && update.transfer.mode !== "NEVER" && !update.transfer.numberE164) {
    problems.push({ field: "transfer.numberE164", problem: "REQUIRED_FOR_MODE" });
  }
  // A transfer is a second outbound leg the platform pays for: only the
  // classes an AI call may dial (UK geographic, UK mobile, 03), never a
  // premium, 070/076, 084/087, freephone-priced or foreign number (toll fraud;
  // QA 2026-09-30 found +44 909 accepted).
  const transferTo = update.transfer?.numberE164;
  if (transferTo && !DIALLABLE_CLASSES.includes(classifyDestination(transferTo))) {
    problems.push({ field: "transfer.numberE164", problem: "NOT_ALLOWED" });
  }
  return problems;
}

/* ------------------------------------------------------------- the preview */

/**
 * The full opener as the lead will hear it: the locked OD-1 preamble (read
 * only) and then the editable remainder. The preview uses "yesterday" as the
 * enquiry day so the owner hears a realistic sentence.
 */
export function openerPreview(input: {
  callingAsName: string | null;
  recordingEnabled: boolean;
  openerSuffix: string | null;
  now?: Date;
}): { locked: string | null; editable: string | null; full: string | null } {
  const name = (input.callingAsName ?? "").trim();
  if (!name) return { locked: null, editable: input.openerSuffix?.trim() || null, full: null };
  const now = input.now ?? new Date("2026-09-28T10:00:00Z");
  const preamble = buildLockedPreamble({
    callingAsName: name,
    enquiryAt: new Date(now.getTime() - 86_400_000),
    now,
    timezone: "Europe/London",
    recordingEnabled: input.recordingEnabled,
  });
  const editable = input.openerSuffix?.trim() || null;
  return { locked: preamble.text, editable, full: editable ? `${preamble.text} ${editable}` : preamble.text };
}

/** Route targets for display (read-only; the time governor enforces them). */
export function routeTargetsForDisplay(): { route: VoiceRouteKey; targetMinutes: number; maxMinutes: number }[] {
  return VOICE_ROUTES.map((route) => ({
    route,
    targetMinutes: Math.round((ROUTE_TARGETS[route].targetSec / 60) * 10) / 10,
    maxMinutes: Math.round((ROUTE_TARGETS[route].maxSec / 60) * 10) / 10,
  }));
}

export const ROUTE_LABEL: Readonly<Record<VoiceRouteKey, string>> = {
  QUALIFICATION: "Qualification",
  BOOKING_CLOSE: "Booking close",
  DIRECT_CLOSE: "Direct close",
  NURTURE: "Nurture",
  REACTIVATION: "Reactivation",
};

/** Provisioning state -> the three stages a customer sees. */
export function numberStage(state: string | null | undefined, needsAttention: boolean): {
  stage: "NOT_STARTED" | "DETAILS_NEEDED" | "IN_REVIEW" | "SETTING_UP" | "ACTIVE" | "ACTION_NEEDED" | "RELEASING" | "RELEASED";
  label: string;
} {
  if (needsAttention) return { stage: "ACTION_NEEDED", label: "Action needed" };
  switch (state ?? "NOT_REQUESTED") {
    case "NOT_REQUESTED":
      return { stage: "NOT_STARTED", label: "Not requested" };
    case "DETAILS_REQUIRED":
      return { stage: "DETAILS_NEEDED", label: "Business details needed" };
    case "SUBACCOUNT_CREATED":
    case "BUNDLE_SUBMITTED":
    case "BUNDLE_IN_REVIEW":
      return { stage: "IN_REVIEW", label: "In Twilio review" };
    case "BUNDLE_REJECTED":
      return { stage: "ACTION_NEEDED", label: "Action needed" };
    case "BUNDLE_APPROVED":
    case "NUMBER_SEARCHING":
    case "NUMBER_PURCHASED":
    case "CONFIGURED":
      return { stage: "SETTING_UP", label: "Setting up your number" };
    case "ACTIVE":
      return { stage: "ACTIVE", label: "Active" };
    case "RELEASE_SCHEDULED":
      return { stage: "RELEASING", label: "Release scheduled" };
    default:
      return { stage: "RELEASED", label: "Released" };
  }
}
