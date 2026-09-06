/**
 * Add Lead wizard — the pure half.
 *
 * Every enum, label, validation rule and derivation the four steps need lives
 * here. Deliberately free of `server-only`, of Supabase and of React, for two
 * reasons: the client steps import it to render, and the server action imports
 * the *same* rules to re-decide on submit. A rule that exists in only one of
 * those two places is a rule a hand-crafted request can walk past.
 *
 * The one thing this file must never do is decide contactability. It describes
 * what the operator claimed; `contactability.ts` (server-only) decides what
 * that claim permits.
 */

import { z } from "zod";
import { normalisePhone } from "../../messaging/types.ts";
import type { RelationshipType } from "../../policy/types.ts";

/* ------------------------------------------------------------------ source */

/**
 * Where a manually-typed lead came from. These are exactly the manual members
 * of the `leads_intake_method_check` constraint (migration 0038) — the wizard
 * cannot produce META/WEBFORM/CLIENTTURN_SOURCING, which are machine intakes.
 */
export const LEAD_SOURCES = [
  "MANUAL",
  "PHONE_CALL",
  "WALK_IN",
  "REFERRAL",
  "EVENT",
  "IMPORT",
  "PIPEDRIVE",
  "OTHER",
] as const;

export type LeadSourceValue = (typeof LEAD_SOURCES)[number];

const SOURCE_LABELS: Record<LeadSourceValue, string> = {
  MANUAL: "Manual",
  PHONE_CALL: "Phone call",
  WALK_IN: "Walk-in",
  REFERRAL: "Referral",
  EVENT: "Event",
  IMPORT: "Import",
  PIPEDRIVE: "Pipedrive",
  OTHER: "Other",
};

export function sourceValueLabel(value: LeadSourceValue): string {
  return SOURCE_LABELS[value] ?? value;
}

/**
 * The `lead_sources.provider` slug that records this intake. Widened for these
 * exact values by migration 0038, so a manual lead's provenance sits in the
 * same table an inbound lead's does rather than in a parallel one.
 */
const SOURCE_PROVIDERS: Record<LeadSourceValue, string> = {
  MANUAL: "manual",
  PHONE_CALL: "phone_call",
  WALK_IN: "walk_in",
  REFERRAL: "referral",
  EVENT: "event",
  IMPORT: "import",
  PIPEDRIVE: "pipedrive",
  OTHER: "other",
};

export function sourceProviderSlug(value: LeadSourceValue): string {
  return SOURCE_PROVIDERS[value] ?? "manual";
}

/**
 * Sources that say nothing on their own about where the person came from.
 * "Referral" without a name, or "Other" without a sentence, is not provenance,
 * so the step asks for the detail rather than accepting the bare label.
 */
const SOURCE_DETAIL_REQUIRED = new Set<LeadSourceValue>([
  "REFERRAL",
  "EVENT",
  "PIPEDRIVE",
  "IMPORT",
  "OTHER",
]);

export function sourceDetailRequired(value: LeadSourceValue): boolean {
  return SOURCE_DETAIL_REQUIRED.has(value);
}

/* --------------------------------------------------------- conversion goal */

/** Mirrors `conversion_goals.type` (migration 0025). */
export const CONVERSION_GOALS = [
  "BOOK_APPOINTMENT",
  "BOOK_SITE_VISIT",
  "BOOK_DEMO",
  "REQUEST_QUOTE",
  "PHONE_CALL",
  "DIRECT_SIGNUP",
  "DIRECT_PURCHASE",
  "HUMAN_HANDOVER",
  "CUSTOM",
] as const;

export type ConversionGoalValue = (typeof CONVERSION_GOALS)[number];

const GOAL_LABELS: Record<ConversionGoalValue, string> = {
  BOOK_APPOINTMENT: "Booking",
  BOOK_SITE_VISIT: "Site visit",
  BOOK_DEMO: "Demo",
  REQUEST_QUOTE: "Quote",
  PHONE_CALL: "Call",
  DIRECT_SIGNUP: "Signup",
  DIRECT_PURCHASE: "Purchase",
  HUMAN_HANDOVER: "Handover",
  CUSTOM: "Custom",
};

