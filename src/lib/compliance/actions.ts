"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { ALLOWED_SOURCE_KINDS, LAWFUL_BASES } from "./types";

/**
 * Saving the workspace's data-control position (Programme §14).
 *
 * Admin only. This is where a workspace states who it is as a legal entity and
 * on what basis it contacts people — the kind of assertion that outlives the
 * person who made it, and that a member should not be able to change on their
 * own.
 */

export type DataControlsResult = { ok: true } | { ok: false; error: string };

/** Trimmed to null rather than left as "": an empty string reads as an answer. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

const schema = z.object({
  legalName: optionalText(200),
  registeredCountry: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .optional()
    .transform((value) => (value ? value : null)),
  registeredAddress: optionalText(500),
  privacyPolicyUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  privacyContactEmail: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  dpoContact: optionalText(200),

  prospectCountries: z
    .array(z.string().trim().length(2).toUpperCase())
    .max(60)
    .default([]),
  prospectType: z.enum(["B2B", "B2C", "BOTH"]).default("B2B"),

  allowedSources: z.array(z.enum(ALLOWED_SOURCE_KINDS)).max(20).default([]),

  marketingLawfulBasis: z.enum(LAWFUL_BASES).default("UNSTATED"),
  lawfulBasisNote: optionalText(2000),

  // Bounds mirror the CHECK constraint so a bad value is refused with a
  // sentence rather than a database error.
  retainUncontactedProspectsDays: z
    .number()
    .int()
    .min(7)
    .max(3650)
    .nullable()
    .default(null),
  retainInactiveLeadsDays: z.number().int().min(30).max(3650).nullable().default(null),
  retainRawEventsDays: z.number().int().min(1).max(365).nullable().default(null),

  /* -------------------------------------------------------------- social */
  // Both default to false rather than carrying the caller's value forward.
  // A form that omits them is a form that did not ask, and the safe reading of
  // "did not ask" is "not enabled" -- these two switches are the difference
  // between a product that prepares work for a person and one that acts on a
  // customer's own social account unattended.
  socialAutonomousSending: z.boolean().default(false),
  socialAutoPromoteOnReply: z.boolean().default(false),
  // Bounds mirror the CHECK constraints added in 0072.
  socialWithdrawAfterDays: z.number().int().min(3).max(90).nullable().default(21),
  socialFollowUpGapHours: z.number().int().min(24).max(720).default(96),
  socialMaxFollowUps: z.number().int().min(0).max(2).default(2),

  /* ---------------------------------------------------------- strictness */
  // BALANCED on an omitted field, matching the column default: a form that did
  // not ask has not been told to loosen anything.
  sourcingStrictness: z.enum(["STRICT", "BALANCED", "OPEN"]).default("BALANCED"),
  requireRegistryMatch: z.boolean().default(false),
});

export async function saveDataControlsAction(
  input: unknown,
): Promise<DataControlsResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue
        ? `${issue.path.join(".") || "That"} is not valid: ${issue.message}`
        : "Some of those details were not valid.",
    };
  }

  const workspace = await requireRole("admin");
  const db = createAdminClient();
  const value = parsed.data;

  const { error } = await db.from("business_data_controls").upsert(
    {
      business_id: workspace.businessId,
      legal_name: value.legalName,
      registered_country: value.registeredCountry,
      registered_address: value.registeredAddress,
      privacy_policy_url: value.privacyPolicyUrl,
      privacy_contact_email: value.privacyContactEmail,
      dpo_contact: value.dpoContact,
      prospect_countries: value.prospectCountries,
      prospect_type: value.prospectType,
      allowed_sources: value.allowedSources,
      marketing_lawful_basis: value.marketingLawfulBasis,
      lawful_basis_note: value.lawfulBasisNote,
      // Stamped whenever a basis is stated, so "when did you last look at this"
      // has an answer that is not the row's last edit for any reason.
      basis_reviewed_at:
        value.marketingLawfulBasis === "UNSTATED" ? null : new Date().toISOString(),
      retain_uncontacted_prospects_days: value.retainUncontactedProspectsDays,
      retain_inactive_leads_days: value.retainInactiveLeadsDays,
      retain_raw_events_days: value.retainRawEventsDays,
      social_autonomous_sending: value.socialAutonomousSending,
      social_auto_promote_on_reply: value.socialAutoPromoteOnReply,
      social_withdraw_after_days: value.socialWithdrawAfterDays,
      social_follow_up_gap_hours: value.socialFollowUpGapHours,
      social_max_follow_ups: value.socialMaxFollowUps,
      sourcing_strictness: value.sourcingStrictness,
      require_registry_match: value.requireRegistryMatch,
      updated_by: workspace.userId,
    },
    { onConflict: "business_id" },
  );

  if (error) return { ok: false, error: "Those settings could not be saved." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "workspace.settings_updated",
    entityType: "business_data_controls",
    entityId: workspace.businessId,
    metadata: {
      section: "data_controls",
      lawful_basis: value.marketingLawfulBasis,
      // Loosening who may be contacted is the change most worth being able to
      // date afterwards, so the mode is recorded on every save rather than only
      // when it changes.
      sourcing_strictness: value.sourcingStrictness,
      require_registry_match: value.requireRegistryMatch,
      // Recorded explicitly: turning on autonomous sending is the single most
      // consequential switch in Settings, and "who turned it on and when" must
      // be answerable from the audit log rather than inferred from a diff.
      social_autonomous_sending: value.socialAutonomousSending,
      social_auto_promote_on_reply: value.socialAutoPromoteOnReply,
      prospect_type: value.prospectType,
      allowed_sources: value.allowedSources,
      // The countries and the basis are the fields a later question would be
      // about, so they are recorded rather than summarised as "changed".
      prospect_countries: value.prospectCountries,
    },
  });

  revalidatePath("/app/settings");
  return { ok: true };
}
