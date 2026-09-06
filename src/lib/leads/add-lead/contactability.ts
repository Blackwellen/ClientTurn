import "server-only";
import { evaluateAllChannels } from "@/lib/policy/service";
import { checkSuppression } from "@/lib/policy/suppression";
import type { PolicyChannel, PolicyDecision } from "@/lib/policy/types";
import { findDuplicates, existingLeadState } from "./duplicate-check";
import {
  classifyRelationship,
  evidenceRequired,
  isValidEmail,
  isValidPhone,
  MIN_EVIDENCE,
  normaliseEmail,
  normalisePhoneValue,
  WIZARD_CHANNELS,
  type ChannelPermission,
  type ContactabilityAssessment,
  type RelationshipChoice,
  type SuppressionIssue,
  type WizardChannel,
} from "./types";

/**
 * Contactability for a lead that does not exist yet.
 *
 * The wizard shows this in Step 3 and the create action runs it again before
 * insert — the client's copy is never trusted. Its job is to turn "here is what
 * the operator claims about the relationship" into "here is what each channel
 * may actually be used for", using the same `ChannelPolicyService` that governs
 * every real send.
 *
 * Voice calls are the one channel the policy engine has no rules for, because
 * ClientTurn never places a call itself. Its permission is decided here from
 * the facts that would stop a human dialling: no number, opt-out, suppression,
 * or a record that must not be a Lead at all.
 */

/** The lead does not exist yet, so policy lookups key on nothing. */
const UNSAVED_SUBJECT_ID = "00000000-0000-0000-0000-000000000000";

const COOLDOWN_DAYS = 30;

export type AssessInput = {
  businessId: string;
  email: string;
  mobile: string;
  telephone: string;
  postcode: string;
  relationship: RelationshipChoice;
  evidence: string;
  /** Which channels this workspace can actually send on right now. */
  capabilities: { sms: boolean; whatsapp: boolean; email: boolean };
};

function permissionFor(decision: PolicyDecision): ChannelPermission {
  switch (decision.outcome) {
    case "ALLOWED":
      return "PERMITTED";
    case "BLOCKED":
      return decision.reasonCode === "BLOCKED_INVALID_CONTACT" ||
        decision.reasonCode === "BLOCKED_PROVIDER"
        ? "UNAVAILABLE"
        : "BLOCKED";
    default:
      return "REVIEW";
  }
}

const POLICY_CHANNEL_FOR: Record<
  Exclude<WizardChannel, "PHONE">,
  PolicyChannel
> = {
  EMAIL: "EMAIL",
  SMS: "SMS",
  WHATSAPP: "WHATSAPP",
};