export function conversionGoalLabel(value: ConversionGoalValue): string {
  return GOAL_LABELS[value] ?? value;
}

export type ConversionDestination = {
  /** e.g. "Site visit → Booking / Handover". */
  title: string;
  detail: string;
};

/**
 * The destination is *derived* from the goal, never chosen separately: Step 4
 * shows where the lead will flow, it does not offer a second answer that could
 * disagree with the first.
 */
export function conversionDestination(
  goal: ConversionGoalValue,
): ConversionDestination {
  switch (goal) {
    case "BOOK_APPOINTMENT":
      return {
        title: "Booking → Booking",
        detail:
          "This lead will be routed straight to your booking flow once qualified.",
      };
    case "BOOK_SITE_VISIT":
      return {
        title: "Site visit → Booking / Handover",
        detail:
          "This lead will be routed to your booking flow after a site visit is completed.",
      };
    case "BOOK_DEMO":
      return {
        title: "Demo → Booking",
        detail: "This lead will be routed to your booking flow for a demo slot.",
      };
    case "REQUEST_QUOTE":
      return {
        title: "Quote → Qualification / Handover",
        detail:
          "This lead will be qualified, then handed to your team to price the work.",
      };
    case "PHONE_CALL":
      return {
        title: "Call → Handover",
        detail:
          "This lead will be handed to your team to schedule and make the call.",
      };
    case "DIRECT_SIGNUP":
      return {
        title: "Signup → Conversion",
        detail: "This lead will be routed to your signup destination.",
      };
    case "DIRECT_PURCHASE":
      return {
        title: "Purchase → Conversion",
        detail: "This lead will be routed to your purchase destination.",
      };
    case "HUMAN_HANDOVER":
      return {
        title: "Handover → Your team",
        detail: "This lead will be handed straight to your team, with no automation.",
      };
    case "CUSTOM":
      return {
        title: "Custom → Configured destination",
        detail:
          "This lead will follow the destination configured for your custom goal.",
      };
  }
}

/* ------------------------------------------------------------ relationship */

/** The eight cards in Step 3, in the order the design lays them out. */
export const RELATIONSHIP_CHOICES = [
  "THEY_CONTACTED_US",
  "EXISTING_CUSTOMER",
  "REFERRAL",
  "REQUESTED_INFORMATION",
  "EXPLICIT_MARKETING_CONSENT",
  "EXISTING_BUSINESS_RELATIONSHIP",
  "FOUND_BY_US",
  "OTHER",
] as const;

export type RelationshipChoice = (typeof RELATIONSHIP_CHOICES)[number];

const RELATIONSHIP_CARD_LABELS: Record<RelationshipChoice, string> = {
  THEY_CONTACTED_US: "They contacted us",
  EXISTING_CUSTOMER: "Existing customer",
  REFERRAL: "Referral / introduction",
  REQUESTED_INFORMATION: "Requested information",
  EXPLICIT_MARKETING_CONSENT: "Explicit marketing consent",
  EXISTING_BUSINESS_RELATIONSHIP: "Existing business relationship",
  FOUND_BY_US: "I found this person/company",
  OTHER: "Other",
};

export function relationshipCardLabel(value: RelationshipChoice): string {
  return RELATIONSHIP_CARD_LABELS[value];
}

/**
 * Relationships where the claim alone is not enough. "Someone referred them"
 * with no name and no date cannot be audited later, so the wizard asks for the
 * evidence at the point the human still remembers it.
 */
const EVIDENCE_REQUIRED = new Set<RelationshipChoice>([
  "REFERRAL",
  "REQUESTED_INFORMATION",
  "EXPLICIT_MARKETING_CONSENT",
  "EXISTING_BUSINESS_RELATIONSHIP",
  "OTHER",
]);