export async function assessContactability(
  input: AssessInput,
): Promise<ContactabilityAssessment> {
  const email = normaliseEmail(input.email);
  const mobile = normalisePhoneValue(input.mobile);
  const telephone = normalisePhoneValue(input.telephone);
  const messagingPhone = mobile;
  const anyPhone = mobile ?? telephone;

  const classification = classifyRelationship(input.relationship, input.evidence);
  const prospectRedirect = classification === "PROSPECT";

  // A prospect-bound record gets no channel permissions at all: the honest
  // answer to "can we email them" is "this must not be a Lead".
  if (prospectRedirect) {
    return {
      classification,
      channels: Object.fromEntries(
        WIZARD_CHANNELS.map((channel) => [
          channel,
          {
            permission: "BLOCKED" as ChannelPermission,
            reason: "People you found yourself must be added as a Prospect.",
          },
        ]),
      ) as ContactabilityAssessment["channels"],
      suppression: [],
      prospectRedirect: true,
      evidenceRequirement: null,
    };
  }

  const { byChannel } = await evaluateAllChannels(
    input.businessId,
    {
      type: "LEAD",
      id: UNSAVED_SUBJECT_ID,
      email,
      phone: messagingPhone,
      relationshipType: input.relationship,
      // Evidence recorded in the wizard is the consent record for this lead;
      // its absence is UNKNOWN, which the pack turns into review, not into a
      // silent yes.
      consentStatus:
        input.relationship === "EXPLICIT_MARKETING_CONSENT" &&
        input.evidence.trim().length >= MIN_EVIDENCE
          ? "GRANTED"
          : "UNKNOWN",
      hasConsentEvidence: input.evidence.trim().length >= MIN_EVIDENCE,
      optedOut: false,
      country: "GB",
    },
    // Manual intake is warm by definition; the moment it is not, the branch
    // above has already sent it to Prospects.
    "WARM",
    { record: false },
  );

  const channels = {} as ContactabilityAssessment["channels"];

  for (const channel of WIZARD_CHANNELS) {
    if (channel === "PHONE") continue;
    const decision = byChannel[POLICY_CHANNEL_FOR[channel]];
    const providerReady =
      channel === "EMAIL"
        ? input.capabilities.email
        : channel === "SMS"
          ? input.capabilities.sms
          : input.capabilities.whatsapp;
    const hasDestination = channel === "EMAIL" ? Boolean(email) : Boolean(messagingPhone);

    let permission = permissionFor(decision);
    let reason = decision.message;

    if (!hasDestination) {
      permission = "UNAVAILABLE";
      reason =
        channel === "EMAIL"
          ? "No email address was entered."
          : "No mobile number was entered.";
    } else if (!providerReady && permission === "PERMITTED") {
      permission = "UNAVAILABLE";
      reason = "This channel is not connected in your workspace settings.";
    } else if (classification === "REVIEW" && permission === "PERMITTED") {
      // The relationship itself is unresolved, so nothing automated goes out
      // on any channel until a person decides.
      permission = "REVIEW";
      reason = "The relationship needs a human decision before any message.";
    }

    channels[channel] = { permission, reason };
  }

  /* --------------------------------------------------------------- phone */

  const phoneSuppression = anyPhone
    ? await checkSuppression(input.businessId, "SMS", { phone: anyPhone })
    : null;

  channels.PHONE = !anyPhone
    ? { permission: "UNAVAILABLE", reason: "No phone number was entered." }
    : phoneSuppression
      ? {
          permission: "BLOCKED",
          reason: "This number is on your suppression list.",
        }
      : classification === "REVIEW"
        ? {
            permission: "REVIEW",
            reason: "The relationship needs a human decision before contact.",
          }
        : {
            permission: "PERMITTED",
            reason: "A person may call this number.",
          };

  /* --------------------------------------------------------- suppression */

  const suppression: SuppressionIssue[] = [];

  if (input.email.trim() && !isValidEmail(input.email)) {
    suppression.push({
      code: "invalid_email",
      label: "Email address is not valid",
      detail: "Correct the address in Step 1 or remove it.",
      tone: "danger",
    });
  }
  for (const [value, label] of [
    [input.mobile, "Mobile"],
    [input.telephone, "Telephone"],
  ] as const) {
    if (value.trim() && !isValidPhone(value)) {
      suppression.push({
        code: "invalid_phone",
        label: `${label} number is not valid`,
        detail: "Correct the number in Step 1 or remove it.",
        tone: "danger",
      });
    }
  }

  const emailSuppression = email
    ? await checkSuppression(input.businessId, "EMAIL", { email })
    : null;
  if (emailSuppression) {
    suppression.push({
      code: "email_suppressed",
      label: "Email address is suppressed",
      detail: `Reason: ${emailSuppression.reason.toLowerCase()}. This cannot be overridden here.`,
      tone: "danger",
    });
  }
  if (phoneSuppression) {
    suppression.push({
      code: "phone_suppressed",
      label: "Phone number is suppressed",
      detail: `Reason: ${phoneSuppression.reason.toLowerCase()}. This cannot be overridden here.`,
      tone: "danger",
    });
  }

  // State that lives on a record we already hold for this contact.
  const matches = await findDuplicates(input.businessId, {
    email: input.email,
    mobile: input.mobile,
    telephone: input.telephone,
  });
  const leadIds = matches
    .filter((match) => match.kind === "LEAD")
    .map((match) => match.id);
  const existing = await existingLeadState(input.businessId, leadIds);

  if (existing?.optedOut) {
    suppression.push({
      code: "opted_out",
      label: "This contact has opted out",
      detail: "An existing lead for this contact opted out of messages.",
      tone: "danger",
    });
  }
  if (existing?.booked) {
    suppression.push({
      code: "already_booked",
      label: "Already booked",
      detail: "An existing lead for this contact already has a booking.",
      tone: "warning",
    });
  }
  if (existing?.won) {
    suppression.push({
      code: "already_won",
      label: "Already won",
      detail: "An existing lead for this contact is already marked won.",
      tone: "warning",
    });
  }
  if (existing?.activeConversation) {
    suppression.push({
      code: "active_conversation",
      label: "Active conversation",
      detail: "An existing lead for this contact is still in follow-up.",
      tone: "warning",
    });
  }
  if (existing?.recentContactAt) {
    const days =
      (Date.now() - Date.parse(existing.recentContactAt)) / 86_400_000;
    if (Number.isFinite(days) && days < COOLDOWN_DAYS) {
      suppression.push({
        code: "cooldown",
        label: "Recently contacted",
        detail: `This contact was messaged ${Math.max(Math.round(days), 0)} days ago.`,
        tone: "warning",
      });
    }
  }

  const evidenceRequirement =
    evidenceRequired(input.relationship) &&
    input.evidence.trim().length < MIN_EVIDENCE
      ? "Add the evidence behind this relationship — who, when, and what contact they agreed to."
      : null;

  return {
    classification,
    channels,
    suppression,
    prospectRedirect: false,
    evidenceRequirement,
  };
}