export function evidenceRequired(value: RelationshipChoice): boolean {
  return EVIDENCE_REQUIRED.has(value);
}

/** How the record should be treated. PROSPECT means "this is not a Lead". */
export type LeadClassification = "WARM" | "REVIEW" | "PROSPECT";

/**
 * The warm-lead boundary (V4 §6.5), decided deterministically from the
 * relationship and the evidence — never from the source, and never from
 * anything the operator typed in a free-text box.
 */
export function classifyRelationship(
  relationship: RelationshipChoice,
  evidence: string,
): LeadClassification {
  if (relationship === "FOUND_BY_US") return "PROSPECT";
  if (relationship === "OTHER") return "REVIEW";
  if (evidenceRequired(relationship) && evidence.trim().length < MIN_EVIDENCE) {
    return "REVIEW";
  }
  return "WARM";
}

/** Enough to name a person and a date. Shorter is not evidence. */
export const MIN_EVIDENCE = 20;

/** The wizard's card value in the vocabulary `contact_permissions` stores. */
export function toPolicyRelationship(
  value: RelationshipChoice,
): RelationshipType {
  return value;
}

/* ---------------------------------------------------------------- channels */

export const WIZARD_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "PHONE"] as const;
export type WizardChannel = (typeof WIZARD_CHANNELS)[number];

export const CHANNEL_LABELS: Record<WizardChannel, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
};

/**
 * PERMITTED — may be used now.
 * REVIEW     — a human must decide before anything is sent.
 * BLOCKED    — policy or suppression forbids it, and the UI cannot lift that.
 * UNAVAILABLE— there is no address, or no connected provider, for this channel.
 */
export type ChannelPermission = "PERMITTED" | "REVIEW" | "BLOCKED" | "UNAVAILABLE";

export const CHANNEL_PERMISSION_LABELS: Record<ChannelPermission, string> = {
  PERMITTED: "Permitted",
  REVIEW: "Review",
  BLOCKED: "Blocked",
  UNAVAILABLE: "Unavailable",
};

/** Only the three messaging channels can carry an automated follow-up. */
export const MESSAGING_CHANNELS: WizardChannel[] = ["EMAIL", "SMS", "WHATSAPP"];

export type SuppressionIssue = {
  code: string;
  label: string;
  detail: string;
  tone: "warning" | "danger";
};

export type ContactabilityAssessment = {
  classification: LeadClassification;
  channels: Record<WizardChannel, { permission: ChannelPermission; reason: string }>;
  suppression: SuppressionIssue[];
  /** True when the record must not be created as a Lead at all. */
  prospectRedirect: boolean;
  /** Human sentence for why evidence is still outstanding, if it is. */
  evidenceRequirement: string | null;
};

export function permittedChannels(
  assessment: ContactabilityAssessment | null,
): WizardChannel[] {
  if (!assessment) return [];
  return WIZARD_CHANNELS.filter(
    (channel) => assessment.channels[channel].permission === "PERMITTED",
  );
}

export function permittedMessagingChannels(
  assessment: ContactabilityAssessment | null,
): WizardChannel[] {
  return permittedChannels(assessment).filter((channel) =>
    MESSAGING_CHANNELS.includes(channel),
  );
}

/** A blocking suppression stops the wizard; a warning only informs. */
export function hasBlockingSuppression(
  assessment: ContactabilityAssessment | null,
): boolean {
  return Boolean(assessment?.suppression.some((issue) => issue.tone === "danger"));
}

/* -------------------------------------------------------------- duplicates */

export type DuplicateConfidence =
  | "EXACT_EMAIL"
  | "EXACT_PHONE"
  | "NAME_COMPANY"
  | "COMPANY_MATCH";

export type DuplicateMatch = {
  id: string;
  kind: "LEAD" | "PROSPECT";
  name: string;
  company: string | null;
  /** Already masked by the server; the wizard never receives a full address. */
  emailMasked: string | null;
  phoneMasked: string | null;
  status: string;
  createdAt: string;
  confidence: DuplicateConfidence;
};

/**
 * An exact email or phone match inside one workspace is the same person. The
 * softer signals inform the operator but never block them.
 */
export function isBlockingDuplicate(match: DuplicateMatch): boolean {
  return match.confidence === "EXACT_EMAIL" || match.confidence === "EXACT_PHONE";
}

export function blockingDuplicates(matches: DuplicateMatch[]): DuplicateMatch[] {
  return matches.filter(isBlockingDuplicate);
}

const DUPLICATE_LABELS: Record<DuplicateConfidence, string> = {
  EXACT_EMAIL: "Same email address",
  EXACT_PHONE: "Same phone number",
  NAME_COMPANY: "Same name at the same company",
  COMPANY_MATCH: "Same company",
};

export function duplicateConfidenceLabel(value: DuplicateConfidence): string {
  return DUPLICATE_LABELS[value] ?? "Possible match";
}

/* ------------------------------------------------------------ normalisation */

export function normaliseEmail(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

export function normalisePostcode(value: string | null | undefined): string | null {
  const compact = (value ?? "").replace(/\s+/g, "").toUpperCase();
  if (compact === "") return null;
  // UK postcodes are outward + 3 inward characters; anything else is left as
  // typed rather than mangled, because the wizard also serves non-UK entries.
  if (compact.length < 5 || compact.length > 8) return compact;
  return `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
}

export function normaliseCompany(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed;
}

/** Comparison key for the company side of the duplicate check. */
export function companyKey(value: string | null | undefined): string | null {
  const name = normaliseCompany(value);
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|inc|co|company|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normalisePhoneValue(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  return normalisePhone(trimmed);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** A number we can actually dial or text: E.164, 8–15 digits. */
export function isValidPhone(value: string): boolean {
  const normalised = normalisePhoneValue(value);
  if (!normalised) return false;
  return /^\+\d{8,15}$/.test(normalised);
}

/* ------------------------------------------------------------ wizard state */

export type ContactState = {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  mobile: string;
  telephone: string;
  postcode: string;
  address: string;
};

export type EnquiryState = {
  serviceId: string;
  enquiryText: string;
  source: LeadSourceValue;
  sourceDetail: string;
  estimatedValue: string;
  conversionGoal: ConversionGoalValue | "";
  notes: string;
};

export type PermissionState = {
  relationship: RelationshipChoice | "";
  evidence: string;
};

export type QualificationFlowChoice = "default" | "service";

export type RoutingState = {
  assigneeId: string;
  initialStatus: InitialStatus;
  needsAttention: boolean;
  attentionReason: string;
  startFollowUp: boolean;
  qualificationFlow: QualificationFlowChoice;
};

export type AddLeadState = {
  contact: ContactState;
  enquiry: EnquiryState;
  permission: PermissionState;
  routing: RoutingState;
};

/**
 * A lead may only be created at the start of its lifecycle. QUALIFIED, BOOKED,
 * WON and LOST are outcomes the engine records — offering them here would let
 * a form write a history that never happened.
 */
export const INITIAL_STATUSES = ["NEW", "CONTACTED"] as const;
export type InitialStatus = (typeof INITIAL_STATUSES)[number];

export const INITIAL_STATUS_LABELS: Record<InitialStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
};

export const MAX_ENQUIRY = 1000;
export const MAX_NOTES = 1000;
export const MAX_EVIDENCE = 500;

export function initialAddLeadState(): AddLeadState {
  return {
    contact: {
      firstName: "",
      lastName: "",
      company: "",
      email: "",
      mobile: "",
      telephone: "",
      postcode: "",
      address: "",
    },
    enquiry: {
      serviceId: "",
      enquiryText: "",
      source: "PHONE_CALL",
      sourceDetail: "",
      estimatedValue: "",
      conversionGoal: "",
      notes: "",
    },
    permission: { relationship: "", evidence: "" },
    routing: {
      assigneeId: "",
      initialStatus: "NEW",
      needsAttention: false,
      attentionReason: "",
      startFollowUp: true,
      qualificationFlow: "default",
    },
  };
}

/** Anything typed at all — drives the "discard?" confirmation on cancel. */
export function isDirty(state: AddLeadState): boolean {
  const blank = initialAddLeadState();
  return JSON.stringify(state) !== JSON.stringify(blank);
}

/* -------------------------------------------------------------- validation */

export type FieldErrors = Record<string, string>;

export function validateContactStep(state: ContactState): FieldErrors {
  const errors: FieldErrors = {};

  if (!state.firstName.trim()) errors.firstName = "Enter a first name.";
  if (!state.lastName.trim()) errors.lastName = "Enter a last name.";
  if (!state.company.trim()) {
    errors.company = "Enter the company or business name.";
  }

  const email = state.email.trim();
  const mobile = state.mobile.trim();
  const telephone = state.telephone.trim();

  if (email && !isValidEmail(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (mobile && !isValidPhone(mobile)) {
    errors.mobile = "Enter a valid mobile number.";
  }
  if (telephone && !isValidPhone(telephone)) {
    errors.telephone = "Enter a valid telephone number.";
  }

  // One usable way to reach them is the floor: a lead nobody can contact
  // cannot be followed up, qualified or converted.
  if (!email && !mobile && !telephone) {
    errors.email = "Add at least one way to contact them.";
    errors.mobile = "Add at least one way to contact them.";
  }

  if (!state.postcode.trim()) {
    errors.postcode = "Enter a postcode.";
  }

  return errors;
}

export function validateEnquiryStep(state: EnquiryState): FieldErrors {
  const errors: FieldErrors = {};

  if (!state.serviceId) errors.serviceId = "Choose a service.";

  const enquiry = state.enquiryText.trim();
  if (!enquiry) {
    errors.enquiryText = "Describe what they need.";
  } else if (enquiry.length > MAX_ENQUIRY) {
    errors.enquiryText = `Keep this under ${MAX_ENQUIRY} characters.`;
  }

  if (!LEAD_SOURCES.includes(state.source)) {
    errors.source = "Choose where this enquiry came from.";
  } else if (sourceDetailRequired(state.source) && !state.sourceDetail.trim()) {
    errors.sourceDetail = "Add the detail behind this source.";
  }

  if (state.estimatedValue.trim()) {
    const value = Number(state.estimatedValue.replace(/[,\s£]/g, ""));
    if (!Number.isFinite(value) || value < 0) {
      errors.estimatedValue = "Enter a number, or leave this blank.";
    } else if (value > 1_000_000) {
      errors.estimatedValue = "Enter an estimate below 1,000,000.";
    }
  }

  if (!state.conversionGoal) {
    errors.conversionGoal = "Choose what you are aiming for.";
  }

  if (state.notes.length > MAX_NOTES) {
    errors.notes = `Keep notes under ${MAX_NOTES} characters.`;
  }

  return errors;
}

export function validatePermissionStep(
  state: PermissionState,
  assessment: ContactabilityAssessment | null,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!state.relationship) {
    errors.relationship = "Tell us how you know this person or company.";
    return errors;
  }

  if (state.relationship === "FOUND_BY_US") {
    errors.relationship =
      "People you find yourself are Prospects. Use “Add to Find Leads instead”.";
    return errors;
  }

  if (
    evidenceRequired(state.relationship) &&
    state.evidence.trim().length < MIN_EVIDENCE
  ) {
    errors.evidence =
      "Add the evidence: who, when, and what contact they agreed to.";
  }

  if (state.evidence.length > MAX_EVIDENCE) {
    errors.evidence = `Keep evidence under ${MAX_EVIDENCE} characters.`;
  }

  if (assessment) {
    if (assessment.prospectRedirect) {
      errors.relationship =
        "This record must be added as a Prospect, not a warm lead.";
    }
    if (hasBlockingSuppression(assessment)) {
      errors.suppression =
        "Resolve the suppression issues below before continuing.";
    }
  }

  return errors;
}

export function validateRouteStep(state: RoutingState): FieldErrors {
  const errors: FieldErrors = {};

  if (!INITIAL_STATUSES.includes(state.initialStatus)) {
    errors.initialStatus = "Choose a valid starting status.";
  }
  if (state.needsAttention && !state.attentionReason.trim()) {
    errors.attentionReason = "Give a reason for flagging this lead.";
  }
  if (state.attentionReason.length > 200) {
    errors.attentionReason = "Keep the reason under 200 characters.";
  }
  return errors;
}

/* --------------------------------------------------------- follow-up gating */

export type FollowUpAvailability = {
  /** A published `new_lead` automation exists and is enabled. */
  automationReady: boolean;
  reason: string | null;
};

/**
 * Follow-up may only start when there is somewhere to send it *and* something
 * to send. Both halves are re-checked on the server at submit; this is the
 * same rule, so the toggle never promises what the submit will refuse.
 */
export function followUpEligibility(
  assessment: ContactabilityAssessment | null,
  availability: FollowUpAvailability,
): { eligible: boolean; reason: string | null } {
  if (!availability.automationReady) {
    return {
      eligible: false,
      reason:
        availability.reason ??
        "No published follow-up automation is available in this workspace.",
    };
  }
  if (!assessment) {
    return { eligible: false, reason: "Contactability has not been assessed yet." };
  }
  if (permittedMessagingChannels(assessment).length === 0) {
    return {
      eligible: false,
      reason: "No messaging channel is permitted for this lead.",
    };
  }
  return { eligible: true, reason: null };
}

/* ------------------------------------------------------ routing readiness */

export type ReadinessItem = {
  key: string;
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger";
};

export function routingReadiness(input: {
  duplicates: DuplicateMatch[];
  duplicateChecked: boolean;
  assessment: ContactabilityAssessment | null;
  followUp: { requested: boolean; eligible: boolean; reason: string | null };
}): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const blocking = blockingDuplicates(input.duplicates);

  if (!input.duplicateChecked) {
    items.push({
      key: "duplicate",
      label: "Duplicate check pending",
      detail: "We will check again when you create this lead.",
      tone: "warning",
    });
  } else if (blocking.length > 0) {
    items.push({
      key: "duplicate",
      label: "Duplicate found",
      detail: `${blocking.length} existing record${blocking.length === 1 ? "" : "s"} match this contact.`,
      tone: "danger",
    });
  } else if (input.duplicates.length > 0) {
    items.push({
      key: "duplicate",
      label: "Possible match",
      detail: "A softer match exists — review before creating.",
      tone: "warning",
    });
  } else {
    items.push({
      key: "duplicate",
      label: "No duplicate found",
      detail: "We checked against existing leads.",
      tone: "success",
    });
  }

  const classification = input.assessment?.classification ?? null;
  if (classification === "WARM") {
    items.push({
      key: "warm",
      label: "Warm lead",
      detail: "This lead is marked as warm.",
      tone: "success",
    });
  } else if (classification === "REVIEW") {
    items.push({
      key: "warm",
      label: "Needs review",
      detail: "A person must confirm this relationship before any message.",
      tone: "warning",
    });
  } else if (classification === "PROSPECT") {
    items.push({
      key: "warm",
      label: "Prospect route required",
      detail: "This record cannot be created as a warm lead.",
      tone: "danger",
    });
  } else {
    items.push({
      key: "warm",
      label: "Relationship not assessed",
      detail: "Complete Step 3 to classify this lead.",
      tone: "warning",
    });
  }

  const permitted = permittedChannels(input.assessment);
  items.push(
    permitted.length > 0
      ? {
          key: "channels",
          label: `${permitted.length} permitted channel${permitted.length === 1 ? "" : "s"}`,
          detail: permitted.map((c) => CHANNEL_LABELS[c]).join(", "),
          tone: "success",
        }
      : {
          key: "channels",
          label: "No permitted channels",
          detail: "This lead can be recorded but not contacted.",
          tone: "warning",
        },
  );

  if (!input.followUp.requested) {
    items.push({
      key: "follow-up",
      label: "Follow-up off",
      detail: "No follow-up will be created for this lead.",
      tone: "warning",
    });
  } else if (input.followUp.eligible) {
    items.push({
      key: "follow-up",
      label: "Follow-up ready",
      detail: "Initial follow-up will be created.",
      tone: "success",
    });
  } else {
    items.push({
      key: "follow-up",
      label: "Follow-up unavailable",
      detail: input.followUp.reason ?? "Follow-up cannot start for this lead.",
      tone: "warning",
    });
  }

  return items;
}

/* ------------------------------------------------------------ wire schemas */

const trimmed = (max: number) => z.string().trim().max(max);

export const contactPayloadSchema = z.object({
  firstName: trimmed(80).min(1),
  lastName: trimmed(80).min(1),
  company: trimmed(160).min(1),
  email: trimmed(200),
  mobile: trimmed(40),
  telephone: trimmed(40),
  postcode: trimmed(16).min(1),
  address: trimmed(300),
});

export const enquiryPayloadSchema = z.object({
  serviceId: z.uuid(),
  enquiryText: trimmed(MAX_ENQUIRY).min(1),
  source: z.enum(LEAD_SOURCES),
  sourceDetail: trimmed(300),
  estimatedValue: trimmed(20),
  conversionGoal: z.enum(CONVERSION_GOALS),
  notes: trimmed(MAX_NOTES),
});

export const permissionPayloadSchema = z.object({
  relationship: z.enum(RELATIONSHIP_CHOICES),
  evidence: trimmed(MAX_EVIDENCE),
});

export const routingPayloadSchema = z.object({
  assigneeId: z.union([z.uuid(), z.literal("")]),
  initialStatus: z.enum(INITIAL_STATUSES),
  needsAttention: z.boolean(),
  attentionReason: trimmed(200),
  startFollowUp: z.boolean(),
  qualificationFlow: z.enum(["default", "service"]),
});

export const createManualLeadSchema = z.object({
  contact: contactPayloadSchema,
  enquiry: enquiryPayloadSchema,
  permission: permissionPayloadSchema,
  routing: routingPayloadSchema,
  /** Set only after the operator was shown a soft match and chose to proceed. */
  acknowledgedDuplicates: z.boolean().default(false),
});

export type CreateManualLeadInput = z.infer<typeof createManualLeadSchema>;

export const duplicateCheckSchema = z.object({
  email: z.string().trim().max(200),
  mobile: z.string().trim().max(40),
  telephone: z.string().trim().max(40),
  company: z.string().trim().max(160),
  firstName: z.string().trim().max(80),
  lastName: z.string().trim().max(80),
});

export const contactabilityCheckSchema = z.object({
  email: z.string().trim().max(200),
  mobile: z.string().trim().max(40),
  telephone: z.string().trim().max(40),
  postcode: z.string().trim().max(16),
  relationship: z.enum(RELATIONSHIP_CHOICES),
  evidence: z.string().trim().max(MAX_EVIDENCE),
});

/* -------------------------------------------------------------- outcomes */

export type CreateLeadOutcome =
  | { status: "CREATED"; leadId: string; followUpStarted: boolean; warning?: string }
  | { status: "DUPLICATE"; matches: DuplicateMatch[] }
  | { status: "PROSPECT_REQUIRED"; message: string }
  | { status: "ERROR"; error: string };

export type ProspectHandoffOutcome =
  | { status: "CREATED"; prospectId: string }
  | { status: "ERROR"; error: string };

/** The estimate as a number, or null. Never a revenue figure. */
export function parseEstimatedValue(raw: string): number | null {
  const cleaned = raw.replace(/[,\s£]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return Math.round(value * 100) / 100;
}
